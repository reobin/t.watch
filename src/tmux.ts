export type TmuxCheckResult =
  | {
      ok: true
      version: string
    }
  | {
      ok: false
      message: string
    }

export type TmuxSession = {
  id: string
  name: string
  windows: number
  attached: boolean
  createdAt: Date
  activityAt: Date
}

export type TmuxSessionsResult =
  | {
      ok: true
      sessions: TmuxSession[]
    }
  | {
      ok: false
      message: string
    }

export type TmuxSessionWatcher = {
  stop: () => Promise<void>
}

export type TmuxSessionWatchResult =
  | {
      ok: true
      watcher: TmuxSessionWatcher
    }
  | {
      ok: false
      message: string
    }

const missingTmuxMessage = "tmux is required but was not found."
const sessionSeparator = "\x1f"
const sessionChangeHooks = [
  "session-created",
  "session-closed",
  "session-renamed",
] as const
const sessionFormat = [
  "#{session_id}",
  "#{session_name}",
  "#{session_windows}",
  "#{session_attached}",
  "#{session_created}",
  "#{session_activity}",
].join(sessionSeparator)

export async function checkTmux(): Promise<TmuxCheckResult> {
  try {
    const process = Bun.spawn(["tmux", "-V"], {
      stderr: "pipe",
      stdout: "pipe",
    })

    const [exitCode, stderr, stdout] = await Promise.all([
      process.exited,
      new Response(process.stderr).text(),
      new Response(process.stdout).text(),
    ])

    if (exitCode === 0) {
      return { ok: true, version: stdout.trim() }
    }

    return {
      ok: false,
      message: stderr.trim() || stdout.trim() || "tmux check failed.",
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      return { ok: false, message: missingTmuxMessage }
    }

    throw error
  }
}

export async function listSessions(): Promise<TmuxSessionsResult> {
  try {
    const process = Bun.spawn(["tmux", "list-sessions", "-F", sessionFormat], {
      stderr: "pipe",
      stdout: "pipe",
    })

    const [exitCode, stderr, stdout] = await Promise.all([
      process.exited,
      new Response(process.stderr).text(),
      new Response(process.stdout).text(),
    ])

    if (exitCode === 0) {
      return {
        ok: true,
        sessions: stdout
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .map(parseSession),
      }
    }

    if (isNoSessionsError(stderr)) {
      return { ok: true, sessions: [] }
    }

    return {
      ok: false,
      message: stderr.trim() || stdout.trim() || "tmux session listing failed.",
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      return { ok: false, message: missingTmuxMessage }
    }

    throw error
  }
}

export async function watchSessions(
  onChange: () => void | Promise<void>,
  onStop?: (message: string) => void,
): Promise<TmuxSessionWatchResult> {
  const hookIndex = String(process.pid)
  const channel = `twatch-sessions-${process.pid}`
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

function parseSession(line: string): TmuxSession {
  const [id, name, windows, attached, createdAt, activityAt] =
    line.split(sessionSeparator)

  return {
    id: id ?? "",
    name: name ?? "",
    windows: Number(windows),
    attached: attached === "1",
    createdAt: new Date(Number(createdAt) * 1000),
    activityAt: new Date(Number(activityAt) * 1000),
  }
}

function isNoSessionsError(stderr: string): boolean {
  const message = stderr.trim().toLowerCase()

  return message.includes("no server running") || message.includes("no sessions")
}

async function runTmux(args: string[]): Promise<{
  exitCode: number
  stderr: string
  stdout: string
}> {
  const tmuxProcess = Bun.spawn(["tmux", ...args], {
    stderr: "pipe",
    stdout: "pipe",
  })

  const [exitCode, stderr, stdout] = await Promise.all([
    tmuxProcess.exited,
    new Response(tmuxProcess.stderr).text(),
    new Response(tmuxProcess.stdout).text(),
  ])

  return { exitCode, stderr, stdout }
}

async function unsetHooks(hooks: string[]): Promise<void> {
  await Promise.all(
    hooks.map((hook) => runTmux(["set-hook", "-gu", hook]).catch(() => undefined)),
  )
}
