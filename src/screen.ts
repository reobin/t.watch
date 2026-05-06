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

export type Screen = {
  setCommandPanel: (content: ScreenContent) => void;
  setCommandPanelVisible: (visible: boolean) => void;
  setCommandPanelWidth: (width: number) => void;
  setContent: (content: ScreenContent) => void;
};

export function createScreen(
  renderer: CliRenderer,
  initialContent: ScreenContent,
  theme: RenderTheme = {},
): Screen {
  renderer.setBackgroundColor(terminalBg);
  const textMutedFg = theme.textMutedFg ?? muted;

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
  });

  const footer = new TextRenderable(renderer, {
    id: "shortcut-footer",
    content: "",
    width: "100%",
    height: 1,
    fg: terminalFg,
    bg: "transparent",
  });

  updateFooter(renderer.width);
  renderer.on("resize", updateFooter);

  layout.add(view);
  layout.add(footer);
  renderer.root.add(layout);

  const commandPanel = createCommandPanelOverlay(renderer, {
    background: terminalBg,
    foreground: terminalFg,
    mutedForeground: textMutedFg,
  });

  return {
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
  };

  function updateFooter(width: number): void {
    const content = renderShortcutFooter(textMutedFg, width);

    footer.content = content;
    footer.height = lineCount(content);
  }
}

function renderShortcutFooter(textMutedFg: RGBA, width: number): StyledText {
  const items = [
    [fg(terminalFg)("j/k"), fg(textMutedFg)(" select")],
    [fg(terminalFg)("↵"), fg(textMutedFg)(" focus")],
    [fg(terminalFg)("ctrl+p"), fg(textMutedFg)(" commands")],
    [fg(terminalFg)("q"), fg(textMutedFg)(" quit")],
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
