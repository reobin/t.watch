import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { runCommand } from "./command";

const encoder = new TextEncoder();

describe("notification command backend", () => {
  afterEach(() => {
    mock.restore();
  });

  test("ignores stderr while reading stdout", async () => {
    spyOn(Bun, "spawn").mockImplementation(((command: string[], options?: { stderr?: string }) => {
      expect(command).toEqual(["command", "arg"]);
      expect(options?.stderr).toBe("ignore");

      return processResult({
        exited: Promise.resolve(0),
        stdout: readableText("ok"),
      });
    }) as unknown as typeof Bun.spawn);

    await expect(runCommand("command", ["arg"])).resolves.toEqual({
      exitCode: 0,
      stdout: "ok",
    });
  });
});

function readableText(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(value));
      controller.close();
    },
  });
}

function processResult(options: {
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array>;
}): ReturnType<typeof Bun.spawn> {
  return {
    exited: options.exited,
    stdout: options.stdout,
  } as unknown as ReturnType<typeof Bun.spawn>;
}
