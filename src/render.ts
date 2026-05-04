import { StyledText, bold, type TextChunk } from "@opentui/core"
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

export function renderSessions(sessions: TmuxSession[]): StyledText {
  return new StyledText([
    textChunk(`${title}\n\nSessions\n\n`),
    ...sessions.flatMap((session, index) => [
      textChunk(index === 0 ? "" : "\n"),
      renderSession(session),
    ]),
  ])
}

function renderSession(session: TmuxSession): TextChunk {
  const content = `${session.attached ? ">" : "*"} ${session.name} ${session.windows}w ${session.panes}p`

  return session.attached ? bold(content) : textChunk(content)
}

function textChunk(text: string): TextChunk {
  return { __isChunk: true, text, attributes: 0 }
}
