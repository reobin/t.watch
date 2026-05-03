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
  windows: number
  attached: boolean
  createdAt: Date
  activityAt: Date
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
