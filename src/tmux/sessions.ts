import { readFileSync } from "node:fs";
import { dirname, normalize, resolve as resolvePath } from "node:path";
import { benchAsync, benchNow, createBenchRun, elapsedMs } from "../benchmark";
import { missingTmuxMessage, runTmux } from "./commands";
import { gitMetadata } from "./git";
import type {
  TmuxPane,
  TmuxPaneIntegrationStatus,
  TmuxSession,
  TmuxSessionsResult,
  TmuxWindow,
} from "./types";

const sessionSeparator = "\x1f";
const fieldSeparator = "\x1f";
const sessionFormat = [
  "#{session_id}",
  "#{session_name}",
  "#{session_attached}",
  "#{session_created}",
  "#{session_activity}",
].join(sessionSeparator);
const windowFormat = [
  "#{session_id}",
  "#{window_id}",
  "#{window_index}",
  "#{window_name}",
  "#{window_active}",
].join(fieldSeparator);
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
  "#{pane_current_path}",
].join(fieldSeparator);
const clientFormat = ["#{session_id}", "#{client_pid}"].join(fieldSeparator);

type ListSessionsOptions = {
  forceGit?: boolean;
};

type PaneRecord = Omit<TmuxPane, "ssh"> & {
  sessionId: string;
  windowId: string;
  pid: number;
  currentPath: string;
};

type ProcessInfo = {
  pid: number;
  ppid: number;
  command: string;
  args: string;
};

type ClientRecord = {
  sessionId: string;
  pid: number;
};

export async function listSessions(options: ListSessionsOptions = {}): Promise<TmuxSessionsResult> {
  const bench = createBenchRun("session_lookup");
  const timings: Record<string, number> = {};

  try {
    const result = await benchAsync("listSessionsCommandMs", timings, () =>
      runTmux(["list-sessions", "-F", sessionFormat]),
    );

    if (result.exitCode === 0) {
      const [windows, panes, clients, processes] = await Promise.all([
        benchAsync("listWindowsMs", timings, listWindows),
        benchAsync("listPanesMs", timings, listPanes),
        benchAsync("listClientsMs", timings, listClients),
        benchAsync("psMs", timings, listProcesses),
      ]);
      const processTreeStartedAt = benchNow();
      const processTree = createProcessTree(processes);
      const processesByPid = new Map(
        processes.map((processInfo) => [processInfo.pid, processInfo]),
      );
      const sshAttachedSessions = listSshAttachedSessions(clients, processes);
      const panesByWindow = groupPanesByWindow(panes, processTree, processesByPid);
      const windowsBySession = groupWindowsBySession(windows, panesByWindow);
      timings.processTreeMs = elapsedMs(processTreeStartedAt);

      const sessions = result.stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => parseSession(line, windowsBySession, sshAttachedSessions));
      const sessionsWithMetadata = await benchAsync("gitMetadataMs", timings, () =>
        withSessionMetadata(sessions, options),
      );

      bench.add(timings);
      bench.log({
        ok: true,
        listSessionsMs: bench.elapsed(),
        sessionCount: sessionsWithMetadata.length,
      });

      return {
        ok: true,
        sessions: sessionsWithMetadata,
      };
    }

    if (isNoSessionsError(result.stderr)) {
      bench.add(timings);
      bench.log({ ok: true, listSessionsMs: bench.elapsed(), sessionCount: 0 });

      return { ok: true, sessions: [] };
    }

    bench.add(timings);
    bench.log({
      ok: false,
      listSessionsMs: bench.elapsed(),
      message: result.stderr.trim() || result.stdout.trim(),
    });

    return {
      ok: false,
      message: result.stderr.trim() || result.stdout.trim() || "tmux session listing failed.",
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      bench.add(timings);
      bench.log({ ok: false, listSessionsMs: bench.elapsed(), message: missingTmuxMessage });

      return { ok: false, message: missingTmuxMessage };
    }

    throw error;
  }
}

async function listWindows(): Promise<Array<TmuxWindow & { sessionId: string }>> {
  const result = await runTmux(["list-windows", "-a", "-F", windowFormat]);

  if (result.exitCode !== 0) {
    return [];
  }

  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(parseWindow);
}

async function listPanes(): Promise<PaneRecord[]> {
  const result = await runTmux(["list-panes", "-a", "-F", paneFormat]);

  if (result.exitCode !== 0) {
    return [];
  }

  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(parsePane);
}

