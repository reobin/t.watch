import { homedir } from "node:os";
import { describe, expect, test } from "bun:test";
import { RGBA, createTextAttributes } from "@opentui/core";
import { renderLoading, renderMessage, renderNoSessions, renderSessions } from "./render";
import type { TmuxSession } from "./tmux";

describe("render", () => {
  test("renders a message", () => {
    expect(renderMessage("Something happened.")).toBe("Something happened.");
  });

  test("renders the loading state", () => {
    expect(renderLoading()).toBe("Loading tmux sessions...");
  });

  test("renders the empty sessions state", () => {
    expect(renderNoSessions()).toBe("No tmux sessions running.");
  });

  test("renders session names", () => {
    const sessions: TmuxSession[] = [
      session({
        name: "work",
        path: "/repo/work",
        gitBranch: "main",
        gitDirty: true,
        attached: true,
        windows: [
          window({
            index: 1,
            name: "node",
            panes: [
              pane({
                processName: "opencode",
                active: true,
                ssh: false,
                integration: { tool: "opencode", status: "working" },
              }),
              pane({ processName: "bash", active: false }),
            ],
          }),
          window({
            index: 2,
            name: "server",
            active: false,
            panes: [pane({ processName: "bun", active: true })],
          }),
        ],
      }),
      session({
        name: "notes",
        attached: true,
        sshAttached: true,
        windows: [window({ name: "vim", panes: [pane({ processName: "vim" })] })],
      }),
    ];
    const output = renderSessions(sessions);

    expect(output.chunks.map((chunk) => chunk.text).join("")).toBe(
      [
        "  work",
        "  · /repo/work",
        "  · main*",
        "  ╭─ opencode ● working",
        "  ╰─ bash",
        "  ╶─ bun",
        "  notes <ssh>",
        "  ╶─ vim",
      ].join("\n"),
    );
    expect(output.chunks.find((chunk) => chunk.text === "work")?.attributes).toBe(
      createTextAttributes({ bold: true }),
    );
    expect(output.chunks.find((chunk) => chunk.text === "notes <ssh>")?.attributes).toBe(
      createTextAttributes({ bold: true }),
    );
    expect(output.chunks.find((chunk) => chunk.text === "notes <ssh>")?.fg?.slot).toBe(5);
    expect(output.chunks.find((chunk) => chunk.text === " opencode")?.attributes).toBe(
      createTextAttributes({ bold: true }),
    );
    expect(output.chunks.find((chunk) => chunk.text === " opencode")?.fg?.slot).toBe(6);
    expect(output.chunks.find((chunk) => chunk.text === "●")?.fg).toBeDefined();
    expect(output.chunks.find((chunk) => chunk.text === "●")?.fg?.intent).toBe("indexed");
    expect(output.chunks.find((chunk) => chunk.text === "●")?.fg?.slot).toBe(6);
    expect(output.chunks.find((chunk) => chunk.text === " working")?.attributes).toBe(0);
    expect(output.chunks.find((chunk) => chunk.text === " working")?.fg?.slot).toBe(8);
    expect(output.chunks.find((chunk) => chunk.text === "work")?.fg).toBeDefined();
    expect(output.chunks.find((chunk) => chunk.text === "work")?.fg?.slot).toBe(6);
    expect(output.chunks.find((chunk) => chunk.text === "· /repo/work")?.attributes).toBe(0);
    expect(output.chunks.find((chunk) => chunk.text === "· main*")?.fg?.slot).toBe(8);
    expect(output.chunks.map((chunk) => chunk.text).join("")).not.toContain("node");
    expect(output.chunks.map((chunk) => chunk.text).join("")).not.toContain("server");
    expect(output.chunks.map((chunk) => chunk.text).join("")).not.toContain("window");
    expect(output.chunks.map((chunk) => chunk.text).join("")).not.toContain("pane");
    expect(output.chunks.map((chunk) => chunk.text).join("")).not.toContain("active");
  });

  test("formats home paths and clean git branches", () => {
    const output = renderSessions([
      session({
        name: "session",
        path: `${homedir()}/dev/thud.sh`,
        gitBranch: "main",
        gitDirty: false,
        windows: [window({ panes: [pane({ processName: "bash" })] })],
      }),
    ]);

    expect(output.chunks.map((chunk) => chunk.text).join("")).toBe(
      ["  session", "  · ~/dev/thud.sh", "  · main", "  ╶─ bash"].join("\n"),
    );
  });

  test("renders integration status markers", () => {
    const output = renderSessions([
      session({
        windows: [
          window({
            panes: [
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "idle" },
              }),
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "working" },
              }),
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "requesting" },
              }),
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "error" },
              }),
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "unknown" },
              }),
            ],
          }),
        ],
      }),
    ]);
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("● idle");
    expect(text).toContain("● working");
    expect(text).toContain("● requesting");
    expect(text).toContain("● error");
    expect(text).toContain("● unknown");
    const markers = output.chunks.filter((chunk) => chunk.text === "●");

    expect(markers).toHaveLength(5);
    expect(markers.map((chunk) => chunk.fg?.intent)).toEqual([
      "indexed",
      "indexed",
      "indexed",
      "indexed",
      "indexed",
    ]);
    expect(markers.map((chunk) => chunk.fg?.slot)).toEqual([2, 6, 5, 1, 8]);
    for (const chunk of markers) {
      expect(chunk.fg).toBeDefined();
    }
  });

  test("renders ssh panes in the ssh color", () => {
    const output = renderSessions([
      session({
        attached: true,
        windows: [
          window({
            panes: [pane({ processName: "ssh", active: true, ssh: true })],
          }),
        ],
      }),
    ]);
    const sshPane = output.chunks.find((chunk) => chunk.text === " ssh");

    expect(sshPane?.attributes).toBe(createTextAttributes({ bold: true }));
    expect(sshPane?.fg?.slot).toBe(5);
  });

  test("renders focused panes under ssh-attached sessions in the ssh color", () => {
    const output = renderSessions([
      session({
        attached: true,
        sshAttached: true,
        windows: [
          window({
            panes: [
              pane({ processName: "bash", active: true, ssh: false }),
              pane({ processName: "zsh", active: false, ssh: false }),
            ],
          }),
        ],
      }),
    ]);
    const paneChunk = output.chunks.find((chunk) => chunk.text === " bash");
    const inactivePaneChunk = output.chunks.find((chunk) => chunk.text === " zsh");

    expect(paneChunk?.attributes).toBe(createTextAttributes({ bold: true }));
    expect(paneChunk?.fg?.slot).toBe(5);
    expect(inactivePaneChunk?.attributes).toBe(0);
    expect(inactivePaneChunk?.fg).toBeUndefined();
  });

  test("renders the selected session as a highlighted block", () => {
    const output = renderSessions(
      [
        session({
          windows: [
            window({
              panes: [
                pane({ id: "%1", processName: "opencode", active: true }),
                pane({ id: "%2" }),
              ],
            }),
          ],
        }),
      ],
      "$1",
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");
    const activePaneChunk = output.chunks.find((chunk) => chunk.text === " opencode");
    const selectedBorderChunk = output.chunks.find((chunk) => chunk.text === "▎ ");
    const selectedSessionPaneChunk = output.chunks.find((chunk) => chunk.text === " bash");
    const selectedBranchChunk = output.chunks.find((chunk) => chunk.text === "╰─");

    expect(text).toContain("▎ ╭─ opencode");
    expect(text).toContain("▎ ╰─ bash");
    expect(text).not.toContain(">");
    expect(selectedBorderChunk?.fg?.slot).toBe(14);
    expect(selectedBorderChunk?.bg?.slot).toBe(235);
    expect(selectedSessionPaneChunk?.fg).toBeUndefined();
    expect(selectedSessionPaneChunk?.bg?.slot).toBe(235);
    expect(selectedBranchChunk?.fg?.slot).toBe(8);
    expect(selectedBranchChunk?.bg?.slot).toBe(235);
    expect(activePaneChunk?.bg?.slot).toBe(235);
    expect(activePaneChunk?.attributes).toBe(0);
  });

  test("keeps selected session highlighting when not actively selecting", () => {
    const output = renderSessions(
      [
        session({
          windows: [window({ panes: [pane({ id: "%1", processName: "opencode" })] })],
        }),
      ],
      "$1",
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");
    const paneChunk = output.chunks.find((chunk) => chunk.text === " opencode");

    expect(text).toContain("▎ ╶─ opencode");
    expect(paneChunk?.bg?.slot).toBe(235);
  });

  test("uses a custom selected session background", () => {
    const selectedBg = RGBA.fromInts(245, 245, 245);
    const output = renderSessions(
      [session({ windows: [window({ panes: [pane({ id: "%1", processName: "opencode" })] })] })],
      "$1",
      { selectedBg },
    );
    const paneChunk = output.chunks.find((chunk) => chunk.text === " opencode");

    expect(paneChunk?.bg?.equals(selectedBg)).toBe(true);
  });

  test("uses a custom muted foreground", () => {
    const textMutedFg = RGBA.fromInts(85, 85, 85);
    const output = renderSessions(
      [
        session({
          path: "/repo/work",
          windows: [
            window({
              panes: [
                pane({
                  processName: "opencode",
                  integration: { tool: "opencode", status: "unknown" },
                }),
              ],
            }),
          ],
        }),
      ],
      undefined,
      { textMutedFg },
    );
    const pathChunk = output.chunks.find((chunk) => chunk.text === "· /repo/work");
    const statusLabelChunk = output.chunks.find((chunk) => chunk.text === " unknown");
    const unknownStatusChunk = output.chunks.find((chunk) => chunk.text === "●");

    expect(pathChunk?.fg?.equals(textMutedFg)).toBe(true);
    expect(statusLabelChunk?.fg?.equals(textMutedFg)).toBe(true);
    expect(unknownStatusChunk?.fg?.equals(textMutedFg)).toBe(true);
  });

  test("keeps session text aligned when selection changes", () => {
    const sessions = [
      session({ windows: [window({ panes: [pane({ id: "%1", processName: "opencode" })] })] }),
    ];
    const unselectedText = renderSessions(sessions)
      .chunks.map((chunk) => chunk.text)
      .join("");
    const selectedText = renderSessions(sessions, "$1")
      .chunks.map((chunk) => chunk.text)
      .join("");

    expect(selectedText.indexOf("opencode")).toBe(unselectedText.indexOf("opencode"));
  });

  test("pads selected session rows to the terminal width", () => {
    const output = renderSessions(
      [session({ windows: [window({ panes: [pane({ id: "%1", processName: "opencode" })] })] })],
      "$1",
      { width: 20 },
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");
    const selectedPaddingChunk = output.chunks.find((chunk) => chunk.text === "       ");

    expect(text).toContain("▎ default           ");
    expect(text).toContain("▎ ╶─ opencode       ");
    expect(selectedPaddingChunk?.bg?.slot).toBe(235);
  });

  test("shows selected session highlighting", () => {
    const output = renderSessions(
      [
        session({
          windows: [window({ panes: [pane({ id: "%1", processName: "opencode" })] })],
        }),
      ],
      "$1",
    );
    const paneChunk = output.chunks.find((chunk) => chunk.text === " opencode");

    expect(paneChunk?.fg).toBeUndefined();
    expect(paneChunk?.bg?.slot).toBe(235);
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
