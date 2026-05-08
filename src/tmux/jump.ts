import { access, readFile } from "node:fs/promises";
import { benchAsync, createBenchRun } from "../benchmark";
import { nextJumpPaneCandidateId } from "../navigation";
import {
  focusPaneForAllClients,
  focusPaneForCurrentClient,
  missingTmuxMessage,
  runTmux,
} from "./commands";
import type { TmuxFocusPaneResult, TmuxPaneIntegrationStatus } from "./types";

const fieldSeparator = "\x1f";
const paneFormat = [
  "#{pane_id}",
  "#{pane_active}",
  "#{window_active}",
  "#{session_attached}",
  "#{pane_pid}",
  "#{@thud_sh_tool}",
  "#{@thud_sh_status}",
  "#{@thud_sh_owner_pid}",
  "#{@thud_sh_owner_start_time}",
].join(fieldSeparator);

type JumpPane = {
  id: string;
  active: boolean;
  windowActive: boolean;
  sessionAttached: boolean;
  status?: TmuxPaneIntegrationStatus;
};
type JumpPaneRecord = JumpPane & {
  panePid: string;
  ownerPid: string;
  ownerStartTime: string;
  tool: string;
  rawStatus: string;
};
type ProcessStat = {
  pid: string;
  ppid: string;
  startTime: string;
};
type ProcessLookup = {
  procRootAvailable?: Promise<boolean>;
  portableProcessTable?: Promise<Map<string, ProcessStat>>;
};
type JumpPaneListResult =
  | {
      ok: true;
      panes: JumpPane[];
    }
  | {
      ok: false;
      message: string;
    };

export async function jumpToNextPane(
  currentPaneId = process.env.TMUX_PANE,
): Promise<TmuxFocusPaneResult> {
  const bench = createBenchRun("jump");
  const timings: Record<string, number> = {};

  try {
    const panesResult = await benchAsync("jumpListPanesMs", timings, listJumpPanes);

    if (panesResult.ok === false) {
      bench.add(timings);
      bench.log({ ok: false, message: panesResult.message });

      return panesResult;
    }

    const reliableCurrentPaneId = currentPaneId;
    const resolvedCurrentPaneId =
      reliableCurrentPaneId ?? currentAttachedActivePaneId(panesResult.panes);
    const paneId = nextJumpPaneCandidateId(panesResult.panes, resolvedCurrentPaneId);

    if (!paneId) {
      bench.add(timings);
      bench.log({ ok: true, targetFound: false });

      return { ok: true };
    }

    if (reliableCurrentPaneId) {
      const currentFocusResult = await benchAsync("jumpCurrentFocusMs", timings, () =>
        focusPaneForCurrentClient(paneId),
      );

      if (currentFocusResult.ok === true || currentFocusResult.message === missingTmuxMessage) {
        bench.add(timings);
        bench.log({
          ok: currentFocusResult.ok,
          targetFound: true,
          focusFallback: false,
          message: currentFocusResult.ok ? undefined : currentFocusResult.message,
        });

        return currentFocusResult;
      }
    }

    const fallbackFocusResult = await benchAsync("jumpFallbackFocusMs", timings, () =>
      focusPaneForAllClients(paneId),
    );
    bench.add(timings);
    bench.log({
      ok: fallbackFocusResult.ok,
      targetFound: true,
      focusFallback: true,
      message: fallbackFocusResult.ok ? undefined : fallbackFocusResult.message,
    });

    return fallbackFocusResult;
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      bench.add(timings);
      bench.log({ ok: false, message: missingTmuxMessage });

      return { ok: false, message: missingTmuxMessage };
    }

    throw error;
  }
}

async function listJumpPanes(): Promise<JumpPaneListResult> {
  const result = await runTmux(["list-panes", "-a", "-F", paneFormat]);

  if (result.exitCode === 0) {
    const paneRecords = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(parseJumpPane);
    const processLookup: ProcessLookup = {};

    return {
      ok: true,
      panes: await Promise.all(
        paneRecords.map((pane) => withValidatedJumpStatus(pane, processLookup)),
      ),
    };
  }

  if (isNoSessionsError(result.stderr)) {
    return { ok: true, panes: [] };
  }

  return {
    ok: false,
    message: result.stderr.trim() || result.stdout.trim() || "tmux pane listing failed.",
  };
}

function parseJumpPane(line: string): JumpPaneRecord {
  const [
    id,
    active,
    windowActive,
    sessionAttached,
    panePid,
    tool,
    status,
    ownerPid,
    ownerStartTime,
  ] = line.split(fieldSeparator);

  return {
    id: id ?? "",
    active: Number(active) > 0,
    windowActive: Number(windowActive) > 0,
    sessionAttached: Number(sessionAttached) > 0,
    panePid: panePid ?? "",
    tool: tool ?? "",
    rawStatus: status ?? "",
    ownerPid: ownerPid ?? "",
    ownerStartTime: ownerStartTime ?? "",
  };
}

