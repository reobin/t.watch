import { createCliRenderer } from "@opentui/core";
import { benchNow, createBenchRun, elapsedMs } from "./benchmark";
import {
  checkTmux,
  focusPaneForAllClients,
  listSessions,
  watchSessions,
  type TmuxSession,
  type TmuxSessionWatcher,
} from "./tmux";
import { renderCommandPanel, renderHelpPanel, type CommandPanelItem } from "./command-panel";
import { renderLoading, renderMessage, renderNoSessions, renderSessions } from "./render";
import { createScreen } from "./screen";
import { detectRenderTheme } from "./theme";
import {
  findCurrentSessionId,
  findActivePaneId,
  firstPaneId,
  firstSessionId,
  hasPane,
  hasSession,
  isAttachedActivePane,
  nextJumpPaneId,
  selectNextPane,
  selectNextSession,
  selectPreviousPane,
  selectPreviousSession,
} from "./navigation";

const refreshIntervalMs = 1500;
const paletteTimeoutMs = 100;
const enableTerminalFocusReporting = "\x1b[?1004h";
const disableTerminalFocusReporting = "\x1b[?1004l";
const commandPanelMaxWidth = 40;
const helpPanelMaxWidth = 72;
const commandPanelHorizontalMargin = 4;
const commandPanelChromeWidth = 4;
const defaultModeIndicatorMs = 1000;

type AppMode = "default" | "popup";

export type AppOptions = {
  closeOnFocus?: boolean;
};

