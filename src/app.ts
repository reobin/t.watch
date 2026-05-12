import { createCliRenderer } from "@opentui/core";
import { benchNow, createBenchRun, elapsedMs } from "./benchmark";
import {
  focusPaneForAllClients,
  listSessions,
  watchPanePaths,
  watchSessions,
  type TmuxPaneIntegrationStatus,
  type TmuxSession,
  type TmuxSessionWatcher,
} from "./tmux";
import { renderCommandPanel, renderHelpPanel, type CommandPanelItem } from "./command-panel";
import { commandPanelIndexAtLine, sessionListHitTargetAtLine } from "./hit-targets";
import {
  renderLoading,
  renderMessage,
  renderNoSessions,
  renderSessions,
  paneLineRange,
  scrollLineRangeIntoView,
  sessionLineRange,
  sessionsLineCount,
  type RenderTheme,
} from "./render";
import { createScreen } from "./screen";
import { detectRenderTheme } from "./theme";
import {
  findCurrentSessionId,
  findActivePaneId,
  firstSessionId,
  findSessionIdForPane,
  hasPane,
  hasSession,
  isAttachedActivePane,
  nextJumpPaneId,
  selectNextPane,
  selectNextSession,
  selectPreviousPane,
  selectPreviousSession,
} from "./navigation";
import { notifyWhenThudHidden, type AgentNotification } from "./notifications";

const fallbackRefreshIntervalMs = 1500;
const safetyRefreshIntervalMs = 15000;
const paletteTimeoutMs = 100;
const enableTerminalFocusReporting = "\x1b[?1004h";
const disableTerminalFocusReporting = "\x1b[?1004l";
const commandPanelMaxWidth = 40;
const helpPanelMaxWidth = 72;
const commandPanelHorizontalMargin = 4;
const commandPanelChromeWidth = 4;
const defaultModeIndicatorMs = 1000;
const statusTickIntervalMs = 15000;

type AppMode = "default" | "popup";

export type AppOptions = {
  closeOnFocus?: boolean;
};

