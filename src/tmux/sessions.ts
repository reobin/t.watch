import { missingTmuxMessage, runTmux } from "./commands"
import type {
  TmuxPane,
  TmuxPaneIntegrationStatus,
  TmuxSession,
  TmuxSessionsResult,
  TmuxWindow,
} from "./types"

const sessionSeparator = "\x1f"
const fieldSeparator = "\x1f"
const sessionFormat = [
  "#{session_id}",
  "#{session_name}",
  "#{session_attached}",
  "#{session_created}",
  "#{session_activity}",
].join(sessionSeparator)
const windowFormat = [
  "#{session_id}",
  "#{window_id}",
  "#{window_index}",
  "#{window_name}",
  "#{window_active}",
].join(fieldSeparator)
const paneFormat = [
  "#{session_id}",
  "#{window_id}",
  "#{pane_id}",
  "#{pane_index}",
  "#{pane_active}",
  "#{pane_current_command}",
  "#{pane_pid}",
  "#{pane_title}",
  "#{@thud_sh_tool}",
  "#{@thud_sh_status}",
  "#{@thud_sh_status_label}",
  "#{@thud_sh_status_updated_at}",
].join(fieldSeparator)

type PaneRecord = TmuxPane & {
  sessionId: string
  windowId: string
  pid: number
}

type ProcessInfo = {
  pid: number
  ppid: number
  command: string
  args: string
}

export async function listSessions(): Promise<TmuxSessionsResult> {
  try {
    const result = await runTmux(["list-sessions", "-F", sessionFormat])

    if (result.exitCode === 0) {
      const [windows, panes, processes] = await Promise.all([
        listWindows(),
        listPanes(),
        listProcesses(),
      ])
      const processTree = createProcessTree(processes)
      const panesByWindow = groupPanesByWindow(panes, processTree)
      const windowsBySession = groupWindowsBySession(windows, panesByWindow)

      return {
        ok: true,
        sessions: result.stdout
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => parseSession(line, windowsBySession)),
      }
    }

    if (isNoSessionsError(result.stderr)) {
      return { ok: true, sessions: [] }
    }

    return {
      ok: false,
      message:
        result.stderr.trim() ||
        result.stdout.trim() ||
        "tmux session listing failed.",
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      return { ok: false, message: missingTmuxMessage }
    }

    throw error
  }
}

async function listWindows(): Promise<Array<TmuxWindow & { sessionId: string }>> {
  const result = await runTmux(["list-windows", "-a", "-F", windowFormat])

  if (result.exitCode !== 0) {
    return []
  }

  return result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseWindow)
}

async function listPanes(): Promise<PaneRecord[]> {
  const result = await runTmux(["list-panes", "-a", "-F", paneFormat])

  if (result.exitCode !== 0) {
    return []
  }

  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(parsePane)
}

async function listProcesses(): Promise<ProcessInfo[]> {
  let psProcess: ReturnType<typeof Bun.spawn>

  try {
    psProcess = Bun.spawn(["ps", "-eo", "pid=,ppid=,comm=,args="], {
      stderr: "pipe",
      stdout: "pipe",
    })
  } catch {
    return []
  }

  const [exitCode, stdout] = await Promise.all([
    psProcess.exited,
    new Response(psProcess.stdout as ReadableStream<Uint8Array>).text(),
  ])

  if (exitCode !== 0) {
    return []
  }

  return stdout.trim().split(/\r?\n/).filter(Boolean).map(parseProcess)
}

function parseSession(
  line: string,
  windowsBySession: Map<string, TmuxWindow[]>,
): TmuxSession {
  const [id, name, attached, createdAt, activityAt] = line.split(sessionSeparator)

  return {
    id: id ?? "",
    name: name ?? "",
    windows: windowsBySession.get(id ?? "") ?? [],
    attached: Number(attached) > 0,
    createdAt: new Date(Number(createdAt) * 1000),
    activityAt: new Date(Number(activityAt) * 1000),
  }
}

function parseWindow(line: string): TmuxWindow & { sessionId: string } {
  const [sessionId, id, index, name, active] = line.split(fieldSeparator)

  return {
    sessionId: sessionId ?? "",
    id: id ?? "",
    index: Number(index),
    name: name ?? "",
    active: Number(active) > 0,
    panes: [],
  }
}

function parsePane(line: string): PaneRecord {
  const [
    sessionId,
    windowId,
    id,
    index,
    active,
    command,
    pid,
    title,
    integrationTool,
    integrationStatus,
    integrationLabel,
    integrationUpdatedAt,
  ] = line.split(fieldSeparator)

  const integration = parsePaneIntegration(
    integrationTool,
    integrationStatus,
    integrationLabel,
    integrationUpdatedAt,
  )

  return {
    sessionId: sessionId ?? "",
    windowId: windowId ?? "",
    id: id ?? "",
    index: Number(index),
    active: Number(active) > 0,
    command: command ?? "",
    title: title ?? "",
    pid: Number(pid),
    processName: command ?? "",
    ...(integration ? { integration } : {}),
  }
}

