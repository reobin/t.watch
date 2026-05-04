import { describe, expect, test } from "bun:test";
import {
  findCurrentPaneId,
  firstPaneId,
  hasPane,
  selectNextPane,
  selectPreviousPane,
} from "./navigation";
import type { TmuxSession } from "./tmux";

describe("pane navigation", () => {
  test("selects the pane after the current pane when moving down with no selection", () => {
    const sessions = [session({ panes: [pane("%1"), pane("%2", true), pane("%3")] })];

    expect(selectNextPane(sessions, undefined, "%2")).toBe("%3");
  });

  test("selects the pane before the current pane when moving up with no selection", () => {
    const sessions = [session({ panes: [pane("%1"), pane("%2", true), pane("%3")] })];

    expect(selectPreviousPane(sessions, undefined, "%2")).toBe("%1");
  });

  test("uses the active pane in an attached session when no current pane is known", () => {
    const sessions = [session({ panes: [pane("%1"), pane("%2", true), pane("%3")] })];

    expect(selectNextPane(sessions, undefined, undefined)).toBe("%3");
    expect(selectPreviousPane(sessions, undefined, undefined)).toBe("%1");
  });

  test("wraps when moving from an existing selection", () => {
    const sessions = [session({ panes: [pane("%1"), pane("%2"), pane("%3")] })];

    expect(selectNextPane(sessions, "%3", undefined)).toBe("%1");
    expect(selectPreviousPane(sessions, "%1", undefined)).toBe("%3");
  });

  test("falls back to the list ends when no current pane is available", () => {
    const sessions = [session({ panes: [pane("%1"), pane("%2")], attached: false })];

    expect(selectNextPane(sessions, undefined, undefined)).toBe("%1");
    expect(selectPreviousPane(sessions, undefined, undefined)).toBe("%2");
  });

  test("checks if a pane still exists", () => {
    const sessions = [session({ panes: [pane("%1")] })];

    expect(hasPane(sessions, "%1")).toBe(true);
    expect(hasPane(sessions, "%2")).toBe(false);
    expect(hasPane(sessions, undefined)).toBe(false);
  });

  test("finds the current attached active pane", () => {
    const sessions = [session({ panes: [pane("%1"), pane("%2", true), pane("%3")] })];

    expect(findCurrentPaneId(sessions, undefined)).toBe("%2");
  });

  test("prefers an explicit current pane when it exists", () => {
    const sessions = [session({ panes: [pane("%1"), pane("%2", true), pane("%3")] })];

    expect(findCurrentPaneId(sessions, "%3")).toBe("%3");
  });

  test("finds the first pane in render order", () => {
    const sessions = [session({ panes: [pane("%1"), pane("%2")] })];

    expect(firstPaneId(sessions)).toBe("%1");
    expect(firstPaneId([])).toBeUndefined();
  });
});

function session(input: {
  attached?: boolean;
  panes: TmuxSession["windows"][number]["panes"];
}): TmuxSession {
  return {
    id: "$1",
    name: "work",
    windows: [
      {
        id: "@1",
        index: 1,
        name: "work",
        active: true,
        panes: input.panes,
      },
    ],
    attached: input.attached ?? true,
    sshAttached: false,
    createdAt: new Date(0),
    activityAt: new Date(0),
  };
}

function pane(id: string, active = false): TmuxSession["windows"][number]["panes"][number] {
  return {
    id,
    index: Number(id.slice(1)),
    active,
    command: "bash",
    title: "bash",
    processName: "bash",
    ssh: false,
  };
}
