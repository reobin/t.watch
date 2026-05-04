import {
  StyledText,
  bold,
  brightBlack,
  cyan,
  dim,
  type TextChunk,
} from "@opentui/core"
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
  const sessionLabel = sessions.length === 1 ? "session" : "sessions"

  return new StyledText([
    bold(title),
    muted(`  ${sessions.length} ${sessionLabel}\n\n`),
    ...sessions.flatMap((session, index) => [
      textChunk(index === 0 ? "" : "\n"),
      ...renderSession(session),
    ]),
  ])
}

function renderSession(session: TmuxSession): TextChunk[] {
  const marker = session.attached ? "●" : "○"
  const header = `${marker} ${session.name}`
  const chunks: TextChunk[] = [
    session.attached ? active(header) : textChunk(header),
  ]

  session.windows.forEach((window) => {
    window.panes.forEach((pane, paneIndex) => {
      const branch = windowPaneBranch(window.panes.length, paneIndex)
      chunks.push(
        muted("\n  "),
        muted(branch),
        session.attached && window.active && pane.active
          ? active(` ${pane.processName}`)
          : textChunk(` ${pane.processName}`),
      )
    })
  })

  return chunks
}

function active(text: string): TextChunk {
  return bold(cyan(text))
}

function muted(text: string): TextChunk {
  return dim(brightBlack(text))
}

function windowPaneBranch(paneCount: number, paneIndex: number): string {
  if (paneCount === 1) {
    return "╶─"
  }

  if (paneIndex === 0) {
    return "╭─"
  }

  if (paneIndex === paneCount - 1) {
    return "╰─"
  }

  return "├─"
}

function textChunk(text: string): TextChunk {
  return { __isChunk: true, text, attributes: 0 }
}
