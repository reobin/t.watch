import { createCliRenderer, TextRenderable } from "@opentui/core"

const renderer = await createCliRenderer({ exitOnCtrlC: true })

renderer.root.add(
  new TextRenderable(renderer, {
    id: "hello-world",
    content: "Hello world! Press Ctrl+C to exit.",
  }),
)
