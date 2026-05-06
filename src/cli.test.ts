import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { runCli } from "./cli";
import type { TmuxPaneIntegrationStatus, TmuxSession } from "./tmux";

const originalTmuxPane = process.env.TMUX_PANE;
const help = `Usage: thud [help|version|jump]

Commands:
  thud          Start the HUD
  thud help     Show help
  thud version  Print the installed package version
  thud jump     Focus the next pane needing attention`;

beforeEach(() => {
  delete process.env.TMUX_PANE;
});

afterEach(() => {
  if (originalTmuxPane === undefined) {
    delete process.env.TMUX_PANE;
    return;
  }

  process.env.TMUX_PANE = originalTmuxPane;
});

describe("runCli", () => {
  test("starts the app without args", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();

    await expect(runCli(["bun", "thud"], startApp, output)).resolves.toBe(0);
    expect(startApp).toHaveBeenCalledTimes(1);
    expect(output.log).not.toHaveBeenCalled();
    expect(output.error).not.toHaveBeenCalled();
  });

  test("prints the package version", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();
    const packageJson = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
      name: string;
      version: string;
    };

    await expect(runCli(["bun", "thud", "version"], startApp, output)).resolves.toBe(0);
    expect(startApp).not.toHaveBeenCalled();
    expect(output.log).toHaveBeenCalledWith(`${packageJson.name}@${packageJson.version}`);
    expect(output.error).not.toHaveBeenCalled();
  });

  test("prints help", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();

    await expect(runCli(["bun", "thud", "help"], startApp, output)).resolves.toBe(0);
    expect(startApp).not.toHaveBeenCalled();
    expect(output.log).toHaveBeenCalledWith(help);
    expect(output.error).not.toHaveBeenCalled();
  });

  test("rejects unknown args", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();

    await expect(runCli(["bun", "thud", "unknown"], startApp, output)).resolves.toBe(1);
    expect(startApp).not.toHaveBeenCalled();
    expect(output.log).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(help);
  });

  test("rejects extra args", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();

    await expect(runCli(["bun", "thud", "version", "extra"], startApp, output)).resolves.toBe(1);
    expect(startApp).not.toHaveBeenCalled();
    expect(output.log).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(help);
  });

  test("jumps to the next matching pane", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();
    const listSessions = mock(async () => ({
      ok: true as const,
      sessions: [
        session("$1", {
          activePaneId: "%1",
          attached: true,
          paneStatuses: { "%2": "idle", "%3": "requesting" },
          paneIds: ["%1", "%2", "%3"],
        }),
      ],
    }));
    const focusPaneForAllClients = mock(async () => ({ ok: true as const }));

    await expect(
      runCli(["bun", "thud", "jump"], startApp, output, {
        focusPaneForAllClients,
        listSessions,
      }),
    ).resolves.toBe(0);
    expect(startApp).not.toHaveBeenCalled();
    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(focusPaneForAllClients).toHaveBeenCalledWith("%3");
    expect(output.error).not.toHaveBeenCalled();
  });

  test("jumps relative to the pane where the jump command was invoked", async () => {
    process.env.TMUX_PANE = "%4";
    const startApp = mock(async () => {});
    const output = mockOutput();
    const listSessions = mock(async () => ({
      ok: true as const,
      sessions: [
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
      ],
    }));
    const focusPaneForAllClients = mock(async () => ({ ok: true as const }));

    await expect(
      runCli(["bun", "thud", "jump"], startApp, output, {
        focusPaneForAllClients,
        listSessions,
      }),
    ).resolves.toBe(0);
    expect(focusPaneForAllClients).toHaveBeenCalledWith("%5");
    expect(output.error).not.toHaveBeenCalled();
  });

  test("does nothing when there is no jump pane", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();
    const listSessions = mock(async () => ({
      ok: true as const,
      sessions: [session("$1", { activePaneId: "%1", attached: true })],
    }));
    const focusPaneForAllClients = mock(async () => ({ ok: true as const }));

    await expect(
      runCli(["bun", "thud", "jump"], startApp, output, {
        focusPaneForAllClients,
        listSessions,
      }),
    ).resolves.toBe(0);
    expect(focusPaneForAllClients).not.toHaveBeenCalled();
    expect(output.error).not.toHaveBeenCalled();
  });

  test("reports jump session listing failures", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();
    const listSessions = mock(async () => ({
      ok: false as const,
      message: "tmux failed",
    }));
    const focusPaneForAllClients = mock(async () => ({ ok: true as const }));

    await expect(
      runCli(["bun", "thud", "jump"], startApp, output, {
        focusPaneForAllClients,
        listSessions,
      }),
    ).resolves.toBe(1);
    expect(focusPaneForAllClients).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith("tmux failed");
  });

  test("reports jump focus failures", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();
    const listSessions = mock(async () => ({
      ok: true as const,
      sessions: [
        session("$1", {
          activePaneId: "%1",
          attached: true,
          paneStatuses: { "%2": "requesting" },
          paneIds: ["%1", "%2"],
        }),
      ],
    }));
    const focusPaneForAllClients = mock(async () => ({
      ok: false as const,
      message: "focus failed",
    }));

    await expect(
      runCli(["bun", "thud", "jump"], startApp, output, {
        focusPaneForAllClients,
        listSessions,
      }),
    ).resolves.toBe(1);
    expect(focusPaneForAllClients).toHaveBeenCalledWith("%2");
    expect(output.error).toHaveBeenCalledWith("focus failed");
  });
});

function mockOutput(): {
  error: ReturnType<typeof mock>;
  log: ReturnType<typeof mock>;
} {
  return {
    error: mock(),
    log: mock(),
  };
}

function session(
  id: string,
  input: {
    activePaneId?: string;
    attached?: boolean;
    paneStatuses?: Partial<Record<string, TmuxPaneIntegrationStatus>>;
    paneIds?: string[];
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
        active: true,
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
