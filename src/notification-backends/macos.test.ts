import { describe, expect, test } from "bun:test";
import { macosTerminalVisibility } from "./macos";
import type { RunCommand } from "./types";

describe("macos visibility backend", () => {
  test("checks resolved window owner pids", async () => {
    const calls: string[][] = [];
    let script = "";
    const run: RunCommand = async (command, args) => {
      calls.push([command, ...args]);

      if (command === "osascript") {
        script = args[1] ?? "";
        return { exitCode: 0, stdout: "visible\n" };
      }

      if (args.at(-1) === "123") {
        return { exitCode: 0, stdout: "456\n" };
      }

      return { exitCode: 0, stdout: "1\n" };
    };

    await expect(macosTerminalVisibility(123, run, {})).resolves.toBe("visible");
    expect(calls).toEqual([
      ["ps", "-o", "ppid=", "-p", "123"],
      ["ps", "-o", "ppid=", "-p", "456"],
      ["osascript", "-e", script],
    ]);
    expect(script).toContain("set candidateIds to {123, 456}");
    expect(script).toContain("count of windows of targetProcess");
  });

  test("returns unknown when osascript fails", async () => {
    const run: RunCommand = async (command, args) => {
      if (command === "osascript") {
        return { exitCode: 1, stdout: "" };
      }

      return { exitCode: 0, stdout: args.at(-1) === "123" ? "456\n" : "1\n" };
    };

    await expect(macosTerminalVisibility(123, run, {})).resolves.toBe("unknown");
  });
});