async function listClients(): Promise<ClientRecord[]> {
  const result = await runTmux(["list-clients", "-F", clientFormat]);

  if (result.exitCode !== 0) {
    return [];
  }

  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(parseClient);
}

async function listProcesses(): Promise<ProcessInfo[]> {
  let psProcess: ReturnType<typeof Bun.spawn>;

  try {
    psProcess = Bun.spawn(["ps", "-eo", "pid=,ppid=,comm=,args="], {
      stderr: "pipe",
      stdout: "pipe",
    });
  } catch {
    return [];
  }

  const [exitCode, stdout] = await Promise.all([
    psProcess.exited,
    new Response(psProcess.stdout as ReadableStream<Uint8Array>).text(),
  ]);

  if (exitCode !== 0) {
    return [];
  }

  return stdout.trim().split(/\r?\n/).filter(Boolean).map(parseProcess);
}

function parseSession(
  line: string,
  windowsBySession: Map<string, TmuxWindow[]>,
  sshAttachedSessions: Set<string>,
): TmuxSession {
  const [id, name, attached, createdAt, activityAt] = line.split(sessionSeparator);

  return {
    id: id ?? "",
    name: name ?? "",
    windows: windowsBySession.get(id ?? "") ?? [],
    attached: Number(attached) > 0,
    sshAttached: sshAttachedSessions.has(id ?? ""),
    createdAt: new Date(Number(createdAt) * 1000),
    activityAt: new Date(Number(activityAt) * 1000),
  };
}

function parseClient(line: string): ClientRecord {
  const [sessionId, pid] = line.split(fieldSeparator);

  return {
    sessionId: sessionId ?? "",
    pid: Number(pid),
  };
}

function parseWindow(line: string): TmuxWindow & { sessionId: string } {
  const [sessionId, id, index, name, active] = line.split(fieldSeparator);

  return {
    sessionId: sessionId ?? "",
    id: id ?? "",
    index: Number(index),
    name: name ?? "",
    active: Number(active) > 0,
    panes: [],
  };
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
    currentPath,
  ] = line.split(fieldSeparator);

  const integration = parsePaneIntegration(
    integrationTool,
    integrationStatus,
    integrationLabel,
    integrationUpdatedAt,
  );

  return {
    sessionId: sessionId ?? "",
    windowId: windowId ?? "",
    id: id ?? "",
    index: Number(index),
    active: Number(active) > 0,
    command: command ?? "",
    title: title ?? "",
    pid: Number(pid),
    currentPath: currentPath ?? "",
    processName: command ?? "",
    ...(integration ? { integration } : {}),
  };
}

function parsePaneIntegration(
  tool: string | undefined,
  status: string | undefined,
  label: string | undefined,
  updatedAt: string | undefined,
): PaneRecord["integration"] {
  if (!tool) {
    return undefined;
  }

  const parsedStatus = parsePaneIntegrationStatus(status);
  const timestamp = Number(updatedAt);

  return {
    tool,
    status: parsedStatus ?? "unknown",
    label: label || undefined,
    updatedAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000) : undefined,
  };
}

function parsePaneIntegrationStatus(
  status: string | undefined,
): TmuxPaneIntegrationStatus | undefined {
  if (
    status === "idle" ||
    status === "running" ||
    status === "waiting" ||
    status === "error" ||
    status === "unknown"
  ) {
    return status;
  }

  return undefined;
}

function parseProcess(line: string): ProcessInfo {
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);

  return {
    pid: Number(match?.[1] ?? 0),
    ppid: Number(match?.[2] ?? 0),
    command: match?.[3] ?? "",
    args: match?.[4] ?? "",
  };
}

function createProcessTree(processes: ProcessInfo[]): Map<number, ProcessInfo[]> {
  const tree = new Map<number, ProcessInfo[]>();

  for (const processInfo of processes) {
    const children = tree.get(processInfo.ppid) ?? [];
    children.push(processInfo);
    tree.set(processInfo.ppid, children);
  }

  return tree;
}

function listSshAttachedSessions(clients: ClientRecord[], processes: ProcessInfo[]): Set<string> {
  const processesByPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
  const localAttachedSessions = new Set<string>();
  const sessions = new Set<string>();

  for (const client of clients) {
    if (hasSshAncestor(client.pid, processesByPid)) {
      sessions.add(client.sessionId);
    } else {
      localAttachedSessions.add(client.sessionId);
    }
  }

  for (const sessionId of localAttachedSessions) {
    sessions.delete(sessionId);
  }

  return sessions;
}

