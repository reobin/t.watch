import { homedir } from "node:os";
import { RGBA, StyledText, bold, fg, type TextChunk } from "@opentui/core";
import type { TmuxPane, TmuxPaneIntegrationStatus, TmuxSession } from "./tmux";

const palette = {
  red: 1,
  green: 2,
  magenta: 5,
  cyan: 6,
  gitDirty: 5,
  brightCyan: 14,
  gray: 8,
  selectedBg: 235,
} as const;
const rowLeftGutterWidth = 2;
const rowRightGutterWidth = 2;

export type RenderTheme = {
  selectedBg?: RGBA;
  selectedPaneId?: string;
  textMutedFg?: RGBA;
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
  const textMutedFg = theme.textMutedFg ?? RGBA.fromIndex(palette.gray);

  return new StyledText(
    sessions.flatMap((session, index) => [
      textChunk(index === 0 ? "" : "\n"),
      ...renderSession(
        session,
        selectedSessionId,
        theme.selectedPaneId,
        selectedBg,
        textMutedFg,
        theme.width,
      ),
    ]),
  );
}

function renderSession(
  session: TmuxSession,
  selectedSessionId: string | undefined,
  selectedPaneId: string | undefined,
  selectedBg: RGBA,
  textMutedFg: RGBA,
  width: number | undefined,
): TextChunk[] {
  const headerText = session.path
    ? formatPathHeader(session, sessionHeaderContentWidth(width))
    : formatSessionLabel(session);
  const header = session.path
    ? headerText
    : fitMiddle(headerText, sessionHeaderContentWidth(width));
  const chunks: TextChunk[] = [
    renderSessionHeader(header, session),
    ...renderSessionMetadata(session, textMutedFg, width),
  ];
  const isSelectedSession = session.id === selectedSessionId;

  session.windows.forEach((window) => {
    window.panes.forEach((pane, paneIndex) => {
      const isSelectedPane = isSelectedSession && pane.id === selectedPaneId;
      const branch = windowPaneBranch(window.panes.length, paneIndex);
      const rowChunks = [
        muted("\n", textMutedFg),
        isSelectedPane ? terminalFg(palette.brightCyan, "▶─") : muted(branch, textMutedFg),
        ...renderPaneName(
          pane,
          session.attached && window.active && pane.active,
          session.sshAttached,
          textMutedFg,
          paneIndex < window.panes.length - 1,
          width,
        ),
      ];

      chunks.push(...rowChunks);
    });
  });

  return sessionBlock(chunks, isSelectedSession, selectedBg, width);
}

function renderSessionMetadata(
  session: TmuxSession,
  textMutedFg: RGBA,
  width: number | undefined,
): TextChunk[] {
  const metadata = fitOptional(formatSessionMetadata(session), metadataContentWidth(width));

  return metadata ? renderGitStatus(metadata, session.gitDirty, textMutedFg) : [];
}

function sessionHeaderContentWidth(width: number | undefined): number | undefined {
  return rowContentWidth(width, 0);
}

function metadataContentWidth(width: number | undefined): number | undefined {
  return rowContentWidth(width, 0);
}

