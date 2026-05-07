import { describe, expect, test } from "bun:test";
import { hasTickingStatus } from "./app";
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
});

function session(
  integration: { status?: TmuxPaneIntegrationStatus; updatedAt?: Date } = {},
): TmuxSession {
  return {
    id: "$1",
    name: "default",
    windows: [
      {
        id: "@1",
        index: 1,
        name: "default",
        active: true,
        panes: [
          {
            id: "%1",
            index: 1,
            active: true,
            command: "bash",
            title: "bash",
            processName: "bash",
            ssh: false,
            ...(integration.status
              ? {
                  integration: {
                    tool: "opencode",
                    status: integration.status,
                    ...(integration.updatedAt ? { updatedAt: integration.updatedAt } : {}),
                  },
                }
              : {}),
          },
        ],
      },
    ],
    attached: false,
    sshAttached: false,
    createdAt: new Date(0),
    activityAt: new Date(0),
  };
}
