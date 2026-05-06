import { describe, expect, test } from "bun:test";
import {
  findCurrentSessionId,
  firstPaneId,
  firstSessionId,
  hasSession,
  isAttachedActivePane,
  nextAttentionPaneId,
  selectNextSession,
  selectPreviousSession,
} from "./navigation";
import type { TmuxPaneIntegrationStatus, TmuxSession } from "./tmux";

describe("session navigation", () => {
  test("selects the session after the current session when moving down with no selection", () => {
    const sessions = [session("$1"), session("$2", { attached: true }), session("$3")];

    expect(selectNextSession(sessions, undefined, "$2")).toBe("$3");
  });

  test("selects the session before the current session when moving up with no selection", () => {
    const sessions = [session("$1"), session("$2", { attached: true }), session("$3")];

    expect(selectPreviousSession(sessions, undefined, "$2")).toBe("$1");
  });

  test("uses the attached session when no current session is known", () => {
    const sessions = [session("$1"), session("$2", { attached: true }), session("$3")];

    expect(selectNextSession(sessions, undefined, undefined)).toBe("$3");
    expect(selectPreviousSession(sessions, undefined, undefined)).toBe("$1");
  });

  test("wraps when moving from an existing selection", () => {
    const sessions = [session("$1"), session("$2"), session("$3")];

    expect(selectNextSession(sessions, "$3", undefined)).toBe("$1");
    expect(selectPreviousSession(sessions, "$1", undefined)).toBe("$3");
  });

  test("falls back to the list ends when no current session is available", () => {
    const sessions = [session("$1"), session("$2")];

    expect(selectNextSession(sessions, undefined, undefined)).toBe("$1");
    expect(selectPreviousSession(sessions, undefined, undefined)).toBe("$2");
  });

  test("checks if a session still exists", () => {
    const sessions = [session("$1")];

    expect(hasSession(sessions, "$1")).toBe(true);
    expect(hasSession(sessions, "$2")).toBe(false);
    expect(hasSession(sessions, undefined)).toBe(false);
  });

  test("finds the current attached session", () => {
    const sessions = [session("$1"), session("$2", { attached: true }), session("$3")];

    expect(findCurrentSessionId(sessions, undefined)).toBe("$2");
  });

  test("prefers an explicit current session when it exists", () => {
    const sessions = [session("$1"), session("$2", { attached: true }), session("$3")];

    expect(findCurrentSessionId(sessions, "$3")).toBe("$3");
  });

  test("finds the first session in render order", () => {
    const sessions = [session("$1"), session("$2")];

    expect(firstSessionId(sessions)).toBe("$1");
    expect(firstSessionId([])).toBeUndefined();
  });

  test("finds the first pane in the first window", () => {
    expect(firstPaneId(session("$1", { paneIds: ["%1", "%2"] }))).toBe("%1");
    expect(firstPaneId(session("$1", { paneIds: [] }))).toBeUndefined();
    expect(firstPaneId(undefined)).toBeUndefined();
  });

  test("checks if a pane is active in the attached session", () => {
    const sessions = [session("$1", { attached: true, activePaneId: "%1" })];

    expect(isAttachedActivePane(sessions, "%1")).toBe(true);
    expect(isAttachedActivePane(sessions, "%2")).toBe(false);
    expect(isAttachedActivePane(sessions, undefined)).toBe(false);
  });

  test("does not treat active panes in detached or inactive windows as attached active", () => {
    expect(isAttachedActivePane([session("$1", { activePaneId: "%1" })], "%1")).toBe(false);
    expect(
      isAttachedActivePane(
        [session("$1", { attached: true, activePaneId: "%1", windowActive: false })],
        "%1",
      ),
    ).toBe(false);
  });

  test("finds the next requesting pane after the current pane", () => {
    const sessions = [
      session("$1", {
        activePaneId: "%1",
        attached: true,
        paneStatuses: { "%2": "idle", "%3": "requesting" },
        paneIds: ["%1", "%2", "%3"],
      }),
    ];

    expect(nextAttentionPaneId(sessions)).toBe("%3");
  });

  test("falls back to idle then working panes", () => {
    expect(
      nextAttentionPaneId([
        session("$1", {
          activePaneId: "%1",
          attached: true,
          paneStatuses: { "%2": "working", "%3": "idle" },
          paneIds: ["%1", "%2", "%3"],
        }),
      ]),
    ).toBe("%3");

    expect(
      nextAttentionPaneId([
        session("$1", {
          activePaneId: "%1",
          attached: true,
          paneStatuses: { "%2": "working" },
          paneIds: ["%1", "%2"],
        }),
      ]),
    ).toBe("%2");
  });

  test("wraps when finding an attention pane", () => {
    const sessions = [
      session("$1", {
        activePaneId: "%3",
        attached: true,
        paneStatuses: { "%1": "requesting" },
        paneIds: ["%1", "%2", "%3"],
      }),
    ];

    expect(nextAttentionPaneId(sessions)).toBe("%1");
  });

  test("skips the current pane when finding attention panes", () => {
    const sessions = [
      session("$1", {
        activePaneId: "%1",
        attached: true,
        paneStatuses: { "%1": "requesting", "%2": "idle" },
        paneIds: ["%1", "%2"],
      }),
    ];

    expect(nextAttentionPaneId(sessions)).toBe("%2");
  });

  test("uses an explicit current pane before falling back to the first attached active pane", () => {
    const sessions = [
      session("$1", {
        activePaneId: "%1",
        attached: true,
        paneStatuses: { "%2": "requesting" },
        paneIds: ["%1", "%2"],
      }),
      session("$2", {
        activePaneId: "%4",
        attached: true,
        paneStatuses: { "%5": "requesting" },
        paneIds: ["%3", "%4", "%5"],
      }),
    ];

    expect(nextAttentionPaneId(sessions, "%4")).toBe("%5");
  });

  test("returns undefined without an attention pane", () => {
    expect(
      nextAttentionPaneId([
        session("$1", {
          activePaneId: "%1",
          attached: true,
          paneStatuses: { "%2": "error", "%3": "unknown" },
          paneIds: ["%1", "%2", "%3"],
        }),
      ]),
    ).toBeUndefined();
  });
});

function session(
  id: string,
  input: {
    activePaneId?: string;
    attached?: boolean;
    paneStatuses?: Partial<Record<string, TmuxPaneIntegrationStatus>>;
    paneIds?: string[];
    windowActive?: boolean;
  } = {},
): TmuxSession {
  return {
    id,
    name: id,
    windows: [
      {
        id: "@1",
        index: 1,
        name: "work",
        active: input.windowActive ?? true,
        panes: (input.paneIds ?? ["%1"]).map((id) =>
          pane(id, id === input.activePaneId, input.paneStatuses?.[id]),
        ),
      },
    ],
    attached: input.attached ?? false,
    sshAttached: false,
    createdAt: new Date(0),
    activityAt: new Date(0),
  };
}

function pane(
  id: string,
  active = false,
  status?: TmuxPaneIntegrationStatus,
): TmuxSession["windows"][number]["panes"][number] {
  return {
    id,
    index: Number(id.slice(1)),
    active,
    command: "bash",
    title: "bash",
    processName: "bash",
    ssh: false,
    ...(status ? { integration: { tool: "opencode", status } } : {}),
  };
}
