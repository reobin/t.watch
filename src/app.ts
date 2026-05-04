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
import {
  findCurrentPaneId,
  firstPaneId,
  hasPane,
  selectNextPane,
  selectPreviousPane,
} from "./navigation";

const refreshIntervalMs = 1500;

export async function startApp(): Promise<void> {
  let isDestroyed = false;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let sessionWatcher: TmuxSessionWatcher | undefined;
  let isStartingWatcher = false;
  let isFocusingPane = false;
  let selectedPaneId: string | undefined;
  let isSelectingPane = false;
  let currentPaneId: string | undefined;
  let sessions: TmuxSession[] = [];

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    onDestroy: () => {
      isDestroyed = true;

      if (refreshTimer) {
        clearInterval(refreshTimer);
      }

      void sessionWatcher?.stop();
    },
  });

  const screen = createScreen(renderer, renderLoading());
  renderer.keyInput.on("keypress", (key) => {
    if (key.ctrl || key.meta) {
      return;
    }

    if (key.name === "j") {
      key.preventDefault();
      selectedPaneId = selectNextPane(sessions, selectedPaneId, currentPaneId);
      isSelectingPane = true;
      renderCurrentSessions();
      return;
    }

    if (key.name === "k") {
      key.preventDefault();
      selectedPaneId = selectPreviousPane(sessions, selectedPaneId, currentPaneId);
      isSelectingPane = true;
      renderCurrentSessions();
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      key.preventDefault();
      void focusSelectedPane();
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
      const result = await watchSessions(refreshSessions, () => {
        sessionWatcher = undefined;
        startRefreshPolling();
      });

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
      selectedPaneId = undefined;
      isSelectingPane = false;
      currentPaneId = undefined;
      screen.setContent(renderMessage(result.message));
      return;
    }

    sessions = result.sessions;
    const nextCurrentPaneId = findCurrentPaneId(sessions, undefined) ?? firstPaneId(sessions);
    if (
      currentPaneId !== nextCurrentPaneId ||
      !hasPane(sessions, selectedPaneId) ||
      selectedPaneId === undefined
    ) {
      selectedPaneId = nextCurrentPaneId;
      isSelectingPane = false;
    }
    currentPaneId = nextCurrentPaneId;

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

    screen.setContent(renderSessions(sessions, selectedPaneId, isSelectingPane));
  }

  async function focusSelectedPane(): Promise<void> {
    if (!selectedPaneId || isFocusingPane) {
      return;
    }

    isFocusingPane = true;
    try {
      const result = await focusPaneForAllClients(selectedPaneId);

      if (result.ok === false) {
        screen.setContent(renderMessage(result.message));
        return;
      }

      isSelectingPane = false;
      await refreshSessions();
    } finally {
      isFocusingPane = false;
    }
  }
}
