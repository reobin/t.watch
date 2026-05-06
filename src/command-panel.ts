import {
  BoxRenderable,
  RGBA,
  StyledText,
  TextRenderable,
  bold,
  fg,
  type CliRenderer,
  type TextChunk,
} from "@opentui/core";
import type { RenderTheme } from "./render";

const palette = {
  brightCyan: 14,
  cyan: 6,
  gray: 8,
  selectedBg: 235,
} as const;

export type CommandPanelContent = string | StyledText;

export type CommandPanelItem = {
  description?: string;
  label: string;
};

export type CommandPanelOverlay = {
  setContent: (content: CommandPanelContent) => void;
  setVisible: (visible: boolean) => void;
  setWidth: (width: number) => void;
};

const backdropOpacity = 0.35;
const fullHelpMinWidth = 48;
const alignedHelpMinWidth = 28;

export function renderCommandPanel(
  commands: CommandPanelItem[],
  selectedIndex: number,
  theme: RenderTheme = {},
): StyledText {
  const selectedBg = theme.selectedBg ?? RGBA.fromIndex(palette.selectedBg);
  const textMutedFg = theme.textMutedFg ?? RGBA.fromIndex(palette.gray);
  const chunks: TextChunk[] = [active("Commands"), textChunk("\n")];

  commands.forEach((command, index) => {
    const isSelected = index === selectedIndex;
    const marker = isSelected ? "▎ " : "  ";
    const lineChunks = [
      isSelected ? terminalFg(palette.brightCyan, marker) : textChunk(marker),
      isSelected ? bold(textChunk(command.label)) : textChunk(command.label),
      ...(command.description ? [muted(`  ${command.description}`, textMutedFg)] : []),
    ];
    const fittedLineChunks = fitLine(lineChunks, theme.width);

    chunks.push(
      textChunk("\n"),
      ...highlightLine(fittedLineChunks, isSelected, selectedBg, theme.width),
    );
  });

  const footerChunks = renderCommandFooter(textMutedFg, theme.width);

  chunks.push(textChunk("\n\n"), ...footerChunks);

  return new StyledText(chunks);
}

export function renderHelpPanel(theme: RenderTheme = {}): StyledText {
  const textMutedFg = theme.textMutedFg ?? RGBA.fromIndex(palette.gray);
  const items = [
    {
      shortcut: "j/k, up/down",
      compactShortcut: "j/k",
      description: "Select sessions, panes, or commands",
      compactDescription: "select",
    },
    {
      shortcut: "enter",
      description: "Focus or run the selected item",
      compactDescription: "focus/run",
    },
    {
      shortcut: "tab",
      description: "Select panes in the selected session",
      compactDescription: "select panes",
    },
    {
      shortcut: "esc",
      description: "Close help, commands, or pane navigation",
      compactDescription: "close",
    },
    {
      shortcut: "J",
      description: "Jump to the next agent pane that needs attention",
      compactDescription: "needs attention",
    },
    {
      shortcut: "ctrl+p",
      compactShortcut: "^P",
      description: "Open commands",
      compactDescription: "commands",
    },
    { shortcut: "m", description: "Cycle focus mode", compactDescription: "mode" },
    { shortcut: "?", description: "Show this help", compactDescription: "help" },
    { shortcut: "q", description: "Quit", compactDescription: "quit" },
  ];
  const mode = helpPanelMode(theme.width);
  const title =
    theme.width !== undefined && theme.width < "Keyboard Shortcuts".length
      ? "Help"
      : "Keyboard Shortcuts";
  const helpItems = items.map((item) => ({
    shortcut: mode === "full" ? item.shortcut : (item.compactShortcut ?? item.shortcut),
    description: mode === "full" ? item.description : item.compactDescription,
  }));
  const shortcutWidth = Math.max(...helpItems.map((item) => item.shortcut.length));
  const chunks: TextChunk[] = [...fitLine([active(title)], theme.width), textChunk("\n")];

  helpItems.forEach((item) => {
    chunks.push(textChunk("\n"));

    chunks.push(
      ...renderHelpRow(
        item.shortcut,
        item.description,
        mode === "tight" ? item.shortcut.length : shortcutWidth,
        textMutedFg,
        theme.width,
      ),
    );
  });

  chunks.push(textChunk("\n\n"), ...renderHelpFooter(textMutedFg, theme.width));

  return new StyledText(chunks);
}

export function createCommandPanelOverlay(
  renderer: CliRenderer,
  colors: {
    background: RGBA;
    foreground: RGBA;
    mutedForeground: RGBA;
  },
): CommandPanelOverlay {
  const overlay = new BoxRenderable(renderer, {
    id: "command-panel-overlay",
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    zIndex: 100,
    visible: false,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  });

  const backdrop = new BoxRenderable(renderer, {
    id: "command-panel-backdrop",
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    zIndex: 0,
    opacity: backdropOpacity,
    backgroundColor: colors.background,
  });

  const panel = new BoxRenderable(renderer, {
    id: "command-panel-modal",
    width: 40,
    maxWidth: "100%",
    height: "auto",
    zIndex: 1,
    border: true,
    borderColor: colors.mutedForeground,
    backgroundColor: colors.background,
    padding: 1,
  });

  const panelContent = new TextRenderable(renderer, {
    id: "command-panel-content",
    content: "",
    width: "100%",
    fg: colors.foreground,
    bg: "transparent",
  });

  panel.add(panelContent);
  overlay.add(backdrop);
  overlay.add(panel);
  renderer.root.add(overlay);

  return {
    setContent: (content) => {
      panelContent.content = content;
    },
    setVisible: (visible) => {
      overlay.visible = visible;
    },
    setWidth: (width) => {
      panel.width = width;
    },
  };
}

