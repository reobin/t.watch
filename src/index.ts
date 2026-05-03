import { createCliRenderer, TextRenderable } from "@opentui/core"
import { checkTmux } from "./tmux"

const renderer = await createCliRenderer({ exitOnCtrlC: true })

const tmux = await checkTmux()

const content = tmux.ok
  ? `twatch\n\n${tmux.version}`
  : `twatch\n\n${tmux.message}`

renderer.root.add(new TextRenderable(renderer, { id: "tmux-check", content }))
