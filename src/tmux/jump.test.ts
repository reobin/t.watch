import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { jumpToNextPane } from "./jump";

const originalTmuxPane = process.env.TMUX_PANE;
const separator = "\x1f";
const paneFormat = [
  "#{pane_id}",
  "#{pane_active}",
  "#{window_active}",
  "#{session_attached}",
  "#{@thud_sh_tool}",
  "#{@thud_sh_status}",
].join(separator);
const clientFormat = ["#{client_name}", "#{client_tty}"].join(separator);

describe("jumpToNextPane", () => {
  afterEach(() => {
    mock.restore();

    if (originalTmuxPane === undefined) {
      delete process.env.TMUX_PANE;
      return;
    }

    process.env.TMUX_PANE = originalTmuxPane;
  });

  test("uses the current client when a reliable current pane is provided", async () => {
    delete process.env.TMUX_PANE;
    const calls = mockTmuxResults([
      {
        exitCode: 0,
        stdout: paneLines([
          ["%1", true, true, true, "waiting"],
          ["%4", true, true, true],
          ["%5", false, true, true, "waiting"],
        ]),
      },
      { exitCode: 0 },
    ]);

    await expect(jumpToNextPane("%4")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      ["tmux", "list-panes", "-a", "-F", paneFormat],
      ["tmux", "switch-client", "-t", "%5"],
    ]);
  });

  test("uses all clients when the current pane is only a fallback", async () => {
    delete process.env.TMUX_PANE;
    const calls = mockTmuxResults([
      {
        exitCode: 0,
        stdout: paneLines([
          ["%1", true, true, true],
          ["%2", false, true, true, "waiting"],
        ]),
      },
      { exitCode: 0, stdout: `client-a${separator}/dev/pts/1\n` },
      { exitCode: 0 },
    ]);

    await expect(jumpToNextPane()).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      ["tmux", "list-panes", "-a", "-F", paneFormat],
      ["tmux", "list-clients", "-F", clientFormat],
      ["tmux", "switch-client", "-c", "client-a", "-t", "%2"],
    ]);
  });

  test("ignores panes with status but no integration tool", async () => {
    delete process.env.TMUX_PANE;
    const calls = mockTmuxResults([
      {
        exitCode: 0,
        stdout: paneLines([
          ["%1", true, true, true],
          ["%2", false, true, true, "waiting", ""],
        ]),
      },
    ]);

    await expect(jumpToNextPane("%1")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([["tmux", "list-panes", "-a", "-F", paneFormat]]);
  });

  test("supports any integration tool", async () => {
    delete process.env.TMUX_PANE;
    const calls = mockTmuxResults([
      {
        exitCode: 0,
        stdout: paneLines([
          ["%1", true, true, true],
          ["%2", false, true, true, "waiting", "codex"],
        ]),
      },
      { exitCode: 0 },
    ]);

    await expect(jumpToNextPane("%1")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      ["tmux", "list-panes", "-a", "-F", paneFormat],
      ["tmux", "switch-client", "-t", "%2"],
    ]);
  });
});

function paneLines(panes: [string, boolean, boolean, boolean, string?, string?][]): string {
  return `${panes
    .map(([id, active, windowActive, sessionAttached, status, tool]) =>
      [
        id,
        Number(active),
        Number(windowActive),
        Number(sessionAttached),
        tool ?? (status ? "opencode" : ""),
        status ?? "",
      ].join(separator),
    )
    .join("\n")}\n`;
}

function mockTmuxResults(
  results: { exitCode: number; stderr?: string; stdout?: string }[],
): string[][] {
  const calls: string[][] = [];

  spyOn(Bun, "spawn").mockImplementation((command) => {
    const args = Array.isArray(command) ? command : command.cmd;
    calls.push([...args]);
    const result = results[Math.min(calls.length - 1, results.length - 1)];

    return {
      exited: Promise.resolve(result.exitCode),
      stderr: result.stderr ?? "",
      stdout: result.stdout ?? "",
    } as unknown as ReturnType<typeof Bun.spawn>;
  });

  return calls;
}
