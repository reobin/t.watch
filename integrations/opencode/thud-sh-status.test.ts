import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { ThudShStatus } from "./thud-sh-status";

const originalProcRoot = process.env.THUD_PROC_ROOT;
let procRoot: string | undefined;

describe("ThudShStatus", () => {
  afterEach(async () => {
    mock.restore();
    delete process.env.TMUX_PANE;

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

  test("marks OpenCode questions as waiting", async () => {
    process.env.TMUX_PANE = "%1";
    const shell = mockShell();
    const plugin = await ThudShStatus({ $: shell.$ as typeof Bun.$ });

    await plugin.event({ event: { type: "question.asked" } });

    expect(statuses(shell.calls)).toEqual(["idle", "waiting"]);
  });

  test("restores idle after answered or dismissed OpenCode questions", async () => {
    process.env.TMUX_PANE = "%1";
    const shell = mockShell();
    const plugin = await ThudShStatus({ $: shell.$ as typeof Bun.$ });

    await plugin.event({ event: { type: "question.asked" } });
    await plugin.event({ event: { type: "question.replied" } });
    await plugin.event({ event: { type: "question.rejected" } });

    expect(statuses(shell.calls)).toEqual(["idle", "waiting", "idle"]);
  });

  test("restores running after answered OpenCode questions while busy", async () => {
    process.env.TMUX_PANE = "%1";
    const shell = mockShell();
    const plugin = await ThudShStatus({ $: shell.$ as typeof Bun.$ });

    await plugin.event({
      event: { type: "session.status", properties: { status: { type: "busy" } } },
    });
    await plugin.event({ event: { type: "question.asked" } });
    await plugin.event({ event: { type: "question.replied" } });

    expect(statuses(shell.calls)).toEqual(["idle", "running", "waiting", "running"]);
  });

  test("restores idle after dismissed OpenCode questions while busy", async () => {
    process.env.TMUX_PANE = "%1";
    const shell = mockShell();
    const plugin = await ThudShStatus({ $: shell.$ as typeof Bun.$ });

    await plugin.event({
      event: { type: "session.status", properties: { status: { type: "busy" } } },
    });
    await plugin.event({ event: { type: "question.asked" } });
    await plugin.event({ event: { type: "question.rejected" } });

    expect(statuses(shell.calls)).toEqual(["idle", "running", "waiting", "idle"]);
  });

  test("restores idle after rejected OpenCode permissions while busy", async () => {
    process.env.TMUX_PANE = "%1";
    const shell = mockShell();
    const plugin = await ThudShStatus({ $: shell.$ as typeof Bun.$ });

    await plugin.event({
      event: { type: "session.status", properties: { status: { type: "busy" } } },
    });
    await plugin.event({ event: { type: "permission.asked" } });
    await plugin.event({
      event: { type: "permission.replied", properties: { reply: "reject" } },
    });

    expect(statuses(shell.calls)).toEqual(["idle", "running", "waiting", "idle"]);
  });

  test("writes owner identity with status updates", async () => {
    process.env.TMUX_PANE = "%1";
    await mockProcStartTime("12345");
    const shell = mockShell();

    await ThudShStatus({ $: shell.$ as typeof Bun.$ });

    expect(shell.calls[0]).toContain(`@thud_sh_owner_pid ${process.pid}`);
    expect(shell.calls[0]).toContain("@thud_sh_owner_start_time 12345");
  });

  test("falls back to ps when proc is unavailable", async () => {
    process.env.TMUX_PANE = "%1";
    mockMissingProcRoot();
    const ownerStartTime = "Fri May  8 12:34:56 2026";
    const shell = mockShell();

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;

      expect(args).toEqual(["ps", "-p", process.pid.toString(), "-o", "lstart="]);

      return {
        exited: Promise.resolve(0),
        stderr: "",
        stdout: `${ownerStartTime}\n`,
      } as unknown as ReturnType<typeof Bun.spawn>;
    });

    await ThudShStatus({ $: shell.$ as typeof Bun.$ });

    expect(shell.calls[0]).toContain(`@thud_sh_owner_start_time ${Date.parse(ownerStartTime)}`);
  });
});

async function mockProcStartTime(startTime: string): Promise<void> {
  procRoot = await mkdtemp(join(tmpdir(), "thud-opencode-proc-"));
  process.env.THUD_PROC_ROOT = procRoot;

  const processPath = join(procRoot, process.pid.toString());

  await mkdir(processPath, { recursive: true });
  await writeFile(join(processPath, "stat"), procStat(startTime), "utf8");
}

function mockMissingProcRoot(): void {
  procRoot = join(tmpdir(), `thud-opencode-missing-proc-${process.pid}-${Date.now()}`);
  process.env.THUD_PROC_ROOT = procRoot;
}

function procStat(startTime: string): string {
  const fields = ["S", process.ppid.toString(), ...Array(17).fill("0"), startTime];

  return `${process.pid} (bun) ${fields.join(" ")}`;
}

function mockShell(): { calls: string[]; $: unknown } {
  const calls: string[] = [];

  return {
    calls,
    $(strings: TemplateStringsArray, ...values: unknown[]) {
      let command = strings[0] ?? "";

      for (let i = 0; i < values.length; i++) {
        command += String(values[i]) + (strings[i + 1] ?? "");
      }

      calls.push(command);

      return {
        quiet: async () => {},
      };
    },
  };
}

function statuses(calls: string[]): string[] {
  return calls.flatMap((call) => {
    const match = call.match(/@thud_sh_status\s+(\S+)/);

    return match?.[1] ? [match[1]] : [];
  });
}
