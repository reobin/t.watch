import { afterEach, describe, expect, test } from "bun:test";
import { ThudShStatus } from "./thud-sh-status";

describe("ThudShStatus", () => {
  afterEach(() => {
    delete process.env.TMUX_PANE;
  });

  test("marks OpenCode questions as requesting", async () => {
    process.env.TMUX_PANE = "%1";
    const shell = mockShell();
    const plugin = await ThudShStatus({ $: shell.$ as typeof Bun.$ });

    await plugin.event({ event: { type: "question.asked" } });

    expect(statuses(shell.calls)).toEqual(["idle", "requesting"]);
  });

  test("restores idle after answered or dismissed OpenCode questions", async () => {
    process.env.TMUX_PANE = "%1";
    const shell = mockShell();
    const plugin = await ThudShStatus({ $: shell.$ as typeof Bun.$ });

    await plugin.event({ event: { type: "question.asked" } });
    await plugin.event({ event: { type: "question.replied" } });
    await plugin.event({ event: { type: "question.rejected" } });

    expect(statuses(shell.calls)).toEqual(["idle", "requesting", "idle"]);
  });

  test("restores working after answered OpenCode questions while busy", async () => {
    process.env.TMUX_PANE = "%1";
    const shell = mockShell();
    const plugin = await ThudShStatus({ $: shell.$ as typeof Bun.$ });

    await plugin.event({
      event: { type: "session.status", properties: { status: { type: "busy" } } },
    });
    await plugin.event({ event: { type: "question.asked" } });
    await plugin.event({ event: { type: "question.replied" } });

    expect(statuses(shell.calls)).toEqual(["idle", "working", "requesting", "working"]);
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

    expect(statuses(shell.calls)).toEqual(["idle", "working", "requesting", "idle"]);
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

    expect(statuses(shell.calls)).toEqual(["idle", "working", "requesting", "idle"]);
  });
});

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
