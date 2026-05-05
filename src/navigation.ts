import type { TmuxSession } from "./tmux";

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