async function withValidatedJumpStatus(
  pane: JumpPaneRecord,
  processLookup: ProcessLookup,
): Promise<JumpPane> {
  const status = parseJumpStatus(pane.tool, pane.rawStatus);

  if (
    !status ||
    !(await isPaneOwnerAlive(pane.panePid, pane.ownerPid, pane.ownerStartTime, processLookup))
  ) {
    return { ...pane, status: undefined };
  }

  return { ...pane, status };
}

function parseJumpStatus(
  tool: string | undefined,
  status: string | undefined,
): TmuxPaneIntegrationStatus | undefined {
  if (!tool) {
    return undefined;
  }

  if (status === "idle" || status === "running" || status === "waiting") {
    return status;
  }

  return undefined;
}

async function isPaneOwnerAlive(
  panePid: string,
  ownerPid: string,
  ownerStartTime: string,
  processLookup: ProcessLookup,
): Promise<boolean> {
  if (!isPid(panePid) || !isPid(ownerPid) || !ownerStartTime) {
    return false;
  }

  const ownerStat = await readProcessStat(ownerPid, processLookup);

  if (!ownerStat || ownerStat.startTime !== ownerStartTime) {
    return false;
  }

  if (ownerPid === panePid) {
    return true;
  }

  const seen = new Set([ownerPid]);
  let pid = ownerStat.ppid;

  while (isPid(pid) && pid !== "1" && !seen.has(pid)) {
    if (pid === panePid) {
      return true;
    }

    seen.add(pid);
    const stat = await readProcessStat(pid, processLookup);

    if (!stat) {
      return false;
    }

    pid = stat.ppid;
  }

  return false;
}

async function readProcessStat(
  pid: string,
  processLookup: ProcessLookup,
): Promise<ProcessStat | undefined> {
  try {
    return parseProcessStat(pid, await readFile(`${procStatPath(pid)}`, "utf8"));
  } catch {
    if (await isProcRootAvailable(processLookup)) {
      return undefined;
    }

    return (await portableProcessTable(processLookup)).get(pid);
  }
}

async function isProcRootAvailable(processLookup: ProcessLookup): Promise<boolean> {
  processLookup.procRootAvailable ??= access(procRootPath()).then(
    () => true,
    () => false,
  );

  return processLookup.procRootAvailable;
}

async function portableProcessTable(
  processLookup: ProcessLookup,
): Promise<Map<string, ProcessStat>> {
  processLookup.portableProcessTable ??= listPortableProcesses();

  return processLookup.portableProcessTable;
}

async function listPortableProcesses(): Promise<Map<string, ProcessStat>> {
  let psProcess: ReturnType<typeof Bun.spawn>;

  try {
    psProcess = Bun.spawn(["ps", "-axo", "pid=,ppid=,lstart="], {
      stderr: "pipe",
      stdout: "pipe",
    });
  } catch {
    return new Map();
  }

  const [exitCode, stdout] = await Promise.all([
    psProcess.exited,
    new Response(psProcess.stdout as ReadableStream<Uint8Array>).text(),
  ]);

  if (exitCode !== 0) {
    return new Map();
  }

  return new Map(
    stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        const stat = parsePortableProcess(line);

        return stat ? [[stat.pid, stat]] : [];
      }),
  );
}

function procStatPath(pid: string): string {
  return `${procRootPath()}/${pid}/stat`;
}

function procRootPath(): string {
  return process.env.THUD_PROC_ROOT ?? "/proc";
}

function parseProcessStat(pid: string, stat: string): ProcessStat | undefined {
  const closeParenIndex = stat.lastIndexOf(")");

  if (closeParenIndex < 0) {
    return undefined;
  }

  const fields = stat
    .slice(closeParenIndex + 1)
    .trim()
    .split(/\s+/);
  const ppid = fields[1];
  const startTime = fields[19];

  if (!isPid(ppid) || !startTime) {
    return undefined;
  }

  return { pid, ppid, startTime };
}

function isPid(value: string): boolean {
  return /^[1-9]\d*$/.test(value);
}

function parsePortableProcess(line: string): ProcessStat | undefined {
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);

  if (!match?.[1] || !match[2] || !match[3]) {
    return undefined;
  }

  const startTime = parsePortableStartTime(match[3]);

  if (!startTime) {
    return undefined;
  }

  return { pid: match[1], ppid: match[2], startTime };
}

function parsePortableStartTime(startTime: string): string | undefined {
  const timestamp = Date.parse(startTime);

  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  return timestamp.toString();
}

function currentAttachedActivePaneId(panes: JumpPane[]): string | undefined {
  return panes.find((pane) => pane.sessionAttached && pane.windowActive && pane.active)?.id;
}

function isNoSessionsError(stderr: string): boolean {
  const message = stderr.trim().toLowerCase();

  return message.includes("no server running") || message.includes("no sessions");
}
