import { describe, expect, mock, test } from "bun:test";
import { runCli } from "./cli";

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

  test("rejects unknown args", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();

    await expect(runCli(["bun", "thud", "help"], startApp, output)).resolves.toBe(1);
    expect(startApp).not.toHaveBeenCalled();
    expect(output.log).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith("Usage: thud [version]");
  });

  test("rejects extra args", async () => {
    const startApp = mock(async () => {});
    const output = mockOutput();

    await expect(runCli(["bun", "thud", "version", "extra"], startApp, output)).resolves.toBe(1);
    expect(startApp).not.toHaveBeenCalled();
    expect(output.log).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith("Usage: thud [version]");
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
