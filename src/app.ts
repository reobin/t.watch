import { createCliRenderer } from "@opentui/core";
import {
  checkTmux,
  focusPaneForAllClients,
  listSessions,
  watchSessions,
  type TmuxSession,
  type TmuxSessionWatcher,
} from "./tmux";
import { renderLoading, renderMessage, renderNoSessions, renderSessions } from "./render";
import { createScreen } from "./screen";
import { detectRenderTheme } from "./theme";
import {
  findCurrentSessionId,
  firstPaneId,
  firstSessionId,
  hasSession,
  isAttachedActivePane,
  selectNextSession,
  selectPreviousSession,
} from "./navigation";

const refreshIntervalMs = 1500;
const paletteTimeoutMs = 100;
const enableTerminalFocusReporting = "\x1b[?1004h";
const disableTerminalFocusReporting = "\x1b[?1004l";

export async function startApp(): Promise<void> {
  let isDestroyed = false;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let sessionWatcher: TmuxSessionWatcher | undefined;
  let isStartingWatcher = false;
  let isFocusingSession = false;
  let selectedSessionId: string | undefined;
  let currentSessionId: string | undefined;
  let sessions: TmuxSession[] = [];
  let terminalWidth = 0;
  const appPaneId = process.env.TMUX_PANE;

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    onDestroy: () => {
      isDestroyed = true;
      process.stdout.write(disableTerminalFocusReporting);

      if (refreshTimer) {
        clearInterval(refreshTimer);
      }

      void sessionWatcher?.stop();
    },
  });

  process.stdout.write(enableTerminalFocusReporting);
  const renderTheme = await detectRenderTheme(renderer, paletteTimeoutMs);
  const screen = createScreen(renderer, renderLoading(), renderTheme);
  terminalWidth = renderer.width;

  renderer.on("resize", (width) => {
    terminalWidth = width;
    if (sessions.length > 0) {
      renderCurrentSessions();
    }
  });

  renderer.on("blur", () => {
    resetSelectedSessionToCurrent();
  });

  renderer.keyInput.on("keypress", (key) => {
    if (key.ctrl || key.meta) {
      return;
    }

    if (key.name === "j" || key.name === "down") {
      key.preventDefault();
      selectedSessionId = selectNextSession(sessions, selectedSessionId, currentSessionId);
      renderCurrentSessions();
      return;
    }

    if (key.name === "k" || key.name === "up") {
      key.preventDefault();
      selectedSessionId = selectPreviousSession(sessions, selectedSessionId, currentSessionId);
      renderCurrentSessions();
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      key.preventDefault();
      void focusSelectedSession();
    }
  });
  const tmux = await checkTmux();

  if (tmux.ok === true) {
    await ensureSessionWatcher();
    await refreshSessions();
    startRefreshPolling();
  } else {
    screen.setContent(renderMessage(tmux.message));
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
      void ensureSessionWatcher();
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

    if (sessions.length === 0) {
      screen.setContent(renderNoSessions());
      return;
    }

    renderCurrentSessions();
  }

  function renderCurrentSessions(): void {
    if (sessions.length === 0) {
      screen.setContent(renderNoSessions());
      return;
    }

    screen.setContent(
      renderSessions(sessions, selectedSessionId, {
        ...renderTheme,
        width: terminalWidth,
      }),
    );
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
    renderCurrentSessions();
  }

  async function focusSelectedSession(): Promise<void> {
    if (!selectedSessionId || isFocusingSession) {
      return;
    }

    const paneId = firstPaneId(sessions.find((session) => session.id === selectedSessionId));

    if (!paneId) {
      return;
    }

    isFocusingSession = true;
    try {
      const result = await focusPaneForAllClients(paneId);

      if (result.ok === false) {
        screen.setContent(renderMessage(result.message));
        return;
      }

      await refreshSessions();
    } finally {
      isFocusingSession = false;
    }
  }
}