function hasSshAncestor(pid: number, processesByPid: Map<number, ProcessInfo>): boolean {
  let processInfo = processesByPid.get(pid);
  const seen = new Set<number>();

  while (processInfo && !seen.has(processInfo.pid)) {
    if (isSshdCommand(processInfo.command)) {
      return true;
    }

    seen.add(processInfo.pid);
    processInfo = processesByPid.get(processInfo.ppid);
  }

  return false;
}

function isSshdCommand(command: string): boolean {
  return basename(command).startsWith("sshd");
}

function groupPanesByWindow(
  panes: PaneRecord[],
  processTree: Map<number, ProcessInfo[]>,
  processesByPid: Map<number, ProcessInfo>,
): Map<string, TmuxPane[]> {
  const panesByWindow = new Map<string, TmuxPane[]>();

  for (const pane of panes) {
    const key = paneKey(pane.sessionId, pane.windowId);
    const windowPanes = panesByWindow.get(key) ?? [];
    const processName = resolvePaneProcessName(pane, processTree, processesByPid);
    const integration = pane.integration?.tool === processName ? pane.integration : undefined;

    windowPanes.push({
      id: pane.id,
      index: pane.index,
      active: pane.active,
      command: pane.command,
      title: pane.title,
      ...(pane.currentPath ? { currentPath: pane.currentPath } : {}),
      processName,
      ssh: isSshPane(pane, processTree),
      ...(integration ? { integration } : {}),
    });
    panesByWindow.set(key, windowPanes);
  }

  for (const windowPanes of panesByWindow.values()) {
    windowPanes.sort((left, right) => left.index - right.index);
  }

  return panesByWindow;
}

function groupWindowsBySession(
  windows: Array<TmuxWindow & { sessionId: string }>,
  panesByWindow: Map<string, TmuxPane[]>,
): Map<string, TmuxWindow[]> {
  const windowsBySession = new Map<string, TmuxWindow[]>();

  for (const window of windows) {
    const sessionWindows = windowsBySession.get(window.sessionId) ?? [];
    sessionWindows.push({
      id: window.id,
      index: window.index,
      name: window.name,
      active: window.active,
      panes: panesByWindow.get(paneKey(window.sessionId, window.id)) ?? [],
    });
    windowsBySession.set(window.sessionId, sessionWindows);
  }

  for (const sessionWindows of windowsBySession.values()) {
    sessionWindows.sort((left, right) => left.index - right.index);
  }

  return windowsBySession;
}

async function withSessionMetadata(
  sessions: TmuxSession[],
  options: ListSessionsOptions,
): Promise<TmuxSession[]> {
  return Promise.all(
    sessions.map(async (session) => {
      const path = sessionPath(session);

      if (!path) {
        return session;
      }

      const git = await gitMetadata(path, { force: options.forceGit });

      return {
        ...session,
        path,
        ...(git.branch ? { gitBranch: git.branch } : {}),
        ...(git.dirty ? { gitDirty: true } : {}),
      };
    }),
  );
}

function sessionPath(session: TmuxSession): string | undefined {
  const activeWindow = session.windows.find((window) => window.active);
  const activePane = activeWindow?.panes.find((pane) => pane.active);
  const firstPane = session.windows.flatMap((window) => window.panes)[0];

  return activePane?.currentPath || firstPane?.currentPath || undefined;
}

function isSshPane(pane: PaneRecord, processTree: Map<number, ProcessInfo[]>): boolean {
  if (basename(pane.command) === "ssh") {
    return true;
  }

  return listDescendants(pane.pid, processTree).some(
    (processInfo) => basename(processInfo.command) === "ssh",
  );
}

function resolvePaneProcessName(
  pane: PaneRecord,
  processTree: Map<number, ProcessInfo[]>,
  processesByPid: Map<number, ProcessInfo>,
): string {
  if (pane.title.startsWith("OC |")) {
    return "opencode";
  }

  if (isRuntimeCommand(pane.command)) {
    return (
      resolveRuntimeProcessName(pane, processTree, processesByPid) ??
      prettifyProcessName(pane.command)
    );
  }

  return prettifyProcessName(pane.command);
}

