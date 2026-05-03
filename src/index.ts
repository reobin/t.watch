import { createCliRenderer, RGBA, TextRenderable } from "@opentui/core"
import {
  checkTmux,
  listSessions,
  watchSessions,
  type TmuxSession,
  type TmuxSessionWatcher,
} from "./tmux"

let isDestroyed = false
let refreshTimer: ReturnType<typeof setInterval> | undefined
let sessionWatcher: TmuxSessionWatcher | undefined
let isStartingWatcher = false

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  onDestroy: () => {
    isDestroyed = true

    if (refreshTimer) {
      clearInterval(refreshTimer)
    }

    void sessionWatcher?.stop()
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
  await ensureSessionWatcher()
  await refreshSessions()

  if (!sessionWatcher) {
    startRefreshPolling()
  }
} else {
  view.content = `twatch\n\n${tmux.message}`
}

async function ensureSessionWatcher(): Promise<void> {
  if (isDestroyed || sessionWatcher || isStartingWatcher) {
    return
  }

  isStartingWatcher = true
  try {
    const result = await watchSessions(
      refreshSessions,
      () => {
        sessionWatcher = undefined
        startRefreshPolling()
      },
    )

    if (isDestroyed) {
      if (result.ok === true) {
        await result.watcher.stop()
      }

      return
    }

    if (result.ok === true) {
      sessionWatcher = result.watcher

      if (refreshTimer) {
        clearInterval(refreshTimer)
        refreshTimer = undefined
      }
    }
  } finally {
    isStartingWatcher = false
  }
}

function startRefreshPolling(): void {
  if (isDestroyed || refreshTimer) {
    return
  }

  refreshTimer = setInterval(() => {
    void refreshSessions()
    void ensureSessionWatcher()
  }, refreshIntervalMs)
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