function parsePaneIntegration(
  tool: string | undefined,
  status: string | undefined,
  label: string | undefined,
  updatedAt: string | undefined,
): PaneRecord["integration"] {
  const parsedStatus = parsePaneIntegrationStatus(status)

  if (!tool && !parsedStatus) {
    return undefined
  }

  const timestamp = Number(updatedAt)

  return {
    tool: tool || "unknown",
    status: parsedStatus ?? "unknown",
    label: label || undefined,
    updatedAt: Number.isFinite(timestamp) && timestamp > 0
      ? new Date(timestamp * 1000)
      : undefined,
  }
}

function parsePaneIntegrationStatus(
  status: string | undefined,
): TmuxPaneIntegrationStatus | undefined {
  if (
    status === "idle" ||
    status === "working" ||
    status === "requesting" ||
    status === "error" ||
    status === "unknown"
  ) {
    return status
  }

  return undefined
}

function parseProcess(line: string): ProcessInfo {
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/)

  return {
    pid: Number(match?.[1] ?? 0),
    ppid: Number(match?.[2] ?? 0),
    command: match?.[3] ?? "",
    args: match?.[4] ?? "",
  }
}

function createProcessTree(processes: ProcessInfo[]): Map<number, ProcessInfo[]> {
  const tree = new Map<number, ProcessInfo[]>()

  for (const processInfo of processes) {
    const children = tree.get(processInfo.ppid) ?? []
    children.push(processInfo)
    tree.set(processInfo.ppid, children)
  }

  return tree
}

function groupPanesByWindow(
  panes: PaneRecord[],
  processTree: Map<number, ProcessInfo[]>,
): Map<string, TmuxPane[]> {
  const panesByWindow = new Map<string, TmuxPane[]>()

  for (const pane of panes) {
    const key = paneKey(pane.sessionId, pane.windowId)
    const windowPanes = panesByWindow.get(key) ?? []
    const processName = resolvePaneProcessName(pane, processTree)
    const integration = pane.integration?.tool === processName
      ? pane.integration
      : undefined

    windowPanes.push({
      id: pane.id,
      index: pane.index,
      active: pane.active,
      command: pane.command,
      title: pane.title,
      processName,
      ...(integration ? { integration } : {}),
    })
    panesByWindow.set(key, windowPanes)
  }

  for (const windowPanes of panesByWindow.values()) {
    windowPanes.sort((left, right) => left.index - right.index)
  }

  return panesByWindow
}

function groupWindowsBySession(
  windows: Array<TmuxWindow & { sessionId: string }>,
  panesByWindow: Map<string, TmuxPane[]>,
): Map<string, TmuxWindow[]> {
  const windowsBySession = new Map<string, TmuxWindow[]>()

  for (const window of windows) {
    const sessionWindows = windowsBySession.get(window.sessionId) ?? []
    sessionWindows.push({
      id: window.id,
      index: window.index,
      name: window.name,
      active: window.active,
      panes: panesByWindow.get(paneKey(window.sessionId, window.id)) ?? [],
    })
    windowsBySession.set(window.sessionId, sessionWindows)
  }

  for (const sessionWindows of windowsBySession.values()) {
    sessionWindows.sort((left, right) => left.index - right.index)
  }

  return windowsBySession
}

function resolvePaneProcessName(
  pane: PaneRecord,
  processTree: Map<number, ProcessInfo[]>,
): string {
  if (pane.title.startsWith("OC |")) {
    return "opencode"
  }

  if (isEditorCommand(pane.command)) {
    return prettifyProcessName(pane.command)
  }

  const descendants = listDescendants(pane.pid, processTree)
  const processInfo = descendants.at(-1)

  if (!processInfo) {
    return prettifyProcessName(pane.command)
  }

  return prettifyProcessInfo(processInfo)
}

function listDescendants(
  pid: number,
  processTree: Map<number, ProcessInfo[]>,
): ProcessInfo[] {
  const descendants: ProcessInfo[] = []
  const stack = [...(processTree.get(pid) ?? [])]

  while (stack.length > 0) {
    const processInfo = stack.shift()

    if (!processInfo) {
      continue
    }

    descendants.push(processInfo)
    stack.push(...(processTree.get(processInfo.pid) ?? []))
  }

  return descendants.filter((processInfo) => processInfo.command !== "ps")
}

function prettifyProcessInfo(processInfo: ProcessInfo): string {
  if (isRuntimeCommand(processInfo.command)) {
    return prettifyProcessName(runtimeScriptName(processInfo.args) ?? processInfo.command)
  }

  return prettifyProcessName(processInfo.command)
}

function runtimeScriptName(args: string): string | undefined {
  const parts = args.split(/\s+/).filter(Boolean)

  for (const part of parts.slice(1)) {
    if (part.startsWith("-")) {
      continue
    }

    return basename(part)
  }

  return undefined
}

function prettifyProcessName(name: string): string {
  const base = basename(name).replace(/^\./, "")

  if (base === "oc" || base === "ocv" || base === "opencode") {
    return "opencode"
  }

  return base || "shell"
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path
}

function isRuntimeCommand(command: string): boolean {
  return ["node", "bun", "python", "python3", "ruby", "perl", "deno"].includes(
    basename(command),
  )
}

function isEditorCommand(command: string): boolean {
  return ["nvim", "vim"].includes(basename(command))
}

function paneKey(sessionId: string, windowId: string): string {
  return `${sessionId}:${windowId}`
}

function isNoSessionsError(stderr: string): boolean {
  const message = stderr.trim().toLowerCase()

  return message.includes("no server running") || message.includes("no sessions")
}