function rowContentWidth(
  width: number | undefined,
  leftContentPrefixWidth: number,
): number | undefined {
  if (width === undefined) {
    return undefined;
  }

  return Math.max(0, width - rowLeftGutterWidth - leftContentPrefixWidth - rowRightGutterWidth);
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

function formatSessionMetadata(session: TmuxSession): string | undefined {
  const branch = formatBranch(session);

  if (!session.path) {
    return branch;
  }

  return branch;
}

function formatSessionLabel(session: TmuxSession): string {
  return `${session.name}${session.sshAttached ? " <ssh>" : ""}`;
}

function formatPathHeader(session: TmuxSession, width: number | undefined): string {
  const path = formatPath(session.path ?? "");
  const label = formatSessionLabel(session);

  if (width === undefined) {
    return `${path}  ${label}`;
  }

  const gap = "  ";
  const labelReserve = Math.min(label.length, Math.max(0, Math.floor(width / 2)));
  const leftWidth = Math.max(0, width - gap.length - labelReserve);

  if (leftWidth <= 0) {
    return fitPath(path, width);
  }

  const left = fitPath(path, leftWidth);
  const right = fitMiddle(label, Math.max(0, width - gap.length - left.length));
  const padding = " ".repeat(Math.max(gap.length, width - left.length - right.length));

  return `${left}${padding}${right}`;
}

function fitOptional(text: string | undefined, width: number | undefined): string | undefined {
  return text === undefined ? undefined : fitMiddle(text, width);
}

function fitMiddle(text: string, width: number | undefined): string {
  if (width === undefined || text.length <= width) {
    return text;
  }

  const marker = "...";

  if (width <= marker.length) {
    return marker.slice(0, width);
  }

  const prefixLength = Math.ceil((width - marker.length) / 2);
  const suffixLength = width - marker.length - prefixLength;

  return `${text.slice(0, prefixLength)}${marker}${text.slice(text.length - suffixLength)}`;
}

function fitEnd(text: string, width: number | undefined): string {
  if (width === undefined || text.length <= width) {
    return text;
  }

  const marker = "...";

  if (width <= marker.length) {
    return marker.slice(0, width);
  }

  return `${text.slice(0, width - marker.length)}${marker}`;
}

function fitPath(path: string, width: number | undefined): string {
  if (width === undefined || path.length <= width) {
    return path;
  }

  const marker = "...";

  if (width <= marker.length) {
    return marker.slice(0, width);
  }

  const lastSeparatorIndex = path.lastIndexOf("/");
  const suffix = lastSeparatorIndex > 0 ? path.slice(lastSeparatorIndex) : "";

  if (suffix.length > 0 && marker.length + suffix.length >= width) {
    return `${marker}${suffix.slice(marker.length + suffix.length - width)}`;
  }

  const prefixLength = width - marker.length - suffix.length;

  return `${path.slice(0, prefixLength)}${marker}${suffix}`;
}

function formatBranch(session: TmuxSession): string | undefined {
  return session.gitBranch ? `${session.gitBranch}${session.gitDirty ? "*" : ""}` : undefined;
}

function renderGitStatus(
  metadata: string,
  dirty: boolean | undefined,
  textMutedFg: RGBA,
): TextChunk[] {
  const dirtyMarker = dirty && metadata.endsWith("*") ? metadata.slice(-1) : "";
  const branch = dirtyMarker ? metadata.slice(0, -1) : metadata;

  return [
    muted(`\n${branch}`, textMutedFg),
    ...(dirtyMarker ? [terminalFg(palette.gitDirty, dirtyMarker)] : []),
  ];
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
  isSshAttachedSession: boolean,
  textMutedFg: RGBA,
  hasFollowingPane: boolean,
  width: number | undefined,
): TextChunk[] {
  return [
    renderPaneProcessName(pane, isActive, isSshAttachedSession),
    ...renderStatusPill(pane, textMutedFg),
    ...renderPaneContext(pane, textMutedFg, hasFollowingPane, width),
  ];
}

function renderPaneContext(
  pane: TmuxPane,
  textMutedFg: RGBA,
  hasFollowingPane: boolean,
  width: number | undefined,
): TextChunk[] {
  const title = opencodeTitle(pane);
  const prefix = hasFollowingPane ? "│  " : "   ";

  return title
    ? [muted(`\n${prefix}${fitEnd(title, paneContextContentWidth(width))}`, textMutedFg)]
    : [];
}

function paneContextContentWidth(width: number | undefined): number | undefined {
  return rowContentWidth(width, 3);
}

function opencodeTitle(pane: TmuxPane): string | undefined {
  if (pane.processName !== "opencode" && pane.integration?.tool !== "opencode") {
    return undefined;
  }

  const title = pane.title
    .replace(/^OC \|\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  return title && title !== pane.title ? title : undefined;
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

function renderStatusPill(pane: TmuxPane, textMutedFg: RGBA): TextChunk[] {
  const integration = pane.integration;

  if (!integration) {
    return [];
  }

  const label = integration.label ?? statusLabel(integration.status);

  return [
    textChunk(" "),
    statusCircle(integration.status, textMutedFg),
    muted(` ${label}`, textMutedFg),
  ];
}

function statusCircle(status: TmuxPaneIntegrationStatus, textMutedFg: RGBA): TextChunk {
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
      return fg(textMutedFg)("●");
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

function muted(text: string, textMutedFg: RGBA): TextChunk {
  return fg(textMutedFg)(text);
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
