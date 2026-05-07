import { describe, expect, test } from "bun:test";
import { sessionStatusSummary } from "./integration-status";
import type { TmuxSession } from "./tmux";

describe("integration status", () => {
  test("summarizes the highest priority session status", () => {
    const summary = sessionStatusSummary(
      session({
        windows: [
          window({
            panes: [
              pane({ integration: { tool: "opencode", status: "running" } }),
              pane({ integration: { tool: "opencode", status: "error" } }),
            ],
          }),
          window({
            panes: [
              pane({ integration: { tool: "opencode", status: "idle" } }),
              pane({ integration: { tool: "opencode", status: "waiting" } }),
              pane({ integration: { tool: "opencode", status: "waiting" } }),
            ],
          }),
        ],
      }),
    );

    expect(summary).toEqual({ status: "waiting", count: 2 });
  });

  test("does not summarize running-only sessions", () => {
    const summary = sessionStatusSummary(
      session({
        windows: [
          window({ panes: [pane({ integration: { tool: "opencode", status: "running" } })] }),
        ],
      }),
    );

    expect(summary).toBeUndefined();
  });
});

function session(overrides: Partial<TmuxSession> = {}): TmuxSession {
  return {
    id: "$1",
    name: "default",
    windows: [],
    attached: false,
    sshAttached: false,
    createdAt: new Date(0),
    activityAt: new Date(0),
    ...overrides,
  };
}

function window(overrides: Partial<TmuxSession["windows"][number]> = {}) {
  return {
    id: "@1",
    index: 1,
    name: "default",
    active: true,
    panes: [],
    ...overrides,
  };
}

function pane(overrides: Partial<TmuxSession["windows"][number]["panes"][number]> = {}) {
  return {
    id: "%1",
    index: 1,
    active: true,
    command: "bash",
    title: "bash",
    processName: "bash",
    ssh: false,
    ...overrides,
  };
}
