import type { TmuxPaneIntegrationStatus, TmuxSession } from "./tmux";

const attentionStatusPriority = [
  "requesting",
  "idle",
  "working",
] as const satisfies readonly TmuxPaneIntegrationStatus[];

export function selectNextSession(
  sessions: TmuxSession[],
  selectedSessionId: string | undefined,
  currentSessionId: string | undefined,
): string | undefined {
  return selectSession(
    sessions,
    selectedSessionId ?? findCurrentSessionId(sessions, currentSessionId),
    1,
  );
}

export function selectPreviousSession(
  sessions: TmuxSession[],
  selectedSessionId: string | undefined,
  currentSessionId: string | undefined,
): string | undefined {
  return selectSession(
    sessions,
    selectedSessionId ?? findCurrentSessionId(sessions, currentSessionId),
    -1,
  );
}

export function hasSession(sessions: TmuxSession[], sessionId: string | undefined): boolean {
  return Boolean(sessionId && sessions.some((session) => session.id === sessionId));
}

export function findCurrentSessionId(
  sessions: TmuxSession[],
  currentSessionId: string | undefined,
): string | undefined {
  if (hasSession(sessions, currentSessionId)) {
    return currentSessionId;
  }

  return sessions.find((session) => session.attached)?.id;
}

export function firstSessionId(sessions: TmuxSession[]): string | undefined {
  return sessions[0]?.id;
}

export function firstPaneId(session: TmuxSession | undefined): string | undefined {
  return session?.windows[0]?.panes[0]?.id;
}

export function nextAttentionPaneId(
  sessions: TmuxSession[],
  currentPaneId?: string,
): string | undefined {
  const panes = sessions.flatMap((session) =>
    session.windows.flatMap((window) => window.panes.map((pane) => pane)),
  );

  if (panes.length === 0) {
    return undefined;
  }

  const resolvedCurrentPaneId = currentPaneId ?? currentAttachedActivePaneId(sessions);
  const currentIndex = resolvedCurrentPaneId
    ? panes.findIndex((pane) => pane.id === resolvedCurrentPaneId)
    : -1;

  for (const status of attentionStatusPriority) {
    const pane = orderedAfterCurrent(panes, currentIndex).find(
      (pane) => pane.integration?.status === status,
    );

    if (pane) {
      return pane.id;
    }
  }

  return undefined;
}

export function isAttachedActivePane(sessions: TmuxSession[], paneId: string | undefined): boolean {
  if (!paneId) {
    return false;
  }

  return sessions.some(
    (session) =>
      session.attached &&
      session.windows.some(
        (window) => window.active && window.panes.some((pane) => pane.id === paneId && pane.active),
      ),
  );
}

function currentAttachedActivePaneId(sessions: TmuxSession[]): string | undefined {
  for (const session of sessions) {
    if (!session.attached) {
      continue;
    }

    for (const window of session.windows) {
      if (!window.active) {
        continue;
      }

      const pane = window.panes.find((pane) => pane.active);

      if (pane) {
        return pane.id;
      }
    }
  }

  return undefined;
}

function orderedAfterCurrent<T>(items: T[], currentIndex: number): T[] {
  if (currentIndex < 0) {
    return items;
  }

  return [...items.slice(currentIndex + 1), ...items.slice(0, currentIndex)];
}

function selectSession(
  sessions: TmuxSession[],
  sessionId: string | undefined,
  direction: 1 | -1,
): string | undefined {
  const sessionIds = sessions.map((session) => session.id);

  if (sessionIds.length === 0) {
    return undefined;
  }

  const index = sessionId ? sessionIds.indexOf(sessionId) : -1;

  if (index === -1) {
    return direction === 1 ? sessionIds[0] : sessionIds[sessionIds.length - 1];
  }

  return sessionIds[(index + direction + sessionIds.length) % sessionIds.length];
}
