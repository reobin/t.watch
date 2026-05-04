import { createCliRenderer } from "@opentui/core";
import { checkTmux, listSessions, watchSessions, type TmuxSessionWatcher } from "./tmux";
import { renderLoading, renderMessage, renderNoSessions, renderSessions } from "./render";
import { createScreen } from "./screen";

const refreshIntervalMs = 1500;

export async function startApp(): Promise<void> {
  let isDestroyed = false;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let sessionWatcher: TmuxSessionWatcher | undefined;
  let isStartingWatcher = false;

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
      screen.setContent(renderMessage(result.message));
      return;
    }

    if (result.sessions.length === 0) {
      screen.setContent(renderNoSessions());
      return;
    }

    screen.setContent(renderSessions(result.sessions));
  }
}
