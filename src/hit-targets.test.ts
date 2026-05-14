import { describe, expect, test } from "bun:test";
import { commandPanelIndexAtLine, sessionListHitTargets } from "./hit-targets";
import type { TmuxPane, TmuxSession } from "./tmux";

describe("hit targets", () => {
  test("maps rendered session rows to clickable targets", () => {
    const targets = sessionListHitTargets([
      session("$1", {
        gitBranch: "main",
        panes: [pane("%1", { processName: "opencode", title: "OC | Implement mouse" })],
      }),
      session("$2", {
        windows: [
          { id: "@2", index: 1, name: "app", active: true, panes: [pane("%2")] },
          { id: "@3", index: 2, name: "server", active: false, panes: [pane("%3")] },
        ],
      }),
    ]);

    expect(targets).toEqual([
      { type: "session", sessionId: "$1" },
      { type: "session", sessionId: "$1" },
      { type: "pane", sessionId: "$1", paneId: "%1" },
      { type: "pane", sessionId: "$1", paneId: "%1" },
      undefined,
      { type: "session", sessionId: "$2" },
      { type: "session", sessionId: "$2" },
      { type: "pane", sessionId: "$2", paneId: "%2" },
      { type: "session", sessionId: "$2" },
      { type: "pane", sessionId: "$2", paneId: "%3" },
    ]);
  });

  test("omits branch targets when narrow rendering hides the branch row", () => {
    const targets = sessionListHitTargets(
      [
        session("$1", {
          gitBranch: "main",
          panes: [pane("%1")],
        }),
      ],
      4,
    );

    expect(targets).toEqual([
      { type: "session", sessionId: "$1" },
      { type: "pane", sessionId: "$1", paneId: "%1" },
    ]);
  });

  test("maps command panel rows to command indexes", () => {
    expect(commandPanelIndexAtLine(-1, 2)).toBeUndefined();
    expect(commandPanelIndexAtLine(0, 2)).toBeUndefined();
    expect(commandPanelIndexAtLine(1, 2)).toBeUndefined();
    expect(commandPanelIndexAtLine(2, 2)).toBe(0);
    expect(commandPanelIndexAtLine(3, 2)).toBe(1);
    expect(commandPanelIndexAtLine(4, 2)).toBeUndefined();
  });
});

function session(
  id: string,
  options: {
    gitBranch?: string;
    panes?: TmuxPane[];
    windows?: TmuxSession["windows"];
  } = {},
): TmuxSession {
  return {
    id,
    name: id,
    windows: options.windows ?? [window({ panes: options.panes ?? [pane("%1")] })],
    attached: false,
    sshAttached: false,
    createdAt: new Date(0),
    activityAt: new Date(0),
    ...(options.gitBranch ? { gitBranch: options.gitBranch } : {}),
  };
}

function window(options: { panes: TmuxPane[] }): TmuxSession["windows"][number] {
  return {
    id: "@1",
    index: 1,
    name: "work",
    active: true,
    panes: options.panes,
  };
}

function pane(id: string, options: Partial<TmuxPane> = {}): TmuxPane {
  return {
    id,
    index: Number(id.slice(1)),
    active: false,
    command: options.command ?? "bash",
    title: options.title ?? "bash",
    processName: options.processName ?? "bash",
    ssh: options.ssh ?? false,
    ...(options.integration ? { integration: options.integration } : {}),
  };
}
