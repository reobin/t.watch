import {
  BoxRenderable,
  RGBA,
  StyledText,
  TextRenderable,
  fg,
  type CliRenderer,
} from "@opentui/core";
import type { RenderTheme } from "./render";

type ScreenContent = string | StyledText;

const terminalFg = RGBA.defaultForeground();
const terminalBg = RGBA.defaultBackground();
const muted = RGBA.fromIndex(8);

export type Screen = {
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
    content: new StyledText([
      fg(terminalFg)("j/k ↑/↓"),
      fg(textMutedFg)(" select  "),
      fg(terminalFg)("↵"),
      fg(textMutedFg)(" focus  "),
      fg(terminalFg)("^C"),
      fg(textMutedFg)(" exit"),
    ]),
    width: "100%",
    height: 1,
    fg: terminalFg,
    bg: "transparent",
  });

  layout.add(view);
  layout.add(footer);
  renderer.root.add(layout);

  return {
    setContent: (content) => {
      view.content = content;
    },
  };
}
