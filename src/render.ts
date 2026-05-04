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
      ...renderSession(session),
    ]),
  ])
}

function renderSession(session: TmuxSession): TextChunk[] {
  const marker = session.attached ? ">" : "*"
  const header = `${marker} ${session.name}`
  const chunks: TextChunk[] = [
    session.attached ? bold(header) : textChunk(header),
  ]

  for (const window of session.windows) {
    const isCurrentWindow = session.attached && window.active
    const windowText = `${isCurrentWindow ? ">" : "*"} ${window.index} ${window.name}`
    chunks.push(
      isCurrentWindow ? bold(`\n  ${windowText}`) : textChunk(`\n  ${windowText}`),
    )

    for (const pane of window.panes) {
      const isCurrentPane = isCurrentWindow && pane.active
      const paneText = isCurrentPane
        ? `> ${pane.processName}`
        : pane.processName
      chunks.push(
        isCurrentPane ? bold(`\n    ${paneText}`) : textChunk(`\n    ${paneText}`),
      )
    }
  }

  return chunks
}

function textChunk(text: string): TextChunk {
  return { __isChunk: true, text, attributes: 0 }
}
