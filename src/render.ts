import {
  RGBA,
  StyledText,
  bold,
  dim,
  fg,
  type TextChunk,
} from "@opentui/core"
import type { TmuxPane, TmuxPaneIntegrationStatus, TmuxSession } from "./tmux"

const title = "thud.sh"
const palette = {
  red: 1,
  green: 2,
  magenta: 5,
  cyan: 6,
  gray: 8,
} as const

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
    bold(title),
    textChunk("\n\n"),
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
        ...renderPaneName(pane, session.attached && window.active && pane.active),
      )
    })
  })

  return chunks
}

function renderPaneName(pane: TmuxPane, isActive: boolean): TextChunk[] {
  return [
    isActive ? active(` ${pane.processName}`) : textChunk(` ${pane.processName}`),
    ...renderStatusPill(pane),
  ]
}

function renderStatusPill(pane: TmuxPane): TextChunk[] {
  const integration = pane.integration

  if (!integration) {
    return []
  }

  const label = integration.label ?? statusLabel(integration.status)

  return [textChunk(" "), statusCircle(integration.status), muted(` ${label}`)]
}

function statusCircle(status: TmuxPaneIntegrationStatus): TextChunk {
  switch (status) {
    case "idle":
      return bold(terminalFg(palette.green, "●"))
    case "working":
      return bold(terminalFg(palette.cyan, "●"))
    case "requesting":
      return bold(terminalFg(palette.magenta, "●"))
    case "error":
      return bold(terminalFg(palette.red, "●"))
    case "unknown":
      return dim(terminalFg(palette.gray, "●"))
  }
}

function statusLabel(status: TmuxPaneIntegrationStatus): string {
  switch (status) {
    case "idle":
      return "idle"
    case "working":
      return "working"
    case "requesting":
      return "requesting"
    case "error":
      return "error"
    case "unknown":
      return "unknown"
  }
}

function active(text: string): TextChunk {
  return bold(terminalFg(palette.cyan, text))
}

function muted(text: string): TextChunk {
  return dim(terminalFg(palette.gray, text))
}

function terminalFg(index: number, text: string): TextChunk {
  return fg(RGBA.fromIndex(index))(text)
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
