import { paneContextTitle } from "./pane-display";
import type { TmuxSession } from "./tmux";

export type SessionListHitTarget =
  | { type: "session"; sessionId: string }
  | { type: "pane"; paneId: string; sessionId: string };

export function sessionListHitTargetAtLine(
  sessions: TmuxSession[],
  line: number,
  width?: number,
): SessionListHitTarget | undefined {
  return sessionListHitTargets(sessions, width)[line];
}

export function sessionListHitTargets(
  sessions: TmuxSession[],
  width?: number,
): (SessionListHitTarget | undefined)[] {
  const targets: (SessionListHitTarget | undefined)[] = [];

  sessions.forEach((session, sessionIndex) => {
    if (sessionIndex > 0) {
      targets.push(undefined);
    }

    const sessionTarget = { type: "session", sessionId: session.id } as const;

    targets.push(sessionTarget);

    if (rendersSessionMetadata(session, width)) {
      targets.push(sessionTarget);
    }

    const showWindowLabels = session.windows.length > 1;

    session.windows.forEach((window) => {
      if (showWindowLabels) {
        targets.push(sessionTarget);
      }

      window.panes.forEach((pane) => {
        const paneTarget = { type: "pane", sessionId: session.id, paneId: pane.id } as const;

        targets.push(paneTarget);

        if (paneContextTitle(pane)) {
          targets.push(paneTarget);
        }
      });
    });
  });

  return targets;
}

function rendersSessionMetadata(session: TmuxSession, width: number | undefined): boolean {
  return Boolean(session.gitBranch) && (width === undefined || width > 4);
}

export function commandPanelIndexAtLine(line: number, commandCount: number): number | undefined {
  const index = line - 2;

  return index >= 0 && index < commandCount ? index : undefined;
}
