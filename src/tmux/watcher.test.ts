import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { watchSessions } from "./watcher"

const hooks = [
  "session-created",
  "session-closed",
  "session-renamed",
  "after-new-window",
  "window-linked",
  "window-unlinked",
  "after-split-window",
  "after-kill-pane",
  "client-attached",
  "client-detached",
  "client-session-changed",
] as const

describe("watchSessions", () => {
  afterEach(() => {
    mock.restore()
  })

  test("installs session hooks and stops cleanly", async () => {
    const wait = deferred<number>()
    const calls: string[][] = []
    const kill = mock()

    spyOn(Bun, "spawn").mockImplementation((command) => {
      calls.push([...command])

      if (command[1] === "wait-for") {
        return processResult({ exited: wait.promise, kill })
      }

      return processResult({ exited: Promise.resolve(0) })
    })

    const result = await watchSessions(() => undefined)

    expect(result.ok).toBe(true)
    expect(calls).toEqual([...installHookCalls(), waitForCall()])

    if (result.ok === true) {
      await result.watcher.stop()
    }

    expect(kill).toHaveBeenCalled()
    expect(calls).toEqual([
      ...installHookCalls(),
      waitForCall(),
      ...unsetHookCalls(),
    ])
  })

  test("cleans up installed hooks when setup fails", async () => {
    const calls: string[][] = []

    spyOn(Bun, "spawn").mockImplementation((command) => {
      calls.push([...command])

      if (command[3] === hookTarget("session-closed")) {
        return processResult({ exited: Promise.resolve(1), stderr: "set-hook failed" })
      }

      return processResult({ exited: Promise.resolve(0) })
    })

    await expect(watchSessions(() => undefined)).resolves.toEqual({
      ok: false,
      message: "set-hook failed",
    })

    expect(calls).toEqual([
      installHookCall("session-created"),
      installHookCall("session-closed"),
      unsetHookCall("session-created"),
    ])
  })

  test("calls onStop and cleans up hooks when waiting fails", async () => {
    const calls: string[][] = []
    const onStop = mock()

    spyOn(Bun, "spawn").mockImplementation((command) => {
      calls.push([...command])

      if (command[1] === "wait-for") {
        return processResult({ exited: Promise.resolve(1), stderr: "wait failed" })
      }

      return processResult({ exited: Promise.resolve(0) })
    })

    const result = await watchSessions(() => undefined, onStop)

    expect(result.ok).toBe(true)
    await waitForMicrotasks()

    expect(onStop).toHaveBeenCalledWith("wait failed")
    expect(calls).toEqual([
      ...installHookCalls(),
      waitForCall(),
      ...unsetHookCalls(),
    ])
  })

  test("returns a helpful message when tmux is missing", async () => {
    spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("ENOENT")
    })

    await expect(watchSessions(() => undefined)).resolves.toEqual({
      ok: false,
      message: "tmux is required but was not found.",
    })
  })
})

function installHookCalls(): string[][] {
  return hooks.map(installHookCall)
}

function installHookCall(hook: (typeof hooks)[number]): string[] {
  return [
    "tmux",
    "set-hook",
    "-g",
    hookTarget(hook),
    `wait-for -S ${channel()}`,
  ]
}

function unsetHookCalls(): string[][] {
  return hooks.map(unsetHookCall)
}

function unsetHookCall(hook: (typeof hooks)[number]): string[] {
  return ["tmux", "set-hook", "-gu", hookTarget(hook)]
}

function waitForCall(): string[] {
  return ["tmux", "wait-for", channel()]
}

function hookTarget(hook: string): string {
  return `${hook}[${process.pid}]`
}

function channel(): string {
  return `t.watch-sessions-${process.pid}`
}

function processResult(options: {
  exited: Promise<number>
  kill?: () => void
  stderr?: string
  stdout?: string
}): ReturnType<typeof Bun.spawn> {
  return {
    exited: options.exited,
    kill: options.kill ?? mock(),
    stderr: options.stderr ?? "",
    stdout: options.stdout ?? "",
  } as ReturnType<typeof Bun.spawn>
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })

  return { promise, resolve }
}

async function waitForMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
