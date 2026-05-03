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

const missingTmuxMessage = "tmux is required but was not found."
const sessionSeparator = "\x1f"
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
