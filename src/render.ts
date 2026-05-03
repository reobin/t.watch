import type { TmuxSession } from "./tmux"

const title = "t.watch"

export function renderLoading(): string {
  return renderMessage("Loading tmux sessions...")
}

export function renderMessage(message: string): string {
  return `${title}\n\n${message}`
}

export function renderNoSessions(): string {
  return renderMessage("No tmux sessions running.")
}

export function renderSessions(sessions: TmuxSession[]): string {
  return [title, "", "Sessions", "", ...sessions.map(renderSession)].join("\n")
}

function renderSession(session: TmuxSession): string {
  return `* ${session.name}`
}
