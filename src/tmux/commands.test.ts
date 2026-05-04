import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { checkTmux, focusPaneForAllClients } from "./commands";

describe("checkTmux", () => {
  afterEach(() => {
    mock.restore();
  });

  test("returns the tmux version", async () => {
    const calls = mockTmux({ exitCode: 0, stdout: "tmux 3.5a\n" });

    await expect(checkTmux()).resolves.toEqual({ ok: true, version: "tmux 3.5a" });
    expect(calls).toEqual([["tmux", "-V"]]);
  });

  test("returns tmux stderr for failures", async () => {
    mockTmux({ exitCode: 1, stderr: "tmux failed" });

    await expect(checkTmux()).resolves.toEqual({
      ok: false,
      message: "tmux failed",
    });
  });

  test("falls back to stdout for failures without stderr", async () => {
    mockTmux({ exitCode: 1, stdout: "tmux stdout failure" });

    await expect(checkTmux()).resolves.toEqual({
      ok: false,
      message: "tmux stdout failure",
    });
  });

  test("returns a default message for failures without output", async () => {
    mockTmux({ exitCode: 1 });

    await expect(checkTmux()).resolves.toEqual({
      ok: false,
      message: "tmux check failed.",
    });
  });

  test("returns a helpful message when tmux is missing", async () => {
    spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("ENOENT");
    });

    await expect(checkTmux()).resolves.toEqual({
      ok: false,
      message: "tmux is required but was not found.",
    });
  });
});

function mockTmux(result: { exitCode: number; stderr?: string; stdout?: string }): string[][] {
  const calls: string[][] = [];

  spyOn(Bun, "spawn").mockImplementation((command) => {
    const args = Array.isArray(command) ? command : command.cmd;
    calls.push([...args]);

    return {
      exited: Promise.resolve(result.exitCode),
      stderr: result.stderr ?? "",
      stdout: result.stdout ?? "",
    } as unknown as ReturnType<typeof Bun.spawn>;
  });

  return calls;
}

describe("focusPaneForAllClients", () => {
  afterEach(() => {
    mock.restore();
  });

  test("switches every tmux client to the target pane", async () => {
    const calls = mockTmuxResults([
      { exitCode: 0, stdout: "client-a\x1f/dev/pts/1\n\x1f/dev/pts/2" },
      { exitCode: 0 },
      { exitCode: 0 },
    ]);

    await expect(focusPaneForAllClients("%3")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      ["tmux", "list-clients", "-F", "#{client_name}\x1f#{client_tty}"],
      ["tmux", "switch-client", "-c", "client-a", "-t", "%3"],
      ["tmux", "switch-client", "-c", "/dev/pts/2", "-t", "%3"],
    ]);
  });

  test("reports a missing-client message when no clients are attached", async () => {
    mockTmuxResults([{ exitCode: 0, stdout: "" }]);

    await expect(focusPaneForAllClients("%3")).resolves.toEqual({
      ok: false,
      message: "No tmux clients attached.",
    });
  });
});

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
