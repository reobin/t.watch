import { createCliRenderer, RGBA, TextRenderable } from "@opentui/core"
import { checkTmux } from "./tmux"

const renderer = await createCliRenderer({ exitOnCtrlC: true })
const systemFg = RGBA.defaultForeground("#e5e7eb")
const systemBg = RGBA.defaultBackground("#111827")

renderer.setBackgroundColor(systemBg)

const tmux = await checkTmux()

const content = tmux.ok
  ? `twatch\n\n${tmux.version}`
  : `twatch\n\n${tmux.message}`

renderer.root.add(
  new TextRenderable(renderer, {
    id: "tmux-check",
    content,
    fg: systemFg,
    bg: "transparent",
  }),
)
