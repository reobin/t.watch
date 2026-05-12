import {
  BoxRenderable,
  RGBA,
  StyledText,
  TextRenderable,
  fg,
  type CliRenderer,
  type TextChunk,
} from "@opentui/core";
import { createCommandPanelOverlay } from "./command-panel";
import type { RenderTheme } from "./render";

type ScreenContent = string | StyledText;

const terminalFg = RGBA.defaultForeground();
const terminalBg = RGBA.defaultBackground();
const muted = RGBA.fromIndex(8);

type Screen = {
  contentHeight: () => number;
  setContentScrollY: (scrollY: number) => void;
  setCommandPanel: (content: ScreenContent) => void;
  setCommandPanelVisible: (visible: boolean) => void;
  setCommandPanelWidth: (width: number) => void;
  setContent: (content: ScreenContent) => void;
  setModeIndicator: (mode: string | undefined) => void;
};

export function createScreen(
  renderer: CliRenderer,
  initialContent: ScreenContent,
  theme: RenderTheme = {},
): Screen {
  renderer.setBackgroundColor(terminalBg);
  const textMutedFg = theme.textMutedFg ?? muted;
  const backdropBg = commandPanelBackdropColor(theme);
  let modeIndicator: string | undefined;

  const layout = new BoxRenderable(renderer, {
    id: "screen-layout",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: terminalBg,
  });

  const view = new TextRenderable(renderer, {
    id: "session-list",
    content: initialContent,
    width: "100%",
    flexGrow: 1,
    fg: terminalFg,
    bg: "transparent",
    overflow: "hidden",
  });

  const footer = new TextRenderable(renderer, {
    id: "shortcut-footer",
    content: "",
    width: "100%",
    height: 1,
    fg: terminalFg,
    bg: "transparent",
  });

  const statusLine = new TextRenderable(renderer, {
    id: "status-line",
    content: "",
    width: "100%",
    height: 0,
    fg: terminalFg,
    bg: "transparent",
  });

  updateStatusLine(renderer.width);
  updateFooter(renderer.width);
  renderer.on("resize", (width) => {
    updateStatusLine(width);
    updateFooter(width);
  });

  layout.add(view);
  layout.add(statusLine);
  layout.add(footer);
  renderer.root.add(layout);

  const commandPanel = createCommandPanelOverlay(renderer, {
    backdrop: backdropBg,
    background: terminalBg,
    foreground: terminalFg,
    mutedForeground: textMutedFg,
  });

  return {
    contentHeight: () => Math.max(1, view.height),
    setContentScrollY: (scrollY) => {
      view.scrollY = scrollY;
    },
    setCommandPanel: (content) => {
      commandPanel.setContent(content);
    },
    setCommandPanelVisible: (visible) => {
      commandPanel.setVisible(visible);
    },
    setCommandPanelWidth: (width) => {
      commandPanel.setWidth(width);
    },
    setContent: (content) => {
      view.content = content;
    },
    setModeIndicator: (mode) => {
      modeIndicator = mode;
      updateStatusLine(renderer.width);
    },
  };

  function updateStatusLine(width: number): void {
    const content = renderStatusLine(textMutedFg, width, modeIndicator);

    statusLine.content = content;
    statusLine.height = modeIndicator ? lineCount(content) : 0;
  }

  function updateFooter(width: number): void {
    const content = renderShortcutFooter(textMutedFg, width);

    footer.content = content;
    footer.height = lineCount(content);
  }
}

export function renderStatusLine(
  textMutedFg: RGBA,
  width: number,
  modeIndicator?: string,
): StyledText {
  const chunks = modeIndicator
    ? fitLine([fg(terminalFg)("mode"), fg(textMutedFg)(` ${modeIndicator}`)], Math.max(1, width))
    : [];

  return new StyledText(chunks);
}

export function commandPanelBackdropColor(_theme: RenderTheme = {}): RGBA {
  return RGBA.fromInts(0, 0, 0, 0);
}

export function renderShortcutFooter(textMutedFg: RGBA, width: number): StyledText {
  const items = [
    [fg(terminalFg)("ctrl+p"), fg(textMutedFg)(" commands")],
    [fg(terminalFg)("?"), fg(textMutedFg)(" help")],
  ];
  const chunks: TextChunk[] = [];
  let lineLength = 0;
  const maxWidth = Math.max(1, width);

  items.forEach((item, index) => {
    const separator = index === 0 ? [] : [fg(textMutedFg)("  ")];
    const itemLength = lineLengthOf([...separator, ...item]);

    if (lineLength > 0 && lineLength + itemLength > maxWidth) {
      chunks.push(textChunk("\n"));
      lineLength = 0;
    } else if (separator.length > 0) {
      chunks.push(...separator);
      lineLength += lineLengthOf(separator);
    }

    const fittedItem = fitLine(item, maxWidth - lineLength);

    chunks.push(...fittedItem);
    lineLength += lineLengthOf(fittedItem);
  });

  return new StyledText(chunks);
}

function fitLine(chunks: TextChunk[], width: number): TextChunk[] {
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

function lineCount(content: StyledText): number {
  return content.chunks.reduce((lines, chunk) => lines + chunk.text.split("\n").length - 1, 1);
}

function lineLengthOf(chunks: TextChunk[]): number {
  return chunks.reduce((length, chunk) => length + chunk.text.length, 0);
}

function textChunk(text: string): TextChunk {
  return { __isChunk: true, text, attributes: 0 };
}
