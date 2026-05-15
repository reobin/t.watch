import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { watchPanePaths } from "./path-watcher";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const panePathFormat = "#{pane_id}\x1f#{pane_current_path}";

describe("watchPanePaths", () => {
  afterEach(() => {
    mock.restore();
  });

  test("subscribes to pane path changes and schedules refreshes", async () => {
    const calls: string[][] = [];
    const commands: string[] = [];
    const controlExited = deferred<number>();
    const kill = mock();
    const onChange = mock();
    let listPanesCount = 0;
    let paneOnePath = "/repo";
    let controlOutput!: ReadableStreamDefaultController<Uint8Array>;

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;
      calls.push([...args]);

      if (args[1] === "display-message") {
        return processResult({ exited: Promise.resolve(0), stdout: "$1\n" });
      }

      if (args[1] === "list-panes") {
        listPanesCount += 1;

        return processResult({
          exited: Promise.resolve(0),
          stdout: `%1\x1f${paneOnePath}\n%2\x1f/repo\n`,
        });
      }

      if (args[1] === "-C") {
        return processResult({
          exited: controlExited.promise,
          kill,
          stdin: new WritableStream<Uint8Array>({
            write(chunk) {
              commands.push(decoder.decode(chunk));
            },
          }),
          stdout: new ReadableStream<Uint8Array>({
            start(controller) {
              controlOutput = controller;
            },
          }),
        });
      }

      return processResult({ exited: Promise.resolve(0) });
    });

    const result = await watchPanePaths(onChange);

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      ["tmux", "display-message", "-p", "#{session_id}"],
      ["tmux", "-C", "attach-session", "-t", "$1"],
      ["tmux", "list-panes", "-a", "-F", panePathFormat],
    ]);
    expect(commands).toEqual([
      "refresh-client -B 'thud-sh-path-_1:%1:#{pane_current_path}'\n",
      "refresh-client -B 'thud-sh-path-_2:%2:#{pane_current_path}'\n",
    ]);

    paneOnePath = "/repo/next";
    controlOutput.enqueue(
      encoder.encode("%subscription-changed thud-sh-path-_1 $1 @1 1 %1 : /repo/next\n"),
    );
    await waitForMicrotasks();
    await waitForMicrotasks();

    expect(onChange).toHaveBeenCalledTimes(1);
    await waitFor(() => listPanesCount >= 2);
    await waitForMicrotasks();

    expect(onChange).toHaveBeenCalledTimes(1);

    if (result.ok === true) {
      await result.watcher.stop();
    }

    expect(kill).toHaveBeenCalledTimes(1);
  });

  test("coalesces quick path notifications into one refresh", async () => {
    const controlExited = deferred<number>();
    const onChange = mock();
    let controlOutput!: ReadableStreamDefaultController<Uint8Array>;

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;

      if (args[1] === "display-message") {
        return processResult({ exited: Promise.resolve(0), stdout: "$1\n" });
      }

      if (args[1] === "list-panes") {
        return processResult({ exited: Promise.resolve(0), stdout: "%1\x1f/repo\n" });
      }

      if (args[1] === "-C") {
        return processResult({
          exited: controlExited.promise,
          stdin: new WritableStream<Uint8Array>(),
          stdout: new ReadableStream<Uint8Array>({
            start(controller) {
              controlOutput = controller;
            },
          }),
        });
      }

      return processResult({ exited: Promise.resolve(0) });
    });

    const result = await watchPanePaths(onChange);

    expect(result.ok).toBe(true);
    controlOutput.enqueue(
      encoder.encode(
        "%subscription-changed thud-sh-path-_1 $1 @1 1 %1 : /repo/one\n%subscription-changed thud-sh-path-_1 $1 @1 1 %1 : /repo/two\n",
      ),
    );
    await waitForMicrotasks();
    await waitForMicrotasks();

    expect(onChange).toHaveBeenCalledTimes(1);

    if (result.ok === true) {
      await result.watcher.stop();
    }
  });

  test("uses the first listed session when no current session is available", async () => {
    const calls: string[][] = [];
    const commands: string[] = [];
    const controlExited = deferred<number>();

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;
      calls.push([...args]);

      if (args[1] === "display-message") {
        return processResult({ exited: Promise.resolve(1), stdout: "" });
      }

      if (args[1] === "list-sessions") {
        return processResult({ exited: Promise.resolve(0), stdout: "$9\n$8\n" });
      }

      if (args[1] === "list-panes") {
        return processResult({ exited: Promise.resolve(0), stdout: "%1\x1f/repo\n" });
      }

      if (args[1] === "-C") {
        return processResult({
          exited: controlExited.promise,
          stdin: new WritableStream<Uint8Array>({
            write(chunk) {
              commands.push(decoder.decode(chunk));
            },
          }),
          stdout: new ReadableStream<Uint8Array>(),
        });
      }

      return processResult({ exited: Promise.resolve(0) });
    });

    const result = await watchPanePaths(() => undefined);

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      ["tmux", "display-message", "-p", "#{session_id}"],
      ["tmux", "list-sessions", "-F", "#{session_id}"],
      ["tmux", "-C", "attach-session", "-t", "$9"],
      ["tmux", "list-panes", "-a", "-F", panePathFormat],
    ]);
    expect(commands).toEqual(["refresh-client -B 'thud-sh-path-_1:%1:#{pane_current_path}'\n"]);

    if (result.ok === true) {
      await result.watcher.stop();
    }
  });

  test("skips the watcher when the current session cannot be resolved", async () => {
    const calls: string[][] = [];

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;
      calls.push([...args]);

      return processResult({ exited: Promise.resolve(0), stdout: "" });
    });

    await expect(watchPanePaths(() => undefined)).resolves.toEqual({
      ok: false,
      message: "tmux pane path watcher unavailable.",
    });
    expect(calls).toEqual([
      ["tmux", "display-message", "-p", "#{session_id}"],
      ["tmux", "list-sessions", "-F", "#{session_id}"],
    ]);
  });

  test("polls pane path snapshots and schedules refreshes", async () => {
    const controlExited = deferred<number>();
    const onChange = mock();
    let panePath = "/repo/one";

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;

      if (args[1] === "display-message") {
        return processResult({ exited: Promise.resolve(0), stdout: "$1\n" });
      }

      if (args[1] === "list-panes") {
        return processResult({ exited: Promise.resolve(0), stdout: `%1\x1f${panePath}\n` });
      }

      if (args[1] === "-C") {
        return processResult({
          exited: controlExited.promise,
          stdin: new WritableStream<Uint8Array>(),
          stdout: new ReadableStream<Uint8Array>(),
        });
      }

      return processResult({ exited: Promise.resolve(0) });
    });

    const result = await watchPanePaths(onChange);

    expect(result.ok).toBe(true);
    panePath = "/repo/two";
    await waitFor(() => onChange.mock.calls.length === 1);

    if (result.ok === true) {
      await result.watcher.stop();
    }
  });

  test("subscribes to panes discovered during path polling", async () => {
    const commands: string[] = [];
    const controlExited = deferred<number>();
    const onChange = mock();
    let listPanesCount = 0;

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;

      if (args[1] === "display-message") {
        return processResult({ exited: Promise.resolve(0), stdout: "$1\n" });
      }

      if (args[1] === "list-panes") {
        listPanesCount += 1;

        return processResult({
          exited: Promise.resolve(0),
          stdout: listPanesCount === 1 ? "%1\x1f/repo\n" : "%1\x1f/repo\n%2\x1f/repo\n",
        });
      }

      if (args[1] === "-C") {
        return processResult({
          exited: controlExited.promise,
          stdin: new WritableStream<Uint8Array>({
            write(chunk) {
              commands.push(decoder.decode(chunk));
            },
          }),
          stdout: new ReadableStream<Uint8Array>(),
        });
      }

      return processResult({ exited: Promise.resolve(0) });
    });

    const result = await watchPanePaths(onChange);

    expect(result.ok).toBe(true);
    try {
      await waitFor(() => commands.some((command) => command.includes("thud-sh-path-_2:%2")));
      await waitFor(() => onChange.mock.calls.length === 1);
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      if (result.ok === true) {
        await result.watcher.stop();
      }
    }
  });

  test("does not overlap path snapshot polling", async () => {
    const controlExited = deferred<number>();
    const pollResult = deferred<void>();
    const onChange = mock();
    let listPanesCount = 0;

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;

      if (args[1] === "display-message") {
        return processResult({ exited: Promise.resolve(0), stdout: "$1\n" });
      }

      if (args[1] === "list-panes") {
        listPanesCount += 1;

        if (listPanesCount === 1) {
          return processResult({ exited: Promise.resolve(0), stdout: "%1\x1f/repo\n" });
        }

        return processResult({
          exited: pollResult.promise.then(() => 0),
          stdout: new ReadableStream<Uint8Array>({
            async start(controller) {
              await pollResult.promise;
              controller.enqueue(encoder.encode("%1\x1f/repo\n"));
              controller.close();
            },
          }),
        });
      }

      if (args[1] === "-C") {
        return processResult({
          exited: controlExited.promise,
          stdin: new WritableStream<Uint8Array>(),
          stdout: new ReadableStream<Uint8Array>(),
        });
      }

      return processResult({ exited: Promise.resolve(0) });
    });

    const result = await watchPanePaths(onChange);

    expect(result.ok).toBe(true);
    try {
      await waitFor(() => listPanesCount === 2);
      await new Promise((resolve) => setTimeout(resolve, 1100));

      expect(listPanesCount).toBe(2);
    } finally {
      pollResult.resolve();

      if (result.ok === true) {
        await result.watcher.stop();
      }
    }
  });
});

function processResult(options: {
  exited: Promise<number>;
  kill?: () => void;
  stderr?: string | ReadableStream<Uint8Array>;
  stdin?: WritableStream<Uint8Array>;
  stdout?: string | ReadableStream<Uint8Array>;
}): ReturnType<typeof Bun.spawn> {
  return {
    exited: options.exited,
    kill: options.kill ?? mock(),
    stderr: options.stderr ?? "",
    stdin: options.stdin,
    stdout: options.stdout ?? "",
  } as unknown as ReturnType<typeof Bun.spawn>;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

async function waitForMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2500): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for predicate.");
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
