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
      const paneCounts = await listPaneCounts()

      return {
        ok: true,
        sessions: result.stdout
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => parseSession(line, paneCounts)),
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

async function listPaneCounts(): Promise<Map<string, number>> {
  const result = await runTmux(["list-panes", "-a", "-F", "#{session_id}"])
  const paneCounts = new Map<string, number>()

  if (result.exitCode !== 0) {
    return paneCounts
  }

  for (const sessionId of result.stdout.trim().split(/\r?\n/).filter(Boolean)) {
    paneCounts.set(sessionId, (paneCounts.get(sessionId) ?? 0) + 1)
  }

  return paneCounts
}

function parseSession(line: string, paneCounts: Map<string, number>): TmuxSession {
  const [id, name, windows, attached, createdAt, activityAt] =
    line.split(sessionSeparator)

  return {
    id: id ?? "",
    name: name ?? "",
    windows: Number(windows),
    panes: paneCounts.get(id ?? "") ?? 0,
    attached: Number(attached) > 0,
    createdAt: new Date(Number(createdAt) * 1000),
    activityAt: new Date(Number(activityAt) * 1000),
  }
}

function isNoSessionsError(stderr: string): boolean {
  const message = stderr.trim().toLowerCase()

  return message.includes("no server running") || message.includes("no sessions")
}
