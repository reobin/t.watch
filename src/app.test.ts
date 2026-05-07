import { describe, expect, test } from "bun:test";
import { focusSessionsOptimistically, hasTickingStatus } from "./app";
import type { TmuxPaneIntegrationStatus, TmuxSession } from "./tmux";

describe("app", () => {
  test("ticks when a non-unknown integration status has a timestamp", () => {
    expect(
      hasTickingStatus([
        session({
          status: "waiting",
          updatedAt: new Date("2026-05-07T12:00:00.000Z"),
        }),
      ]),
    ).toBe(true);
  });

  test("does not tick without visible elapsed statuses", () => {
    expect(hasTickingStatus([session({ status: "waiting" })])).toBe(false);
    expect(
      hasTickingStatus([
        session({
          status: "unknown",
          updatedAt: new Date("2026-05-07T12:00:00.000Z"),
        }),
      ]),
    ).toBe(false);
    expect(hasTickingStatus([session()])).toBe(false);
  });

  test("optimistically focuses a target pane without clearing other attached sessions", () => {
    const otherSession = session({ id: "$1", paneId: "%1", attached: true, active: true });
    const targetSession = session({
      id: "$2",
      paneId: "%2",
      siblingPaneId: "%3",
      attached: false,
      active: false,
      siblingActive: true,
    });

    const result = focusSessionsOptimistically([otherSession, targetSession], "%2");

    expect(result.sessionId).toBe("$2");
    expect(result.sessions[0]?.attached).toBe(true);
    expect(result.sessions[0]?.windows[0]?.panes[0]?.active).toBe(true);
    expect(result.sessions[1]?.attached).toBe(true);
    expect(result.sessions[1]?.windows[0]?.active).toBe(true);
    expect(result.sessions[1]?.windows[0]?.panes[0]?.active).toBe(true);
    expect(result.sessions[1]?.windows[0]?.panes[1]?.active).toBe(false);
  });

  test("leaves sessions unchanged when optimistic focus target is missing", () => {
    const sessions = [session({ id: "$1", paneId: "%1" })];

    expect(focusSessionsOptimistically(sessions, "%9")).toEqual({ sessions });
  });
});

function session(
  options: {
    active?: boolean;
    attached?: boolean;
    id?: string;
    paneId?: string;
    siblingActive?: boolean;
    siblingPaneId?: string;
    status?: TmuxPaneIntegrationStatus;
    updatedAt?: Date;
  } = {},
): TmuxSession {
  return {
    id: options.id ?? "$1",
    name: "default",
    windows: [
      {
        id: "@1",
        index: 1,
        name: "default",
        active: options.active ?? true,
        panes: [
          {
            id: options.paneId ?? "%1",
            index: 1,
            active: options.active ?? true,
            command: "bash",
            title: "bash",
            processName: "bash",
            ssh: false,
            ...(options.status
              ? {
                  integration: {
                    tool: "opencode",
                    status: options.status,
                    ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
                  },
                }
              : {}),
          },
          ...(options.siblingPaneId
            ? [
                {
                  id: options.siblingPaneId,
                  index: 2,
                  active: options.siblingActive ?? false,
                  command: "bash",
                  title: "bash",
                  processName: "bash",
                  ssh: false,
                },
              ]
            : []),
        ],
      },
    ],
    attached: options.attached ?? false,
    sshAttached: false,
    createdAt: new Date(0),
    activityAt: new Date(0),
  };
}