function renderCommandFooter(textMutedFg: RGBA, width: number | undefined): TextChunk[] {
  const items = [
    [active("j/k"), muted(" select", textMutedFg)],
    [active("enter"), muted(" focus", textMutedFg)],
    [active("esc"), muted(" close", textMutedFg)],
  ];

  if (width === undefined) {
    return joinFooterItems(items, textMutedFg);
  }

  const result: TextChunk[] = [];
  let lineLength = 0;

  items.forEach((item, index) => {
    const separator = index === 0 ? [] : [muted("  ", textMutedFg)];
    const itemLength = lineLengthOf([...separator, ...item]);

    if (lineLength > 0 && lineLength + itemLength > width) {
      result.push(textChunk("\n"));
      lineLength = 0;
    } else if (separator.length > 0) {
      result.push(...separator);
      lineLength += lineLengthOf(separator);
    }

    const fittedItem = fitLine(item, width - lineLength);

    result.push(...fittedItem);
    lineLength += lineLengthOf(fittedItem);
  });

  return result;
}

function renderHelpRow(
  shortcut: string,
  description: string,
  shortcutWidth: number,
  textMutedFg: RGBA,
  width: number | undefined,
): TextChunk[] {
  const prefix = helpRowPrefix(width).text;
  const gap = width !== undefined && width < alignedHelpMinWidth ? " " : "  ";
  const rowPrefix = `${prefix}${shortcut.padEnd(shortcutWidth)}${gap}`;
  const continuationPrefix = " ".repeat(rowPrefix.length);

  if (width === undefined) {
    return [
      textChunk(prefix),
      active(shortcut.padEnd(shortcutWidth)),
      muted(`${gap}${description}`, textMutedFg),
    ];
  }

  const descriptionWidth = width - rowPrefix.length;

  if (descriptionWidth <= 0) {
    return fitLine([textChunk(prefix), active(shortcut)], width);
  }

  return wrapWords(description, descriptionWidth).flatMap((line, index) => [
    ...(index === 0
      ? [textChunk(prefix), active(shortcut.padEnd(shortcutWidth)), muted(gap, textMutedFg)]
      : [textChunk("\n"), textChunk(continuationPrefix)]),
    muted(line, textMutedFg),
  ]);
}

function renderHelpFooter(textMutedFg: RGBA, width: number | undefined): TextChunk[] {
  if (width !== undefined && width < 9) {
    return fitLine([active("esc")], width);
  }

  return fitLine([active("esc"), muted(" close", textMutedFg)], width);
}

function helpPanelMode(width: number | undefined): "full" | "compact" | "tight" {
  if (width === undefined || width >= fullHelpMinWidth) {
    return "full";
  }

  if (width >= alignedHelpMinWidth) {
    return "compact";
  }

  return "tight";
}

function helpRowPrefix(width: number | undefined): TextChunk {
  return textChunk(width !== undefined && width < alignedHelpMinWidth ? "" : "  ");
}

function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(" ")) {
    if (line.length === 0) {
      line = word;
      continue;
    }

    if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
      continue;
    }

    lines.push(line);
    line = word;
  }

  if (line.length > 0) {
    lines.push(line);
  }

  return lines.flatMap((line) => splitLongWord(line, width));
}

function splitLongWord(text: string, width: number): string[] {
  if (text.length <= width) {
    return [text];
  }

  const result: string[] = [];

  for (let index = 0; index < text.length; index += width) {
    result.push(text.slice(index, index + width));
  }

  return result;
}

function active(text: string): TextChunk {
  return bold(terminalFg(palette.cyan, text));
}

function highlightLine(
  chunks: TextChunk[],
  isSelected: boolean,
  selectedBg: RGBA,
  width: number | undefined,
): TextChunk[] {
  if (!isSelected) {
    return chunks;
  }

  const result = chunks.map((chunk) => selected(chunk, selectedBg));
  const lineLength = chunks.reduce((length, chunk) => length + chunk.text.length, 0);

  if (width !== undefined && lineLength < width) {
    result.push(selected(textChunk(" ".repeat(width - lineLength)), selectedBg));
  }

  return result;
}

function fitLine(chunks: TextChunk[], width: number | undefined): TextChunk[] {
  if (width === undefined) {
    return chunks;
  }

  const result: TextChunk[] = [];
  let remaining = width;

  for (const chunk of chunks) {
    if (remaining <= 0) {
      break;
    }

    if (chunk.text.length <= remaining) {
      result.push(chunk);
      remaining -= chunk.text.length;
      continue;
    }

    result.push({ ...chunk, text: chunk.text.slice(0, remaining) });
    break;
  }

  return result;
}

function joinFooterItems(items: TextChunk[][], textMutedFg: RGBA): TextChunk[] {
  return items.flatMap((item, index) => [
    ...(index === 0 ? [] : [muted("  ", textMutedFg)]),
    ...item,
  ]);
}

function lineLengthOf(chunks: TextChunk[]): number {
  return chunks.reduce((length, chunk) => length + chunk.text.length, 0);
}

function muted(text: string, textMutedFg: RGBA): TextChunk {
  return fg(textMutedFg)(text);
}

function selected(chunk: TextChunk, selectedBg: RGBA): TextChunk {
  return {
    ...chunk,
    bg: selectedBg,
  };
}

function terminalFg(index: number, text: string): TextChunk {
  return fg(RGBA.fromIndex(index))(text);
}

function textChunk(text: string): TextChunk {
  return { __isChunk: true, text, attributes: 0 };
}
