import { RGBA, TextRenderable, type CliRenderer, type StyledText } from "@opentui/core"

type ScreenContent = string | StyledText

const systemFg = RGBA.defaultForeground("#e5e7eb")
const systemBg = RGBA.defaultBackground("#111827")

export type Screen = {
  setContent: (content: ScreenContent) => void
}

export function createScreen(
  renderer: CliRenderer,
  initialContent: ScreenContent,
): Screen {
  renderer.setBackgroundColor(systemBg)

  const view = new TextRenderable(renderer, {
    id: "session-list",
    content: initialContent,
    fg: systemFg,
    bg: "transparent",
  })

  renderer.root.add(view)

  return {
    setContent: (content) => {
      view.content = content
    },
  }
}