export async function startApp(options: AppOptions = {}): Promise<void> {
  let isDestroyed = false;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let refreshTimerIntervalMs: number | undefined;
  let refreshPromise: Promise<boolean> | undefined;
  let refreshQueued = false;
  let nextRefreshForceGit = false;
  let sessionWatcher: TmuxSessionWatcher | undefined;
  let pathWatcher: TmuxSessionWatcher | undefined;
  let isStartingWatcher = false;
  let isStartingPathWatcher = false;
  let isFocusingPane = false;
  let selectedSessionId: string | undefined;
  let currentSessionId: string | undefined;
  let selectedPaneId: string | undefined;
  let sessionScrollY = 0;
  let sessionNavigationOpen = false;
  let paneNavigationOpen = false;
  let sessions: TmuxSession[] = [];
  let lastIntegrationStatuses: Map<string, TmuxPaneIntegrationStatus> | undefined;
  let terminalWidth = 0;
  let activePanel: "commands" | "help" | undefined;
  let selectedCommandIndex = 0;
  let appMode: AppMode = options.closeOnFocus ? "popup" : "default";
  let renderTheme: RenderTheme = {};
  let initialRefreshComplete = false;
  let defaultModeIndicatorTimer: ReturnType<typeof setTimeout> | undefined;
  let statusTickTimer: ReturnType<typeof setInterval> | undefined;
  let suspendHandlerRegistered = false;
  const appPaneId = process.env.TMUX_PANE;
  const startupBench = createBenchRun("startup", {
    mode: appMode,
    closeOnFocus: Boolean(options.closeOnFocus),
    processUptimeAtStartMs: Math.round(process.uptime() * 10000) / 10,
  });

  const rendererStartedAt = benchNow();
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    onDestroy: () => {
      isDestroyed = true;
      removeSuspendHandler();
      process.off("SIGCONT", handleResume);
      process.stdout.write(disableTerminalFocusReporting);

      if (refreshTimer) {
        clearInterval(refreshTimer);
      }

      if (defaultModeIndicatorTimer) {
        clearTimeout(defaultModeIndicatorTimer);
      }

      if (statusTickTimer) {
        clearInterval(statusTickTimer);
      }

      void sessionWatcher?.stop();
      void pathWatcher?.stop();
    },
  });
  startupBench.add({ rendererMs: elapsedMs(rendererStartedAt) });

  addSuspendHandler();
  process.on("SIGCONT", handleResume);

  const themeStartedAt = benchNow();
  const screen = createScreen(renderer, renderLoading(), renderTheme);
  terminalWidth = renderer.width;
  process.stdout.write(enableTerminalFocusReporting);
  void detectRenderTheme(renderer, paletteTimeoutMs)
    .then((theme) => {
      if (isDestroyed) {
        return;
      }

      renderTheme = theme;
      startupBench.add({ themeMs: elapsedMs(themeStartedAt) });
      if (initialRefreshComplete) {
        renderCurrentView();
      }
    })
    .catch(() => undefined);
  const commands: (CommandPanelItem & { run: () => void | Promise<void> })[] = [
    {
      label: "Focus session",
      run: focusSelectedSession,
    },
    {
      label: "Jump pane",
      run: jumpToPane,
    },
    {
      label: "Refresh sessions",
      run: () => refreshSessions({ forceGit: true }),
    },
    {
      label: "Cycle mode",
      run: cycleMode,
    },
    {
      label: "Help",
      run: openHelpPanel,
    },
    {
      label: "Quit",
      run: () => renderer.destroy(),
    },
  ];
  syncModeIndicator();
  screen.setSessionListMouseHandler(handleSessionListClick);
  screen.setCommandPanelMouseHandler(handleCommandPanelClick);
  screen.setCommandPanelBackdropMouseHandler(handleCommandPanelBackdropClick);

  renderer.on("resize", (width) => {
    terminalWidth = width;
    if (sessions.length > 0) {
      syncSelectedSessionScroll();
      renderCurrentView();
    }
  });

  renderer.on("blur", () => {
    resetSelectedSessionToCurrent();
  });

  renderer.keyInput.on("keypress", (key) => {
    if ((key.ctrl || key.meta) && key.name === "p") {
      key.preventDefault();
      activePanel = activePanel === "commands" ? undefined : "commands";
      selectedCommandIndex = Math.min(selectedCommandIndex, commands.length - 1);
      screen.setCommandPanelVisible(activePanel !== undefined);
      renderCurrentView();
      return;
    }

    if (key.name === "?" || (key.shift && key.name === "/")) {
      key.preventDefault();
      activePanel = activePanel === "help" ? undefined : "help";
      screen.setCommandPanelVisible(activePanel !== undefined);
      renderCurrentView();
      return;
    }

    if (key.ctrl || key.meta) {
      return;
    }

    if (activePanel === "help") {
      if (key.name === "escape" || key.name === "esc") {
        key.preventDefault();
        closeActivePanel();
        return;
      }

      if (isHelpPassthroughKey(key)) {
        closeActivePanel();
      } else {
        key.preventDefault();
        return;
      }
    }

    if (activePanel === "commands") {
      if (key.name === "escape" || key.name === "esc") {
        key.preventDefault();
        closeActivePanel();
        return;
      }

      if (key.name === "j" || key.name === "down") {
        key.preventDefault();
        selectedCommandIndex = (selectedCommandIndex + 1) % commands.length;
        renderCommandPanelView();
        return;
      }

      if (key.name === "k" || key.name === "up") {
        key.preventDefault();
        selectedCommandIndex = (selectedCommandIndex - 1 + commands.length) % commands.length;
        renderCommandPanelView();
        return;
      }

      if (key.name === "enter" || key.name === "return") {
        key.preventDefault();
        const command = commands[selectedCommandIndex];

        closeActivePanel();
        void command?.run();
        return;
      }

      key.preventDefault();
      return;
    }

    if (key.name === "q") {
      key.preventDefault();
      renderer.destroy();
      return;
    }

    if ((key.shift && key.name === "j") || key.name === "J") {
      key.preventDefault();
      void jumpToPane();
      return;
    }

    if (key.name === "m") {
      key.preventDefault();
      cycleMode();
      return;
    }

    if (key.name === "tab") {
      key.preventDefault();
      togglePaneNavigation();
      return;
    }

    if (paneNavigationOpen) {
      if (key.name === "escape" || key.name === "esc") {
        key.preventDefault();
        closePaneNavigation();
        renderCurrentView();
        return;
      }

      if (key.name === "j" || key.name === "down") {
        key.preventDefault();
        selectedPaneId = selectNextPane(selectedSession(), selectedPaneId);
        renderCurrentView();
        return;
      }

      if (key.name === "k" || key.name === "up") {
        key.preventDefault();
        selectedPaneId = selectPreviousPane(selectedSession(), selectedPaneId);
        renderCurrentView();
        return;
      }

      if (key.name === "enter" || key.name === "return") {
        key.preventDefault();
        void focusSelectedPane();
        return;
      }
    }

    if ((key.name === "escape" || key.name === "esc") && sessionNavigationOpen) {
      key.preventDefault();
      resetSelectedSessionToCurrent();
      return;
    }

    if (key.name === "j" || key.name === "down") {
      key.preventDefault();
      if (!sessionNavigationOpen) {
        openSessionNavigation();
        return;
      }

      sessionNavigationOpen = true;
      selectedSessionId = selectNextSession(sessions, selectedSessionId, currentSessionId);
      syncSelectedSessionScroll();
      renderCurrentView();
      return;
    }

    if (key.name === "k" || key.name === "up") {
      key.preventDefault();
      if (!sessionNavigationOpen) {
        openSessionNavigation();
        return;
      }

      sessionNavigationOpen = true;
      selectedSessionId = selectPreviousSession(sessions, selectedSessionId, currentSessionId);
      syncSelectedSessionScroll();
      renderCurrentView();
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      key.preventDefault();
      void focusSelectedSession();
    }
  });
  const refreshStartedAt = benchNow();
  const firstRefreshOk = await refreshSessions({ forceGit: true });
  initialRefreshComplete = true;
  startupBench.add({
    firstRenderMs: startupBench.elapsed(),
    processUptimeAtFirstRenderMs: Math.round(process.uptime() * 10000) / 10,
    refreshSessionsMs: elapsedMs(refreshStartedAt),
    sessionCount: sessions.length,
  });

  if (firstRefreshOk) {
    if (appMode !== "popup") {
      void benchmarkSessionWatcher();
    }

    startRefreshPolling(fallbackRefreshIntervalMs);
    startupBench.log({ ok: true, watcherSkipped: appMode === "popup" });
  } else {
    startupBench.log({ ok: false });
  }

  async function benchmarkSessionWatcher(): Promise<void> {
    if (isDestroyed || sessionWatcher || isStartingWatcher) {
      return;
    }

    const watcherBench = createBenchRun("watcher_startup", { mode: appMode });

    await ensureSessionWatcher();
    watcherBench.log({ watcherMs: watcherBench.elapsed(), ok: Boolean(sessionWatcher) });
  }

  function addSuspendHandler(): void {
    if (suspendHandlerRegistered) {
      return;
    }

    process.on("SIGTSTP", handleSuspend);
    suspendHandlerRegistered = true;
  }

  function removeSuspendHandler(): void {
    if (!suspendHandlerRegistered) {
      return;
    }

    process.off("SIGTSTP", handleSuspend);
    suspendHandlerRegistered = false;
  }

  function handleSuspend(): void {
    removeSuspendHandler();
    renderer.suspend();
    process.kill(process.pid, "SIGTSTP");
  }

  function handleResume(): void {
    addSuspendHandler();
    renderer.resume();
    renderCurrentView();
  }

  async function ensureSessionWatcher(): Promise<void> {
    if (isDestroyed || sessionWatcher || isStartingWatcher) {
      return;
    }

    isStartingWatcher = true;
    try {
      const result = await watchSessions(
        () => {
          void refreshSessions();
        },
        () => {
          sessionWatcher = undefined;
          void pathWatcher?.stop();
          pathWatcher = undefined;
          startRefreshPolling(fallbackRefreshIntervalMs);
        },
        resetSelectedSessionToCurrent,
      );

      if (isDestroyed) {
        if (result.ok === true) {
          await result.watcher.stop();
        }

        return;
      }

      if (result.ok === true) {
        sessionWatcher = result.watcher;
        void ensurePathWatcher();
        startRefreshPolling(safetyRefreshIntervalMs);
      }
    } finally {
      isStartingWatcher = false;
    }
  }

  async function ensurePathWatcher(): Promise<void> {
    if (isDestroyed || pathWatcher || isStartingPathWatcher) {
      return;
    }

    isStartingPathWatcher = true;
    try {
      const result = await watchPanePaths(
        () => {
          void refreshSessions();
        },
        () => {
          pathWatcher = undefined;
        },
      );

      if (isDestroyed) {
        if (result.ok === true) {
          await result.watcher.stop();
        }

        return;
      }

      if (result.ok === true) {
        pathWatcher = result.watcher;
      }
    } finally {
      isStartingPathWatcher = false;
    }
  }

  function startRefreshPolling(intervalMs: number): void {
    if (isDestroyed || refreshTimerIntervalMs === intervalMs) {
      return;
    }

    if (refreshTimer) {
      clearInterval(refreshTimer);
    }

    refreshTimerIntervalMs = intervalMs;

    refreshTimer = setInterval(() => {
      void refreshSessions();

      if (appMode !== "popup" && !sessionWatcher) {
        void benchmarkSessionWatcher();
      } else if (appMode !== "popup" && sessionWatcher && !pathWatcher) {
        void ensurePathWatcher();
      }
    }, intervalMs);
  }

  async function refreshSessions(options: { forceGit?: boolean } = {}): Promise<boolean> {
    if (options.forceGit) {
      nextRefreshForceGit = true;
    }

    if (refreshPromise) {
      refreshQueued = true;

      return refreshPromise;
    }

    refreshPromise = runRefreshSessionsLoop();

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = undefined;
    }
  }

  async function runRefreshSessionsLoop(): Promise<boolean> {
    let ok = true;

    do {
      refreshQueued = false;
      const forceGit = nextRefreshForceGit;
      nextRefreshForceGit = false;
      ok = await refreshSessionsOnce({ forceGit });
    } while (refreshQueued && !isDestroyed);

    return ok;
  }

  async function refreshSessionsOnce(options: { forceGit?: boolean } = {}): Promise<boolean> {
    const result = await listSessions({ forceGit: options.forceGit });

    if (isDestroyed) {
      return result.ok;
    }

    if (result.ok === false) {
      sessions = [];
      selectedSessionId = undefined;
      currentSessionId = undefined;
      closePaneNavigation();
      syncStatusTickTimer();
      screen.setContent(renderMessage(result.message));
      sessionScrollY = 0;
      screen.setContentScrollY(sessionScrollY);
      return false;
    }

    const previousIntegrationStatuses = lastIntegrationStatuses;

    sessions = result.sessions;
    lastIntegrationStatuses = integrationStatuses(sessions);
    const nextCurrentSessionId = resolvedCurrentSessionId();
    const appPaneLostTmuxFocus = Boolean(appPaneId) && !isAttachedActivePane(sessions, appPaneId);

    if (
      currentSessionId !== nextCurrentSessionId ||
      !hasSession(sessions, selectedSessionId) ||
      selectedSessionId === undefined ||
      appPaneLostTmuxFocus
    ) {
      selectedSessionId = nextCurrentSessionId;
      closeSessionNavigation();
    }
    currentSessionId = nextCurrentSessionId;
    syncSelectedPane();

    if (sessions.length === 0) {
      closePaneNavigation();
      syncStatusTickTimer();
      screen.setContent(renderNoSessions());
      sessionScrollY = 0;
      screen.setContentScrollY(sessionScrollY);
      return true;
    }

    syncStatusTickTimer();
    notifyAgentStatusTransitions(previousIntegrationStatuses, sessions);
    renderCurrentView();
    return true;
  }

  function notifyAgentStatusTransitions(
    previousStatuses: Map<string, TmuxPaneIntegrationStatus> | undefined,
    currentSessions: TmuxSession[],
  ): void {
    if (!previousStatuses) {
      return;
    }

    for (const notification of agentStatusNotifications(previousStatuses, currentSessions)) {
      void notifyWhenThudHidden(notification);
    }
  }

  function syncStatusTickTimer(): void {
    if (hasTickingStatus(sessions)) {
      if (statusTickTimer) {
        return;
      }

      statusTickTimer = setInterval(() => {
        if (!isDestroyed && sessions.length > 0) {
          renderCurrentView();
        }
      }, statusTickIntervalMs);
      return;
    }

    if (statusTickTimer) {
      clearInterval(statusTickTimer);
      statusTickTimer = undefined;
    }
  }

  function renderCurrentView(): void {
    renderCurrentSessions();

    if (activePanel === "commands") {
      renderCommandPanelView();
    } else if (activePanel === "help") {
      renderHelpPanelView();
    }
  }

  function renderCurrentSessions(): void {
    if (sessions.length === 0) {
      screen.setContent(renderNoSessions());
      return;
    }

    syncSelectedSessionScroll();
    screen.setContent(
      renderSessions(sessions, selectedSessionId, {
        ...renderTheme,
        highlightSelected: sessionNavigationOpen || paneNavigationOpen,
        now: new Date(),
        selectedPaneId: paneNavigationOpen ? selectedPaneId : undefined,
        width: terminalWidth,
      }),
    );
    screen.setContentScrollY(sessionScrollY);
  }

  function handleSessionListClick(line: number): void {
    if (activePanel !== undefined) {
      return;
    }

    const target = sessionListHitTargetAtLine(sessions, line, terminalWidth);

    if (!target) {
      return;
    }

    selectedSessionId = target.sessionId;
    closeSessionNavigation();
    closePaneNavigation();

    if (target.type === "session") {
      void focusSelectedSession();
      return;
    }

    void focusPane(target.paneId);
  }

  function handleCommandPanelClick(line: number): void {
    if (activePanel !== "commands") {
      return;
    }

    const index = commandPanelIndexAtLine(line, commands.length);

    if (index === undefined) {
      return;
    }

    const command = commands[index];

    selectedCommandIndex = index;
    closeActivePanel();
    void command?.run();
  }

  function handleCommandPanelBackdropClick(): void {
    if (activePanel === undefined) {
      return;
    }

    closeActivePanel();
    renderCurrentView();
  }

  function renderCommandPanelView(): void {
    const width = panelWidth(terminalWidth, commandPanelMaxWidth);
    const contentWidth = Math.max(1, width - commandPanelChromeWidth);

    screen.setCommandPanelWidth(width);
    screen.setCommandPanel(
      renderCommandPanel(commands, selectedCommandIndex, {
        ...renderTheme,
        width: contentWidth,
      }),
    );
  }

  function renderHelpPanelView(): void {
    const width = panelWidth(terminalWidth, helpPanelMaxWidth);
    const contentWidth = Math.max(1, width - commandPanelChromeWidth);

    screen.setCommandPanelWidth(width);
    screen.setCommandPanel(renderHelpPanel({ ...renderTheme, width: contentWidth }));
  }

  function openHelpPanel(): void {
    activePanel = "help";
    screen.setCommandPanelVisible(true);
    renderCurrentView();
  }

  function closeActivePanel(): void {
    activePanel = undefined;
    screen.setCommandPanelVisible(false);
  }

  function isHelpPassthroughKey(key: { name: string; shift: boolean }): boolean {
    return (
      key.name === "q" ||
      key.name === "m" ||
      key.name === "tab" ||
      key.name === "enter" ||
      key.name === "return" ||
      key.name === "j" ||
      key.name === "k" ||
      key.name === "down" ||
      key.name === "up" ||
      (key.shift && key.name === "j") ||
      key.name === "J"
    );
  }

  function cycleMode(): void {
    appMode = appMode === "default" ? "popup" : "default";
    syncModeIndicator(appMode === "default");
  }

  function syncModeIndicator(showDefault = false): void {
    if (defaultModeIndicatorTimer) {
      clearTimeout(defaultModeIndicatorTimer);
      defaultModeIndicatorTimer = undefined;
    }

    if (appMode === "default" && !showDefault) {
      screen.setModeIndicator(undefined);
      return;
    }

    screen.setModeIndicator(appMode);

    if (appMode === "default") {
      defaultModeIndicatorTimer = setTimeout(() => {
        defaultModeIndicatorTimer = undefined;

        if (!isDestroyed && appMode === "default") {
          screen.setModeIndicator(undefined);
        }
      }, defaultModeIndicatorMs);
    }
  }

  function closePaneNavigation(): void {
    paneNavigationOpen = false;
    selectedPaneId = undefined;
  }

  function closeSessionNavigation(): void {
    sessionNavigationOpen = false;
  }

  function openSessionNavigation(): void {
    closePaneNavigation();
    sessionNavigationOpen = true;
    selectedSessionId = findCurrentSessionId(sessions, currentSessionId);
    syncSelectedPane();
    syncSelectedSessionScroll();
    renderCurrentView();
  }

  function togglePaneNavigation(): void {
    if (paneNavigationOpen) {
      closePaneNavigation();
      renderCurrentView();
      return;
    }

    paneNavigationOpen = true;
    closeSessionNavigation();
    selectedPaneId = findActivePaneId(selectedSession());
    renderCurrentView();
  }

  function panelWidth(width: number, maxWidth: number): number {
    return Math.max(1, Math.min(maxWidth, width - commandPanelHorizontalMargin, width));
  }

  function resetSelectedSessionToCurrent(): void {
    const nextSelectedSessionId = resolvedCurrentSessionId();
    const wasSessionNavigationOpen = sessionNavigationOpen;

    closeSessionNavigation();

    if (selectedSessionId === nextSelectedSessionId) {
      if (wasSessionNavigationOpen) {
        renderCurrentView();
      }

      return;
    }

    selectedSessionId = nextSelectedSessionId;
    syncSelectedPane();
    syncSelectedSessionScroll();
    renderCurrentView();
  }

  function resolvedCurrentSessionId(): string | undefined {
    const appPaneSessionId = findSessionIdForPane(sessions, appPaneId);
    const attachedSessionId = findCurrentSessionId(sessions, undefined);
    const previousSessionId = findCurrentSessionId(sessions, currentSessionId);

    if (appMode === "popup") {
      return appPaneSessionId ?? attachedSessionId ?? previousSessionId ?? firstSessionId(sessions);
    }

    return attachedSessionId ?? previousSessionId ?? appPaneSessionId ?? firstSessionId(sessions);
  }

  async function focusSelectedSession(): Promise<void> {
    if (!selectedSessionId) {
      return;
    }

    const session = sessions.find((session) => session.id === selectedSessionId);
    const paneId = findActivePaneId(session);

    if (!paneId) {
      return;
    }

    closeSessionNavigation();
    await focusPane(paneId);
  }

  async function focusSelectedPane(): Promise<void> {
    if (!selectedPaneId) {
      return;
    }

    const paneId = selectedPaneId;

    closePaneNavigation();
    closeSessionNavigation();
    await focusPane(paneId);
  }

  async function jumpToPane(): Promise<void> {
    const paneId = nextJumpPaneId(sessions, appPaneId);

    if (!paneId) {
      return;
    }

    await focusPane(paneId);
  }

  async function focusPane(paneId: string): Promise<void> {
    if (isFocusingPane) {
      return;
    }

    isFocusingPane = true;
    try {
      const result = await focusPaneForAllClients(paneId);

      if (result.ok === false) {
        screen.setContent(renderMessage(result.message));
        sessionScrollY = 0;
        screen.setContentScrollY(sessionScrollY);
        return;
      }

      if (appMode === "popup") {
        renderer.destroy();
        return;
      }

      const optimistic = focusSessionsOptimistically(sessions, paneId);
      if (optimistic.sessionId) {
        sessions = optimistic.sessions;
        selectedSessionId = optimistic.sessionId;
        currentSessionId = optimistic.sessionId;
        syncSelectedPane();
        syncSelectedSessionScroll();
        renderCurrentView();
      }

      await refreshSessions();
    } finally {
      isFocusingPane = false;
    }
  }

  function selectedSession(): TmuxSession | undefined {
    return sessions.find((session) => session.id === selectedSessionId);
  }

  function syncSelectedPane(): void {
    if (!paneNavigationOpen) {
      selectedPaneId = undefined;
      return;
    }

    const session = selectedSession();

    if (!hasPane(session, selectedPaneId)) {
      selectedPaneId = findActivePaneId(session);
    }
  }

  function syncSelectedSessionScroll(): void {
    const range =
      (paneNavigationOpen
        ? paneLineRange(sessions, selectedSessionId, selectedPaneId)
        : undefined) ?? sessionLineRange(sessions, selectedSessionId);

    sessionScrollY = scrollLineRangeIntoView(
      sessionScrollY,
      screen.contentHeight(),
      sessionsLineCount(sessions),
      range,
    );
  }
}

