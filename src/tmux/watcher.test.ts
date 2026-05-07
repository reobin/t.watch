import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { watchSessions } from "./watcher";

const hooks = [
  "session-created",
  "session-closed",
  "session-renamed",
  "after-new-window",
  "window-linked",
  "window-unlinked",
  "after-split-window",
  "after-kill-pane",
  "after-select-pane",
  "after-select-window",
  "session-window-changed",
  "client-attached",
  "client-detached",
  "client-session-changed",
] as const;

describe("watchSessions", () => {
  afterEach(() => {
    mock.restore();
  });

  test("installs session hooks and stops cleanly", async () => {
    const wait = deferred<number>();
    const calls: string[][] = [];
    const kill = mock();

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;
      calls.push([...args]);

      if (args[1] === "wait-for") {
        return processResult({ exited: wait.promise, kill });
      }

      return processResult({ exited: Promise.resolve(0) });
    });

    const result = await watchSessions(() => undefined);

    expect(result.ok).toBe(true);
    expect(calls).toEqual([...installHookCalls(), waitForCall()]);

    if (result.ok === true) {
      await result.watcher.stop();
    }

    expect(kill).toHaveBeenCalled();
    expect(calls).toEqual([...installHookCalls(), waitForCall(), ...unsetHookCalls()]);
  });

  test("schedules refresh after a tmux hook signal", async () => {
    const wait = deferred<number>();
    const nextWait = deferred<number>();
    const calls: string[][] = [];
    const onChange = mock();
    let waitCount = 0;

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;
      calls.push([...args]);

      if (args[1] === "wait-for") {
        waitCount += 1;

        return processResult({ exited: waitCount === 1 ? wait.promise : nextWait.promise });
      }

      return processResult({ exited: Promise.resolve(0) });
    });

    const result = await watchSessions(onChange);

    expect(result.ok).toBe(true);

    wait.resolve(0);
    await Promise.resolve();

    expect(onChange).not.toHaveBeenCalled();

    await waitForMicrotasks();
    await waitForMicrotasks();

    expect(onChange).toHaveBeenCalledTimes(1);

    if (result.ok === true) {
      await result.watcher.stop();
    }
  });

  test("coalesces quick tmux hook signals into one refresh", async () => {
    const wait = deferred<number>();
    const calls: string[][] = [];
    const onChange = mock();
    let waitCount = 0;

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;
      calls.push([...args]);

      if (args[1] === "wait-for") {
        waitCount += 1;

        return processResult({ exited: waitCount <= 2 ? Promise.resolve(0) : wait.promise });
      }

      return processResult({ exited: Promise.resolve(0) });
    });

    const result = await watchSessions(onChange);

    expect(result.ok).toBe(true);
    await waitForMicrotasks();
    await waitForMicrotasks();

    expect(onChange).toHaveBeenCalledTimes(1);

    if (result.ok === true) {
      await result.watcher.stop();
    }
  });

  test("installs a client focus-out hook when requested", async () => {
    const wait = deferred<number>();
    const focusOutWait = deferred<number>();
    const calls: string[][] = [];
    const kill = mock();
    const onClientFocusOut = mock();
    let focusOutWaitCount = 0;

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;
      calls.push([...args]);

      if (args[1] === "show-options") {
        return processResult({ exited: Promise.resolve(0), stdout: "on\n" });
      }

      if (args[1] === "display-message") {
        return processResult({ exited: Promise.resolve(0), stdout: "/dev/pts/0\n" });
      }

      if (args[1] === "wait-for" && args[2] === focusOutChannel()) {
        focusOutWaitCount += 1;

        return processResult({
          exited: focusOutWaitCount === 1 ? focusOutWait.promise : wait.promise,
          kill,
        });
      }

      if (args[1] === "wait-for") {
        return processResult({ exited: wait.promise, kill });
      }

      return processResult({ exited: Promise.resolve(0) });
    });

    const result = await watchSessions(() => undefined, undefined, onClientFocusOut);

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      ...installHookCalls(),
      focusEventsCall(),
      currentClientCall(),
      installFocusOutHookCall(),
      waitForCall(),
      waitForFocusOutCall(),
    ]);

    focusOutWait.resolve(0);
    await waitForMicrotasks();

    expect(onClientFocusOut).toHaveBeenCalled();
    expect(calls).toEqual([
      ...installHookCalls(),
      focusEventsCall(),
      currentClientCall(),
      installFocusOutHookCall(),
      waitForCall(),
      waitForFocusOutCall(),
      waitForFocusOutCall(),
    ]);

    if (result.ok === true) {
      await result.watcher.stop();
    }

    expect(kill).toHaveBeenCalled();
    expect(calls).toEqual([
      ...installHookCalls(),
      focusEventsCall(),
      currentClientCall(),
      installFocusOutHookCall(),
      waitForCall(),
      waitForFocusOutCall(),
      waitForFocusOutCall(),
      ...unsetHookCalls(),
      unsetFocusOutHookCall(),
    ]);
  });

  test("skips client focus-out hook when tmux focus events are disabled", async () => {
    const wait = deferred<number>();
    const calls: string[][] = [];
    const kill = mock();
    const onClientFocusOut = mock();

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;
      calls.push([...args]);

      if (args[1] === "show-options") {
        return processResult({ exited: Promise.resolve(0), stdout: "off\n" });
      }

      if (args[1] === "wait-for") {
        return processResult({ exited: wait.promise, kill });
      }

      return processResult({ exited: Promise.resolve(0) });
    });

    const result = await watchSessions(() => undefined, undefined, onClientFocusOut);

    expect(result.ok).toBe(true);
    expect(calls).toEqual([...installHookCalls(), focusEventsCall(), waitForCall()]);

    if (result.ok === true) {
      await result.watcher.stop();
    }

    expect(onClientFocusOut).not.toHaveBeenCalled();
    expect(kill).toHaveBeenCalled();
    expect(calls).toEqual([
      ...installHookCalls(),
      focusEventsCall(),
      waitForCall(),
      ...unsetHookCalls(),
    ]);
  });

  test("cleans up installed hooks when setup fails", async () => {
    const calls: string[][] = [];

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;
      calls.push([...args]);

      if (args[3] === hookTarget("session-closed")) {
        return processResult({ exited: Promise.resolve(1), stderr: "set-hook failed" });
      }

      return processResult({ exited: Promise.resolve(0) });
    });

    await expect(watchSessions(() => undefined)).resolves.toEqual({
      ok: false,
      message: "set-hook failed",
    });

    expect(calls).toEqual([
      showHooksCall(),
      installHookCall("session-created"),
      installHookCall("session-closed"),
      unsetHookCall("session-created"),
    ]);
  });

  test("calls onStop and cleans up hooks when waiting fails", async () => {
    const calls: string[][] = [];
    const onStop = mock();

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;
      calls.push([...args]);

      if (args[1] === "wait-for") {
        return processResult({ exited: Promise.resolve(1), stderr: "wait failed" });
      }

      return processResult({ exited: Promise.resolve(0) });
    });

    const result = await watchSessions(() => undefined, onStop);

    expect(result.ok).toBe(true);
    await waitForMicrotasks();

    expect(onStop).toHaveBeenCalledWith("wait failed");
    expect(calls).toEqual([...installHookCalls(), waitForCall(), ...unsetHookCalls()]);
  });

  test("kills both wait processes when client focus-out waiting fails", async () => {
    const wait = deferred<number>();
    const calls: string[][] = [];
    const onStop = mock();
    const sessionWaitKill = mock();
    const focusOutWaitKill = mock();

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;
      calls.push([...args]);

      if (args[1] === "show-options") {
        return processResult({ exited: Promise.resolve(0), stdout: "on\n" });
      }

      if (args[1] === "display-message") {
        return processResult({ exited: Promise.resolve(0), stdout: "/dev/pts/0\n" });
      }

      if (args[1] === "wait-for" && args[2] === focusOutChannel()) {
        return processResult({
          exited: Promise.resolve(1),
          kill: focusOutWaitKill,
          stderr: "focus wait failed",
        });
      }

      if (args[1] === "wait-for") {
        return processResult({ exited: wait.promise, kill: sessionWaitKill });
      }

      return processResult({ exited: Promise.resolve(0) });
    });

    const result = await watchSessions(
      () => undefined,
      onStop,
      () => undefined,
    );

    expect(result.ok).toBe(true);
    await waitForMicrotasks();

    expect(onStop).toHaveBeenCalledWith("focus wait failed");
    expect(sessionWaitKill).toHaveBeenCalledTimes(1);
    expect(focusOutWaitKill).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      ...installHookCalls(),
      focusEventsCall(),
      currentClientCall(),
      installFocusOutHookCall(),
      waitForCall(),
      waitForFocusOutCall(),
      ...unsetHookCalls(),
      unsetFocusOutHookCall(),
    ]);
  });

  test("returns a helpful message when tmux is missing", async () => {
    spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("ENOENT");
    });

    await expect(watchSessions(() => undefined)).resolves.toEqual({
      ok: false,
      message: "tmux is required but was not found.",
    });
  });
});

