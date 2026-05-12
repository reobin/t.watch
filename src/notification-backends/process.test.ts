import { describe, expect, test } from "bun:test";
import { windowOwnerPidCandidates } from "./process";
import type { RunCommand } from "./types";

describe("notification process backend", () => {
  test("includes the process, tmux client, and ancestor pids", async () => {
    const calls: string[][] = [];
    const run: RunCommand = async (command, args) => {
      calls.push([command, ...args]);

      if (command === "tmux") {
        return { exitCode: 0, stdout: "200\n" };
      }

      const pid = args.at(-1);
      const parents = new Map([
        ["10", "20"],
        ["20", "30"],
        ["30", "1"],
        ["200", "300"],
        ["300", "1"],
      ]);

      return { exitCode: 0, stdout: `${parents.get(pid ?? "") ?? "1"}\n` };
    };

    await expect(windowOwnerPidCandidates(10, { TMUX: "/tmp/tmux" }, run)).resolves.toEqual([
      10, 200, 20, 30, 300,
    ]);
    expect(calls).toEqual([
      ["tmux", "display-message", "-p", "#{client_pid}"],
      ["ps", "-o", "ppid=", "-p", "10"],
      ["ps", "-o", "ppid=", "-p", "20"],
      ["ps", "-o", "ppid=", "-p", "30"],
      ["ps", "-o", "ppid=", "-p", "200"],
      ["ps", "-o", "ppid=", "-p", "300"],
    ]);
  });

  test("skips tmux lookup outside tmux", async () => {
    const calls: string[][] = [];
    const run: RunCommand = async (command, args) => {
      calls.push([command, ...args]);

      return { exitCode: 0, stdout: "1\n" };
    };

    await expect(windowOwnerPidCandidates(10, {}, run)).resolves.toEqual([10]);
    expect(calls).toEqual([["ps", "-o", "ppid=", "-p", "10"]]);
  });
});
