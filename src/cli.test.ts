import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./cli";
const help = `Usage: thud [--mode=default|popup] [--close-on-focus]
       thud [help|version|jump [pane-id]|bench-results [path]]

Commands:
  thud          Start the HUD
  thud help     Show help
  thud version  Print the installed package version
  thud jump     Focus the next pane needing attention
  thud bench-results  Summarize recorded benchmark results

Options:
  --mode=default     Keep thud open after focusing a target
  --mode=popup       Close thud after focusing a target
  --close-on-focus   Close thud after focusing a target`;

describe("runCli", () => {
  test("starts the app without args", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();

    await expect(runCli(["bun", "thud"], startApp, output)).resolves.toBe(0);
    expect(startApp).toHaveBeenCalledWith({ closeOnFocus: false });
    expect(output.log).not.toHaveBeenCalled();
    expect(output.error).not.toHaveBeenCalled();
  });

  test("starts the app in default mode", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();

    await expect(runCli(["bun", "thud", "--mode=default"], startApp, output)).resolves.toBe(0);
    expect(startApp).toHaveBeenCalledWith({ closeOnFocus: false });
    expect(output.error).not.toHaveBeenCalled();
  });

  test("starts the app in popup mode", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();

    await expect(runCli(["bun", "thud", "--mode=popup"], startApp, output)).resolves.toBe(0);
    expect(startApp).toHaveBeenCalledWith({ closeOnFocus: true });
    expect(output.error).not.toHaveBeenCalled();
  });

  test("starts the app with close-on-focus", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();

    await expect(runCli(["bun", "thud", "--close-on-focus"], startApp, output)).resolves.toBe(0);
    expect(startApp).toHaveBeenCalledWith({ closeOnFocus: true });
    expect(output.error).not.toHaveBeenCalled();
  });

  test("rejects invalid modes", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();

    await expect(runCli(["bun", "thud", "--mode=panel"], startApp, output)).resolves.toBe(1);
    expect(startApp).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(help);
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

  test("prints benchmark results summary", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();
    const directory = mkdtempSync(join(tmpdir(), "thud-bench-"));
    const path = join(directory, "bench.jsonl");

    try {
      writeFileSync(
        path,
        [
          JSON.stringify({ event: "startup", firstRenderMs: 120, listSessionsMs: 20 }),
          JSON.stringify({ event: "startup", firstRenderMs: 180, listSessionsMs: 30 }),
        ].join("\n"),
      );

      await expect(runCli(["bun", "thud", "bench-results", path], startApp, output)).resolves.toBe(
        0,
      );
      expect(startApp).not.toHaveBeenCalled();
      expect(output.log).toHaveBeenCalledWith(
        [
          `Benchmark log: ${path}`,
          "records: 2",
          "firstRenderMs: count=2 min=120ms p50=120ms p95=180ms max=180ms",
          "listSessionsMs: count=2 min=20ms p50=20ms p95=30ms max=30ms",
        ].join("\n"),
      );
      expect(output.error).not.toHaveBeenCalled();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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

  test("runs jump command", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();
    const jumpToNextPane = mock(async () => ({ ok: true as const }));

    await expect(
      runCli(["bun", "thud", "jump"], startApp, output, { jumpToNextPane }),
    ).resolves.toBe(0);
    expect(startApp).not.toHaveBeenCalled();
    expect(jumpToNextPane).toHaveBeenCalledTimes(1);
    expect(output.error).not.toHaveBeenCalled();
  });

  test("passes jump pane id argument", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();
    const jumpToNextPane = mock(async () => ({ ok: true as const }));

    await expect(
      runCli(["bun", "thud", "jump", "%4"], startApp, output, { jumpToNextPane }),
    ).resolves.toBe(0);
    expect(jumpToNextPane).toHaveBeenCalledWith("%4");
    expect(output.error).not.toHaveBeenCalled();
  });

  test("reports jump failures", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();
    const jumpToNextPane = mock(async () => ({
      ok: false as const,
      message: "focus failed",
    }));

    await expect(
      runCli(["bun", "thud", "jump"], startApp, output, { jumpToNextPane }),
    ).resolves.toBe(1);
    expect(startApp).not.toHaveBeenCalled();
    expect(jumpToNextPane).toHaveBeenCalledTimes(1);
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