function installHookCalls(): string[][] {
  return [showHooksCall(), ...hooks.map(installHookCall)];
}

function showHooksCall(): string[] {
  return ["tmux", "show-hooks", "-g"];
}

function installHookCall(hook: (typeof hooks)[number]): string[] {
  return ["tmux", "set-hook", "-g", hookTarget(hook), `wait-for -S ${channel()}`];
}

function installFocusOutHookCall(): string[] {
  return [
    "tmux",
    "set-hook",
    "-g",
    hookTarget("client-focus-out"),
    `if -F "#{==:#{hook_client},/dev/pts/0}" "wait-for -S ${focusOutChannel()}"`,
  ];
}

function unsetHookCalls(): string[][] {
  return hooks.map(unsetHookCall);
}

function unsetHookCall(hook: (typeof hooks)[number]): string[] {
  return ["tmux", "set-hook", "-gu", hookTarget(hook)];
}

function unsetFocusOutHookCall(): string[] {
  return ["tmux", "set-hook", "-gu", hookTarget("client-focus-out")];
}

function waitForCall(): string[] {
  return ["tmux", "wait-for", channel()];
}

function waitForFocusOutCall(): string[] {
  return ["tmux", "wait-for", focusOutChannel()];
}

function focusEventsCall(): string[] {
  return ["tmux", "show-options", "-gqv", "focus-events"];
}

function currentClientCall(): string[] {
  return ["tmux", "display-message", "-p", "#{client_name}"];
}

function hookTarget(hook: string): string {
  return `${hook}[${process.pid}]`;
}

function channel(): string {
  return "thud-sh-sessions";
}

function focusOutChannel(): string {
  return `thud-sh-client-focus-out-${process.pid}`;
}

function processResult(options: {
  exited: Promise<number>;
  kill?: () => void;
  stderr?: string;
  stdout?: string;
}): ReturnType<typeof Bun.spawn> {
  return {
    exited: options.exited,
    kill: options.kill ?? mock(),
    stderr: options.stderr ?? "",
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
