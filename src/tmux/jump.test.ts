import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { jumpToNextPane } from "./jump";

const originalTmuxPane = process.env.TMUX_PANE;
const originalProcRoot = process.env.THUD_PROC_ROOT;
const separator = "\x1f";
const paneFormat = [
  "#{pane_id}",
  "#{pane_active}",
  "#{window_active}",
  "#{session_attached}",
  "#{pane_pid}",
  "#{@thud_sh_tool}",
  "#{@thud_sh_status}",
  "#{@thud_sh_owner_pid}",
  "#{@thud_sh_owner_start_time}",
].join(separator);
const clientFormat = ["#{client_name}", "#{client_tty}", "#{client_control_mode}"].join(separator);
let procRoot: string | undefined;

describe("jumpToNextPane", () => {
  afterEach(async () => {
    mock.restore();

    if (originalTmuxPane === undefined) {
      delete process.env.TMUX_PANE;
    } else {
      process.env.TMUX_PANE = originalTmuxPane;
    }

    if (originalProcRoot === undefined) {
      delete process.env.THUD_PROC_ROOT;
    } else {
      process.env.THUD_PROC_ROOT = originalProcRoot;
    }

    if (procRoot) {
      await rm(procRoot, { force: true, recursive: true });
      procRoot = undefined;
    }
  });

  test("uses the current client when a reliable current pane is provided", async () => {
    delete process.env.TMUX_PANE;
    await mockProc({ "50": { ppid: "5", startTime: "500" } });
    const calls = mockTmuxResults([
      {
        exitCode: 0,
        stdout: paneLines([
          ["%1", true, true, true, "waiting"],
          ["%4", true, true, true],
          ["%5", false, true, true, "waiting", "opencode", "5", "50", "500"],
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
    await mockProc({ "20": { ppid: "2", startTime: "200" } });
    const calls = mockTmuxResults([
      {
        exitCode: 0,
        stdout: paneLines([
          ["%1", true, true, true],
          ["%2", false, true, true, "waiting", "opencode", "2", "20", "200"],
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
    await mockProc({ "20": { ppid: "2", startTime: "200" } });
    const calls = mockTmuxResults([
      {
        exitCode: 0,
        stdout: paneLines([
          ["%1", true, true, true],
          ["%2", false, true, true, "waiting", "", "2", "20", "200"],
        ]),
      },
    ]);

    await expect(jumpToNextPane("%1")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([["tmux", "list-panes", "-a", "-F", paneFormat]]);
  });

  test("supports any integration tool", async () => {
    delete process.env.TMUX_PANE;
    await mockProc({ "20": { ppid: "2", startTime: "200" } });
    const calls = mockTmuxResults([
      {
        exitCode: 0,
        stdout: paneLines([
          ["%1", true, true, true],
          ["%2", false, true, true, "waiting", "codex", "2", "20", "200"],
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

  test("validates owner identity with ps when proc is unavailable", async () => {
    delete process.env.TMUX_PANE;
    mockMissingProcRoot();
    const ownerStartTime = "Fri May  8 12:34:56 2026";
    const calls = mockTmuxResults([
      {
        exitCode: 0,
        stdout: paneLines([
          ["%1", true, true, true],
          [
            "%2",
            false,
            true,
            true,
            "waiting",
            "opencode",
            "2",
            "20",
            Date.parse(ownerStartTime).toString(),
          ],
        ]),
      },
      { exitCode: 0, stdout: ` 20 2 ${ownerStartTime}\n` },
      { exitCode: 0 },
    ]);

    await expect(jumpToNextPane("%1")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      ["tmux", "list-panes", "-a", "-F", paneFormat],
      ["ps", "-axo", "pid=,ppid=,lstart="],
      ["tmux", "switch-client", "-t", "%2"],
    ]);
  });

  test("ignores status without owner identity", async () => {
    delete process.env.TMUX_PANE;
    const calls = mockTmuxResults([
      {
        exitCode: 0,
        stdout: paneLines([
          ["%1", true, true, true],
          ["%2", false, true, true, "waiting", "opencode"],
        ]),
      },
    ]);

    await expect(jumpToNextPane("%1")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([["tmux", "list-panes", "-a", "-F", paneFormat]]);
  });

  test("ignores status with partial owner identity", async () => {
    delete process.env.TMUX_PANE;
    const calls = mockTmuxResults([
      {
        exitCode: 0,
        stdout: paneLines([
          ["%1", true, true, true],
          ["%2", false, true, true, "waiting", "opencode", "2", "20"],
        ]),
      },
    ]);

    await expect(jumpToNextPane("%1")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([["tmux", "list-panes", "-a", "-F", paneFormat]]);
  });

  test("ignores stale status when the owner process is gone", async () => {
    delete process.env.TMUX_PANE;
    await mockProc({});
    const calls = mockTmuxResults([
      {
        exitCode: 0,
        stdout: paneLines([
          ["%1", true, true, true],
          ["%2", false, true, true, "waiting", "opencode", "2", "20", "200"],
        ]),
      },
    ]);

    await expect(jumpToNextPane("%1")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([["tmux", "list-panes", "-a", "-F", paneFormat]]);
  });

  test("ignores stale status when the owner pid was reused", async () => {
    delete process.env.TMUX_PANE;
    await mockProc({ "20": { ppid: "2", startTime: "999" } });
    const calls = mockTmuxResults([
      {
        exitCode: 0,
        stdout: paneLines([
          ["%1", true, true, true],
          ["%2", false, true, true, "waiting", "opencode", "2", "20", "200"],
        ]),
      },
    ]);

    await expect(jumpToNextPane("%1")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([["tmux", "list-panes", "-a", "-F", paneFormat]]);
  });

  test("ignores live owners from another pane", async () => {
    delete process.env.TMUX_PANE;
    await mockProc({ "20": { ppid: "9", startTime: "200" } });
    const calls = mockTmuxResults([
      {
        exitCode: 0,
        stdout: paneLines([
          ["%1", true, true, true],
          ["%2", false, true, true, "waiting", "opencode", "2", "20", "200"],
        ]),
      },
    ]);

    await expect(jumpToNextPane("%1")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([["tmux", "list-panes", "-a", "-F", paneFormat]]);
  });
});

async function mockProc(
  processes: Record<string, { ppid: string; startTime: string }>,
): Promise<void> {
  procRoot = await mkdtemp(join(tmpdir(), "thud-jump-proc-"));
  process.env.THUD_PROC_ROOT = procRoot;

  await Promise.all(
    Object.entries(processes).map(async ([pid, processInfo]) => {
      const processPath = join(procRoot ?? "", pid);

      await mkdir(processPath, { recursive: true });
      await writeFile(join(processPath, "stat"), procStat(pid, processInfo), "utf8");
    }),
  );
}

function mockMissingProcRoot(): void {
  procRoot = join(tmpdir(), `thud-jump-missing-proc-${process.pid}-${Date.now()}`);
  process.env.THUD_PROC_ROOT = procRoot;
}

function procStat(pid: string, processInfo: { ppid: string; startTime: string }): string {
  const fields = ["S", processInfo.ppid, ...Array(17).fill("0"), processInfo.startTime];

  return `${pid} (opencode) ${fields.join(" ")}`;
}

function paneLines(
  panes: [string, boolean, boolean, boolean, string?, string?, string?, string?, string?][],
): string {
  return `${panes
    .map(
      ([id, active, windowActive, sessionAttached, status, tool, panePid, ownerPid, ownerStart]) =>
        [
          id,
          Number(active),
          Number(windowActive),
          Number(sessionAttached),
          panePid ?? id.slice(1),
          tool ?? (status ? "opencode" : ""),
          status ?? "",
          ownerPid ?? "",
          ownerStart ?? "",
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
