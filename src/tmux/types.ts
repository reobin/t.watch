export type TmuxCheckResult =
  | {
      ok: true
      version: string
    }
  | {
      ok: false
      message: string
    }

export type TmuxSession = {
  id: string
  name: string
  windows: TmuxWindow[]
  attached: boolean
  createdAt: Date
  activityAt: Date
}

export type TmuxWindow = {
  id: string
  index: number
  name: string
  active: boolean
  panes: TmuxPane[]
}

export type TmuxPane = {
  id: string
  index: number
  active: boolean
  command: string
  title: string
  processName: string
}

export type TmuxSessionsResult =
  | {
      ok: true
      sessions: TmuxSession[]
    }
  | {
      ok: false
      message: string
    }

export type TmuxSessionWatcher = {
  stop: () => Promise<void>
}

export type TmuxSessionWatchResult =
  | {
      ok: true
      watcher: TmuxSessionWatcher
    }
  | {
      ok: false
      message: string
    }