export async function startApp(options: AppOptions = {}): Promise<void> {
  let isDestroyed = false;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let sessionWatcher: TmuxSessionWatcher | undefined;
  let isStartingWatcher = false;
  let isFocusingPane = false;
  let selectedSessionId: string | undefined;
  let currentSessionId: string | undefined;
  let selectedPaneId: string | undefined;
  let paneNavigationOpen = false;
  let sessions: TmuxSession[] = [];
  let terminalWidth = 0;
  let activePanel: "commands" | "help" | undefined;
  let selectedCommandIndex = 0;
  let appMode: AppMode = options.closeOnFocus ? "popup" : "default";
  let defaultModeIndicatorTimer: ReturnType<typeof setTimeout> | undefined;
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
      process.stdout.write(disableTerminalFocusReporting);

      if (refreshTimer) {
        clearInterval(refreshTimer);
      }

      if (defaultModeIndicatorTimer) {
        clearTimeout(defaultModeIndicatorTimer);
      }

      void sessionWatcher?.stop();
    },
  });
  startupBench.add({ rendererMs: elapsedMs(rendererStartedAt) });

  process.stdout.write(enableTerminalFocusReporting);
  const themeStartedAt = benchNow();
  const renderTheme = await detectRenderTheme(renderer, paletteTimeoutMs);
  startupBench.add({ themeMs: elapsedMs(themeStartedAt) });
  const screen = createScreen(renderer, renderLoading(), renderTheme);
  terminalWidth = renderer.width;
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
      run: refreshSessions,
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

  renderer.on("resize", (width) => {
    terminalWidth = width;
    if (sessions.length > 0) {
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

    if (key.name === "j" || key.name === "down") {
      key.preventDefault();
      selectedSessionId = selectNextSession(sessions, selectedSessionId, currentSessionId);
      renderCurrentView();
      return;
    }

    if (key.name === "k" || key.name === "up") {
      key.preventDefault();
      selectedSessionId = selectPreviousSession(sessions, selectedSessionId, currentSessionId);
      renderCurrentView();
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      key.preventDefault();
      void focusSelectedSession();
    }
  });
  const tmuxCheckStartedAt = benchNow();
  const tmux = await checkTmux();
  startupBench.add({ tmuxCheckMs: elapsedMs(tmuxCheckStartedAt) });

  if (tmux.ok === true) {
    const refreshStartedAt = benchNow();
    await refreshSessions();
    startupBench.add({
      firstRenderMs: startupBench.elapsed(),
      processUptimeAtFirstRenderMs: Math.round(process.uptime() * 10000) / 10,
      refreshSessionsMs: elapsedMs(refreshStartedAt),
      sessionCount: sessions.length,
    });

    if (appMode !== "popup") {
      void benchmarkSessionWatcher();
    }

    startRefreshPolling();
    startupBench.log({ ok: true, watcherSkipped: appMode === "popup" });
  } else {
    screen.setContent(renderMessage(tmux.message));
    startupBench.log({ ok: false, message: tmux.message });
  }

  async function benchmarkSessionWatcher(): Promise<void> {
    if (isDestroyed || sessionWatcher || isStartingWatcher) {
      return;
    }

    const watcherBench = createBenchRun("watcher_startup", { mode: appMode });

    await ensureSessionWatcher();
    watcherBench.log({ watcherMs: watcherBench.elapsed(), ok: Boolean(sessionWatcher) });
  }

  async function ensureSessionWatcher(): Promise<void> {
    if (isDestroyed || sessionWatcher || isStartingWatcher) {
      return;
    }

    isStartingWatcher = true;
    try {
      const result = await watchSessions(
        refreshSessions,
        () => {
          sessionWatcher = undefined;
          startRefreshPolling();
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
      }
    } finally {
      isStartingWatcher = false;
    }
  }

  function startRefreshPolling(): void {
    if (isDestroyed || refreshTimer) {
      return;
    }

    refreshTimer = setInterval(() => {
      void refreshSessions();

      if (appMode !== "popup") {
        void benchmarkSessionWatcher();
      }
    }, refreshIntervalMs);
  }

  async function refreshSessions(): Promise<void> {
    const result = await listSessions();

    if (isDestroyed) {
      return;
    }

    if (result.ok === false) {
      sessions = [];
      selectedSessionId = undefined;
      currentSessionId = undefined;
      closePaneNavigation();
      screen.setContent(renderMessage(result.message));
      return;
    }

    sessions = result.sessions;
    const nextCurrentSessionId =
      findCurrentSessionId(sessions, undefined) ?? firstSessionId(sessions);
    const appPaneLostTmuxFocus = Boolean(appPaneId) && !isAttachedActivePane(sessions, appPaneId);

    if (
      currentSessionId !== nextCurrentSessionId ||
      !hasSession(sessions, selectedSessionId) ||
      selectedSessionId === undefined ||
      appPaneLostTmuxFocus
    ) {
      selectedSessionId = nextCurrentSessionId;
    }
    currentSessionId = nextCurrentSessionId;
    syncSelectedPane();

    if (sessions.length === 0) {
      closePaneNavigation();
      screen.setContent(renderNoSessions());
      return;
    }

    renderCurrentView();
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

    screen.setContent(
      renderSessions(sessions, selectedSessionId, {
        ...renderTheme,
        selectedPaneId: paneNavigationOpen ? selectedPaneId : undefined,
        width: terminalWidth,
      }),
    );
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

  function togglePaneNavigation(): void {
    if (paneNavigationOpen) {
      closePaneNavigation();
      renderCurrentView();
      return;
    }

    paneNavigationOpen = true;
    selectedPaneId = findActivePaneId(selectedSession());
    renderCurrentView();
  }

  function panelWidth(width: number, maxWidth: number): number {
    return Math.max(1, Math.min(maxWidth, width - commandPanelHorizontalMargin, width));
  }

  function resetSelectedSessionToCurrent(): void {
    const nextSelectedSessionId =
      findCurrentSessionId(sessions, currentSessionId) ??
      findCurrentSessionId(sessions, undefined) ??
      firstSessionId(sessions);

    if (selectedSessionId === nextSelectedSessionId) {
      return;
    }

    selectedSessionId = nextSelectedSessionId;
    syncSelectedPane();
    renderCurrentView();
  }

  async function focusSelectedSession(): Promise<void> {
    if (!selectedSessionId) {
      return;
    }

    const paneId = firstPaneId(sessions.find((session) => session.id === selectedSessionId));

    if (!paneId) {
      return;
    }

    await focusPane(paneId);
  }

  async function focusSelectedPane(): Promise<void> {
    if (!selectedPaneId) {
      return;
    }

    const paneId = selectedPaneId;

    closePaneNavigation();
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
        return;
      }

      if (appMode === "popup") {
        renderer.destroy();
        return;
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
}
