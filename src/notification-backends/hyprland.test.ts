import { describe, expect, test } from "bun:test";
import { hyprlandVisibility, parseHyprlandVisibility } from "./hyprland";

describe("hyprland visibility backend", () => {
  test("detects visible matching client", () => {
    expect(
      parseHyprlandVisibility(
        JSON.stringify([{ pid: 123, hidden: false, mapped: true, monitor: 0 }]),
        123,
      ),
    ).toBe("visible");
  });

  test("detects visible matching ancestor client", () => {
    expect(
      parseHyprlandVisibility(
        JSON.stringify([{ pid: 456, hidden: false, mapped: true, monitor: 0 }]),
        [123, 456],
      ),
    ).toBe("visible");
  });

  test("detects hidden clients", () => {
    expect(parseHyprlandVisibility(JSON.stringify([{ pid: 123, hidden: true }]), 123)).toBe(
      "hidden",
    );
    expect(parseHyprlandVisibility(JSON.stringify([{ pid: 123, mapped: false }]), 123)).toBe(
      "hidden",
    );
    expect(parseHyprlandVisibility(JSON.stringify([{ pid: 123, monitor: -1 }]), 123)).toBe(
      "hidden",
    );
  });

  test("returns unknown without a matching client", () => {
    expect(parseHyprlandVisibility(JSON.stringify([{ pid: 456 }]), 123)).toBe("unknown");
  });

  test("returns unknown for malformed output", () => {
    expect(parseHyprlandVisibility("not json", 123)).toBe("unknown");
  });

  test("runs hyprctl clients", async () => {
    const visibility = await hyprlandVisibility(123, async (command, args) => {
      expect(command).toBe("hyprctl");
      expect(args).toEqual(["clients", "-j"]);

      return {
        exitCode: 0,
        stdout: JSON.stringify([{ pid: 123 }]),
      };
    });

    expect(visibility).toBe("visible");
  });

  test("checks resolved window owner pids when direct pid is not a client", async () => {
    const calls: string[][] = [];
    const visibility = await hyprlandVisibility(
      123,
      async (command, args) => {
        calls.push([command, ...args]);

        if (command === "hyprctl") {
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ pid: 456, hidden: false, mapped: true, monitor: 0 }]),
          };
        }

        if (args.at(-1) === "123") {
          return { exitCode: 0, stdout: "456\n" };
        }

        return { exitCode: 0, stdout: "1\n" };
      },
      {},
    );

    expect(visibility).toBe("visible");
    expect(calls).toEqual([
      ["hyprctl", "clients", "-j"],
      ["ps", "-o", "ppid=", "-p", "123"],
      ["ps", "-o", "ppid=", "-p", "456"],
    ]);
  });

  test("returns unknown when hyprctl fails", async () => {
    expect(
      await hyprlandVisibility(123, async () => ({
        exitCode: 1,
        stdout: "",
      })),
    ).toBe("unknown");
  });
});
