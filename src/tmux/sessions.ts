import { missingTmuxMessage, runTmux } from "./commands"
import type { TmuxSession, TmuxSessionsResult } from "./types"

const sessionSeparator = "\x1f"
const sessionFormat = [
  "#{session_id}",
  "#{session_name}",
  "#{session_windows}",
  "#{session_attached}",
  "#{session_created}",
  "#{session_activity}",
].join(sessionSeparator)

export async function listSessions(): Promise<TmuxSessionsResult> {
  try {
    const result = await runTmux(["list-sessions", "-F", sessionFormat])

    if (result.exitCode === 0) {
      return {
        ok: true,
        sessions: result.stdout
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .map(parseSession),
      }
    }

    if (isNoSessionsError(result.stderr)) {
      return { ok: true, sessions: [] }
    }

    return {
      ok: false,
      message:
        result.stderr.trim() ||
        result.stdout.trim() ||
        "tmux session listing failed.",
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
