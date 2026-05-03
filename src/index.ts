import { createCliRenderer, RGBA, TextRenderable } from "@opentui/core"
import { checkTmux, listSessions, type TmuxSession } from "./tmux"

let isDestroyed = false
let refreshTimer: ReturnType<typeof setInterval> | undefined

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  onDestroy: () => {
    isDestroyed = true

    if (refreshTimer) {
      clearInterval(refreshTimer)
    }
  },
})
const systemFg = RGBA.defaultForeground("#e5e7eb")
const systemBg = RGBA.defaultBackground("#111827")
const refreshIntervalMs = 1500

renderer.setBackgroundColor(systemBg)

const view = new TextRenderable(renderer, {
  id: "session-list",
  content: "twatch\n\nLoading tmux sessions...",
  fg: systemFg,
  bg: "transparent",
})

renderer.root.add(view)

const tmux = await checkTmux()

if (tmux.ok === true) {
  await refreshSessions()

  if (!isDestroyed) {
    refreshTimer = setInterval(() => {
      void refreshSessions()
    }, refreshIntervalMs)
  }
} else {
  view.content = `twatch\n\n${tmux.message}`
}

async function refreshSessions(): Promise<void> {
  const result = await listSessions()

  if (isDestroyed) {
    return
  }

  if (result.ok === false) {
    view.content = `twatch\n\n${result.message}`
    return
  }

  if (result.sessions.length === 0) {
    view.content = "twatch\n\nNo tmux sessions running."
    return
  }

  view.content = renderSessions(result.sessions)
}

function renderSessions(sessions: TmuxSession[]): string {
  return ["twatch", "", "Sessions", "", ...sessions.map(renderSession)].join("\n")
}

function renderSession(session: TmuxSession): string {
  return `* ${session.name}`
}
