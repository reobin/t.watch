import { homedir } from "node:os";
import { RGBA, StyledText, bold, dim, fg, type TextChunk } from "@opentui/core";
import type { TmuxPane, TmuxPaneIntegrationStatus, TmuxSession } from "./tmux";

const palette = {
  red: 1,
  green: 2,
  magenta: 5,
  cyan: 6,
  brightCyan: 14,
  gray: 8,
  selectedBg: 235,
} as const;

export type RenderTheme = {
  selectedBg?: RGBA;
  width?: number;
};

export function renderLoading(): string {
  return renderMessage("Loading tmux sessions...");
}

export function renderMessage(message: string): string {
  return message;
}

export function renderNoSessions(): string {
  return renderMessage("No tmux sessions running.");
}

export function renderSessions(
  sessions: TmuxSession[],
  selectedSessionId?: string,
  theme: RenderTheme = {},
): StyledText {
  const selectedBg = theme.selectedBg ?? RGBA.fromIndex(palette.selectedBg);

  return new StyledText(
    sessions.flatMap((session, index) => [
      textChunk(index === 0 ? "" : "\n"),
      ...renderSession(session, selectedSessionId, selectedBg, theme.width),
    ]),
  );
}

function renderSession(
  session: TmuxSession,
  selectedSessionId: string | undefined,
  selectedBg: RGBA,
  width: number | undefined,
): TextChunk[] {
  const header = `${session.name}${session.sshAttached ? " <ssh>" : ""}`;
  const chunks: TextChunk[] = [
    renderSessionHeader(header, session),
    ...renderSessionMetadata(session),
  ];
  const isSelectedSession = session.id === selectedSessionId;

  session.windows.forEach((window) => {
    window.panes.forEach((pane, paneIndex) => {
      const branch = windowPaneBranch(window.panes.length, paneIndex);
      const rowChunks = [
        muted("\n"),
        muted(branch),
        ...renderPaneName(
          pane,
          session.attached && window.active && pane.active,
          session.sshAttached,
        ),
      ];

      chunks.push(...rowChunks);
    });
  });

  return sessionBlock(chunks, isSelectedSession, selectedBg, width);
}

function renderSessionMetadata(session: TmuxSession): TextChunk[] {
  const lines = [session.path ? formatPath(session.path) : undefined, formatBranch(session)].filter(
    (line): line is string => Boolean(line),
  );

  return lines.map((line) => muted(`\n· ${line}`));
}

function formatPath(path: string): string {
  const home = homedir();

  if (path === home) {
    return "~";
  }

  if (path.startsWith(`${home}/`)) {
    return `~/${path.slice(home.length + 1)}`;
  }

  return path;
}

function formatBranch(session: TmuxSession): string | undefined {
  return session.gitBranch ? `${session.gitBranch}${session.gitDirty ? "*" : ""}` : undefined;
}

function renderSessionHeader(header: string, session: TmuxSession): TextChunk {
  if (session.sshAttached) {
    return bold(terminalFg(palette.magenta, header));
  }

  return session.attached ? active(header) : textChunk(header);
}

function renderPaneName(
  pane: TmuxPane,
  isActive: boolean,
  isSshAttachedSession = false,
): TextChunk[] {
  return [renderPaneProcessName(pane, isActive, isSshAttachedSession), ...renderStatusPill(pane)];
}

function renderPaneProcessName(
  pane: TmuxPane,
  isActive: boolean,
  isSshAttachedSession: boolean,
): TextChunk {
  const name = ` ${pane.processName}`;

  if (isActive && (isSshAttachedSession || pane.ssh)) {
    return bold(terminalFg(palette.magenta, name));
  }

  return isActive ? active(name) : textChunk(name);
}

function renderStatusPill(pane: TmuxPane): TextChunk[] {
  const integration = pane.integration;

  if (!integration) {
    return [];
  }

  const label = integration.label ?? statusLabel(integration.status);

  return [textChunk(" "), statusCircle(integration.status), muted(` ${label}`)];
}

function statusCircle(status: TmuxPaneIntegrationStatus): TextChunk {
  switch (status) {
    case "idle":
      return bold(terminalFg(palette.green, "●"));
    case "working":
      return bold(terminalFg(palette.cyan, "●"));
    case "requesting":
      return bold(terminalFg(palette.magenta, "●"));
    case "error":
      return bold(terminalFg(palette.red, "●"));
    case "unknown":
      return dim(terminalFg(palette.gray, "●"));
  }
}

function statusLabel(status: TmuxPaneIntegrationStatus): string {
  switch (status) {
    case "idle":
      return "idle";
    case "working":
      return "working";
    case "requesting":
      return "requesting";
    case "error":
      return "error";
    case "unknown":
      return "unknown";
  }
}

function active(text: string): TextChunk {
  return bold(terminalFg(palette.cyan, text));
}

function selected(chunk: TextChunk, selectedBg: RGBA): TextChunk {
  return {
    ...chunk,
    bg: selectedBg,
  };
}

function sessionBlock(
  chunks: TextChunk[],
  isSelected: boolean,
  selectedBg: RGBA,
  width: number | undefined,
): TextChunk[] {
  const result: TextChunk[] = [];
  let lineLength = 0;

  startLine();

  chunks.forEach((chunk) => {
    const lines = chunk.text.split("\n");

    lines.forEach((line, index) => {
      if (index > 0) {
        endLine();
        result.push(
          isSelected ? selected({ ...chunk, text: "\n" }, selectedBg) : { ...chunk, text: "\n" },
        );
        startLine();
      }

      if (line) {
        result.push(
          isSelected ? selected({ ...chunk, text: line }, selectedBg) : { ...chunk, text: line },
        );
        lineLength += line.length;
      }
    });
  });

  endLine();

  return result;

  function startLine(): void {
    result.push(sessionBorder(isSelected, selectedBg));
    lineLength = 2;
  }

  function endLine(): void {
    if (!isSelected || width === undefined || lineLength >= width) {
      return;
    }

    result.push(selected(textChunk(" ".repeat(width - lineLength)), selectedBg));
  }
}

function sessionBorder(isSelected: boolean, selectedBg: RGBA): TextChunk {
  const chunk = {
    __isChunk: true,
    text: isSelected ? "▎ " : "  ",
    attributes: 0,
    ...(isSelected ? { fg: RGBA.fromIndex(palette.brightCyan) } : {}),
  } satisfies TextChunk;

  return isSelected ? selected(chunk, selectedBg) : chunk;
}

function muted(text: string): TextChunk {
  return dim(terminalFg(palette.gray, text));
}

function terminalFg(index: number, text: string): TextChunk {
  return fg(RGBA.fromIndex(index))(text);
}

function windowPaneBranch(paneCount: number, paneIndex: number): string {
  if (paneCount === 1) {
    return "╶─";
  }

  if (paneIndex === 0) {
    return "╭─";
  }

  if (paneIndex === paneCount - 1) {
    return "╰─";
  }

  return "├─";
}

function textChunk(text: string): TextChunk {
  return { __isChunk: true, text, attributes: 0 };
}
