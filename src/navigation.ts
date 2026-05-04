import type { TmuxSession } from "./tmux";

export function selectNextPane(
  sessions: TmuxSession[],
  selectedPaneId: string | undefined,
  currentPaneId: string | undefined,
): string | undefined {
  return selectPane(sessions, selectedPaneId ?? findCurrentPaneId(sessions, currentPaneId), 1);
}

export function selectPreviousPane(
  sessions: TmuxSession[],
  selectedPaneId: string | undefined,
  currentPaneId: string | undefined,
): string | undefined {
  return selectPane(sessions, selectedPaneId ?? findCurrentPaneId(sessions, currentPaneId), -1);
}

export function hasPane(sessions: TmuxSession[], paneId: string | undefined): boolean {
  if (!paneId) {
    return false;
  }

  return sessions.some((session) =>
    session.windows.some((window) => window.panes.some((pane) => pane.id === paneId)),
  );
}

export function findCurrentPaneId(
  sessions: TmuxSession[],
  currentPaneId: string | undefined,
): string | undefined {
  if (hasPane(sessions, currentPaneId)) {
    return currentPaneId;
  }

  for (const session of sessions) {
    if (!session.attached) {
      continue;
    }

    for (const window of session.windows) {
      if (!window.active) {
        continue;
      }

      const activePane = window.panes.find((pane) => pane.active);
      if (activePane) {
        return activePane.id;
      }
    }
  }

  return undefined;
}

export function firstPaneId(sessions: TmuxSession[]): string | undefined {
  for (const session of sessions) {
    for (const window of session.windows) {
      const pane = window.panes[0];
      if (pane) {
        return pane.id;
      }
    }
  }

  return undefined;
}

function selectPane(
  sessions: TmuxSession[],
  paneId: string | undefined,
  direction: 1 | -1,
): string | undefined {
  const paneIds = sessions.flatMap((session) =>
    session.windows.flatMap((window) => window.panes.map((pane) => pane.id)),
  );

  if (paneIds.length === 0) {
    return undefined;
  }

  const index = paneId ? paneIds.indexOf(paneId) : -1;

  if (index === -1) {
    return direction === 1 ? paneIds[0] : paneIds[paneIds.length - 1];
  }

  return paneIds[(index + direction + paneIds.length) % paneIds.length];
}
