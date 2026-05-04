import { missingTmuxMessage, runTmux } from "./commands"
import type { TmuxSessionWatchResult } from "./types"

const sessionChangeHooks = [
  "session-created",
  "session-closed",
  "session-renamed",
  "client-attached",
  "client-detached",
  "client-session-changed",
] as const

export async function watchSessions(
  onChange: () => void | Promise<void>,
  onStop?: (message: string) => void,
): Promise<TmuxSessionWatchResult> {
  const hookIndex = String(process.pid)
  const channel = `t.watch-sessions-${process.pid}`
  const installedHooks: string[] = []
  let waitProcess: ReturnType<typeof Bun.spawn> | undefined
  let stopped = false
  let refreshTimeout: ReturnType<typeof setTimeout> | undefined

  try {
    for (const hook of sessionChangeHooks) {
      const hookTarget = `${hook}[${hookIndex}]`
      const result = await runTmux([
        "set-hook",
        "-g",
        hookTarget,
        `wait-for -S ${channel}`,
      ])

      if (result.exitCode !== 0) {
        await unsetHooks(installedHooks)

        return {
          ok: false,
          message: result.stderr.trim() || "tmux session watcher failed.",
        }
      }

      installedHooks.push(hookTarget)
    }
  } catch (error) {
    await unsetHooks(installedHooks)

    if (error instanceof Error && error.message.includes("ENOENT")) {
      return { ok: false, message: missingTmuxMessage }
    }

    throw error
  }

  const scheduleRefresh = () => {
    if (refreshTimeout) {
      return
    }

    refreshTimeout = setTimeout(() => {
      refreshTimeout = undefined
      void onChange()
    }, 75)
  }

  const waitForChanges = async () => {
    while (!stopped) {
      const tmuxProcess = Bun.spawn(["tmux", "wait-for", channel], {
        stderr: "pipe",
        stdout: "pipe",
      })
      waitProcess = tmuxProcess

      const [exitCode, stderr] = await Promise.all([
        tmuxProcess.exited,
        new Response(tmuxProcess.stderr).text(),
      ])

      if (stopped) {
        break
      }

      if (exitCode !== 0) {
        stopped = true
        await unsetHooks(installedHooks)
        onStop?.(stderr.trim() || "tmux session watcher stopped.")
        break
      }

      scheduleRefresh()
    }
  }

  void waitForChanges()

  return {
    ok: true,
    watcher: {
      stop: async () => {
        stopped = true

        if (refreshTimeout) {
          clearTimeout(refreshTimeout)
          refreshTimeout = undefined
        }

        waitProcess?.kill()
        await unsetHooks(installedHooks)
      },
    },
  }
}

async function unsetHooks(hooks: string[]): Promise<void> {
  await Promise.all(
    hooks.map((hook) => runTmux(["set-hook", "-gu", hook]).catch(() => undefined)),
  )
}
