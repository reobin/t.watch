import { RGBA, TextRenderable, type CliRenderer } from "@opentui/core"

const systemFg = RGBA.defaultForeground("#e5e7eb")
const systemBg = RGBA.defaultBackground("#111827")

export type Screen = {
  setContent: (content: string) => void
}

export function createScreen(renderer: CliRenderer, initialContent: string): Screen {
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
