import {
  BoxRenderable,
  RGBA,
  StyledText,
  TextRenderable,
  dim,
  fg,
  type CliRenderer,
} from "@opentui/core";

type ScreenContent = string | StyledText;

const terminalFg = RGBA.defaultForeground();
const terminalBg = RGBA.defaultBackground();
const muted = RGBA.fromIndex(8);

export type Screen = {
  setContent: (content: ScreenContent) => void;
};

export function createScreen(renderer: CliRenderer, initialContent: ScreenContent): Screen {
  renderer.setBackgroundColor(terminalBg);

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
      { __isChunk: true, text: "j/k", attributes: 0 },
      dim(fg(muted)(" select  ")),
      { __isChunk: true, text: "enter", attributes: 0 },
      dim(fg(muted)(" focus  ")),
      { __isChunk: true, text: "ctrl+c", attributes: 0 },
      dim(fg(muted)(" exit")),
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