export function hasTickingStatus(sessions: TmuxSession[]): boolean {
  return sessions.some((session) =>
    session.windows.some((window) =>
      window.panes.some(
        (pane) =>
          pane.integration?.status !== "unknown" && pane.integration?.updatedAt !== undefined,
      ),
    ),
  );
}

export function integrationStatuses(
  sessions: TmuxSession[],
): Map<string, TmuxPaneIntegrationStatus> {
  const statuses = new Map<string, TmuxPaneIntegrationStatus>();

  for (const session of sessions) {
    for (const window of session.windows) {
      for (const pane of window.panes) {
        const status = pane.integration?.status;

        if (status) {
          statuses.set(pane.id, status);
        }
      }
    }
  }

  return statuses;
}

export function agentStatusNotifications(
  previousStatuses: Map<string, TmuxPaneIntegrationStatus>,
  sessions: TmuxSession[],
): AgentNotification[] {
  const notifications: AgentNotification[] = [];

  for (const session of sessions) {
    for (const window of session.windows) {
      for (const pane of window.panes) {
        const status = pane.integration?.status;
        const previousStatus = previousStatuses.get(pane.id);

        if (!status || !previousStatus || status === previousStatus) {
          continue;
        }

        if (status === "waiting" && previousStatus !== "waiting") {
          notifications.push({
            title: "Agent needs attention",
            body: `${session.name}: ${paneLabel(window.name, pane.title)} is waiting`,
          });
        } else if (status === "idle" && previousStatus === "running") {
          notifications.push({
            title: "Agent finished",
            body: `${session.name}: ${paneLabel(window.name, pane.title)} is idle`,
          });
        }
      }
    }
  }

  return notifications;
}

function paneLabel(windowName: string, paneTitle: string): string {
  return paneTitle && paneTitle !== windowName ? `${windowName} / ${paneTitle}` : windowName;
}

export function focusSessionsOptimistically(
  sessions: TmuxSession[],
  paneId: string,
): { sessions: TmuxSession[]; sessionId?: string } {
  const targetSession = sessions.find((session) => hasPane(session, paneId));

  if (!targetSession) {
    return { sessions };
  }

  return {
    sessionId: targetSession.id,
    sessions: sessions.map((session) => {
      if (session.id !== targetSession.id) {
        return session;
      }

      return {
        ...session,
        attached: true,
        windows: session.windows.map((window) => {
          const hasTargetPane = window.panes.some((pane) => pane.id === paneId);

          return {
            ...window,
            active: hasTargetPane,
            panes: window.panes.map((pane) => ({
              ...pane,
              active: hasTargetPane && pane.id === paneId,
            })),
          };
        }),
      };
    }),
  };
}
