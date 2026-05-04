import {
  StyledText,
  bgBlack,
  bgCyan,
  bgGreen,
  bgRed,
  bgYellow,
  black,
  bold,
  brightBlack,
  cyan,
  dim,
  white,
  type TextChunk,
} from "@opentui/core"
import type { TmuxPane, TmuxPaneIntegrationStatus, TmuxSession } from "./tmux"

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

  return [textChunk(" "), statusColor(integration.status)(`[${label}]`)]
}

function statusColor(
  status: TmuxPaneIntegrationStatus,
): (text: string) => TextChunk {
  switch (status) {
    case "idle":
      return (text) => bold(bgGreen(black(text)))
    case "working":
      return (text) => bold(bgCyan(black(text)))
    case "waiting":
      return (text) => bold(bgYellow(black(text)))
    case "error":
      return (text) => bold(bgRed(white(text)))
    case "unknown":
      return (text) => dim(bgBlack(white(text)))
  }
}

function statusLabel(status: TmuxPaneIntegrationStatus): string {
  switch (status) {
    case "idle":
      return "Idle"
    case "working":
      return "Working"
    case "waiting":
      return "Waiting"
    case "error":
      return "Error"
    case "unknown":
      return "Unknown"
  }
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