function resolveRuntimeProcessName(
  pane: PaneRecord,
  processTree: Map<number, ProcessInfo[]>,
  processesByPid: Map<number, ProcessInfo>,
): string | undefined {
  const processInfo = findRuntimeProcess(pane, processTree, processesByPid);
  const parts = (processInfo?.args ?? "").split(/\s+/).filter(Boolean);

  if (basename(parts[0] ?? "") === basename(pane.command)) {
    parts.shift();
  }

  if (parts[0] === "run") {
    parts.shift();
  }

  const target = parts.find((part) => !part.startsWith("-"));

  if (!target) {
    return undefined;
  }

  return runtimeBinNameForTarget(target, pane.currentPath);
}

function findRuntimeProcess(
  pane: PaneRecord,
  processTree: Map<number, ProcessInfo[]>,
  processesByPid: Map<number, ProcessInfo>,
): ProcessInfo | undefined {
  const candidates = [
    processesByPid.get(pane.pid),
    ...listDescendants(pane.pid, processTree),
  ].filter((processInfo): processInfo is ProcessInfo => Boolean(processInfo));
  const command = basename(pane.command);

  return (
    candidates.find((processInfo) => processRunsCommand(processInfo, command)) ??
    candidates.find((processInfo) => isRuntimeCommand(processInfo.command))
  );
}

function processRunsCommand(processInfo: ProcessInfo, command: string): boolean {
  if (basename(processInfo.command) === command) {
    return true;
  }

  const firstArg = processInfo.args.split(/\s+/).filter(Boolean)[0];

  return basename(firstArg ?? "") === command;
}

function runtimeBinNameForTarget(target: string, currentPath: string): string | undefined {
  const targetPath = normalize(resolvePath(currentPath || process.cwd(), target));

  return packageBinNameForRuntimeTarget(targetPath) ?? binDirectoryTargetName(target);
}

function binDirectoryTargetName(target: string): string | undefined {
  const parts = target.split("/").filter(Boolean);
  const binIndex = Math.max(parts.lastIndexOf(".bin"), parts.lastIndexOf("bin"));

  if (binIndex < 0) {
    return undefined;
  }

  const name = parts.at(binIndex + 1);

  return name ? prettifyProcessName(name) : undefined;
}

function packageBinNameForRuntimeTarget(targetPath: string): string | undefined {
  for (let dir = dirname(targetPath); ; dir = dirname(dir)) {
    const parent = dirname(dir);

    try {
      const parsed = JSON.parse(readFileSync(resolvePath(dir, "package.json"), "utf8")) as {
        name?: unknown;
        bin?: unknown;
      };
      const entries =
        typeof parsed.bin === "string" && typeof parsed.name === "string"
          ? [[parsed.name.split("/").at(-1) ?? parsed.name, parsed.bin]]
          : Object.entries(typeof parsed.bin === "object" && parsed.bin !== null ? parsed.bin : {});

      for (const [name, binTarget] of entries) {
        if (
          typeof binTarget === "string" &&
          normalize(resolvePath(dir, binTarget)) === targetPath
        ) {
          return prettifyProcessName(name);
        }
      }

      return undefined;
    } catch {}

    if (parent === dir) {
      return undefined;
    }
  }
}

function listDescendants(pid: number, processTree: Map<number, ProcessInfo[]>): ProcessInfo[] {
  const descendants: ProcessInfo[] = [];
  const stack = [...(processTree.get(pid) ?? [])];

  while (stack.length > 0) {
    const processInfo = stack.shift();

    if (!processInfo) {
      continue;
    }

    descendants.push(processInfo);
    stack.push(...(processTree.get(processInfo.pid) ?? []));
  }

  return descendants.filter((processInfo) => processInfo.command !== "ps");
}

function prettifyProcessName(name: string): string {
  const base = basename(name).replace(/^\./, "");

  if (base === "oc" || base === "ocv" || base === "opencode") {
    return "opencode";
  }

  return base || "shell";
}

function isRuntimeCommand(command: string): boolean {
  return ["node", "bun", "python", "python3", "ruby", "perl", "deno"].includes(basename(command));
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function paneKey(sessionId: string, windowId: string): string {
  return `${sessionId}:${windowId}`;
}

function isNoSessionsError(stderr: string): boolean {
  const message = stderr.trim().toLowerCase();

  return message.includes("no server running") || message.includes("no sessions");
}
