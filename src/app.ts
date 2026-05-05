import { RGBA, createCliRenderer, type CliRenderer, type TerminalColors } from "@opentui/core";
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
  findCurrentSessionId,
  firstPaneId,
  firstSessionId,
  hasSession,
  selectNextSession,
  selectPreviousSession,
} from "./navigation";

const refreshIntervalMs = 1500;
const paletteTimeoutMs = 100;
const selectedBgBlend = 0.08;

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
  const selectedBg = await detectSelectedBackground(renderer);
  terminalWidth = renderer.width;

  renderer.on("resize", (width) => {
    terminalWidth = width;
    if (sessions.length > 0) {
      renderCurrentSessions();
    }
  });

  renderer.keyInput.on("keypress", (key) => {
    if (key.ctrl || key.meta) {
      return;
    }

    if (key.name === "j") {
      key.preventDefault();
      selectedSessionId = selectNextSession(sessions, selectedSessionId, currentSessionId);
      renderCurrentSessions();
      return;
    }

    if (key.name === "k") {
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
      selectedSessionId = undefined;
      currentSessionId = undefined;
      screen.setContent(renderMessage(result.message));
      return;
    }

    sessions = result.sessions;
    const nextCurrentSessionId =
      findCurrentSessionId(sessions, undefined) ?? firstSessionId(sessions);
    if (
      currentSessionId !== nextCurrentSessionId ||
      !hasSession(sessions, selectedSessionId) ||
      selectedSessionId === undefined
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
        selectedBg,
        width: terminalWidth,
      }),
    );
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

async function detectSelectedBackground(renderer: CliRenderer): Promise<RGBA> {
  const colors = await renderer
    .getPalette({ timeout: paletteTimeoutMs })
    .catch((): TerminalColors | undefined => undefined);
  const selectedBg = colors && selectedBackgroundFromTerminal(colors);

  if (selectedBg) {
    return selectedBg;
  }

  const themeMode = renderer.themeMode ?? (await renderer.waitForThemeMode(paletteTimeoutMs));

  return RGBA.fromIndex(themeMode === "light" ? 254 : 235);
}

function selectedBackgroundFromTerminal(colors: TerminalColors): RGBA | undefined {
  if (!colors.defaultBackground || !colors.defaultForeground) {
    return undefined;
  }

  const foreground = RGBA.fromHex(colors.defaultForeground);
  const background = RGBA.fromHex(colors.defaultBackground);
  const [foregroundRed, foregroundGreen, foregroundBlue] = foreground.toInts();
  const [backgroundRed, backgroundGreen, backgroundBlue] = background.toInts();

  return RGBA.fromInts(
    blendColor(backgroundRed, foregroundRed),
    blendColor(backgroundGreen, foregroundGreen),
    blendColor(backgroundBlue, foregroundBlue),
  );
}

function blendColor(base: number, overlay: number): number {
  return Math.round(base + (overlay - base) * selectedBgBlend);
}
