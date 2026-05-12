import { runCommand } from "./command";
import type { RunCommand } from "./types";

const maxAncestorDepth = 32;

export async function windowOwnerPidCandidates(
  pid: number,
  env: NodeJS.ProcessEnv = process.env,
  run: RunCommand = runCommand,
): Promise<number[]> {
  const pids: number[] = [];
  addPid(pids, pid);

  const tmuxClientPid = await currentTmuxClientPid(env, run);
  if (tmuxClientPid) {
    addPid(pids, tmuxClientPid);
  }

  const initialPidCount = pids.length;
  for (let index = 0; index < initialPidCount; index += 1) {
    const startPid = pids[index];
    let currentPid = startPid;

    for (let depth = 0; depth < maxAncestorDepth; depth += 1) {
      const parentPid = await processParentPid(currentPid, run);

      if (!parentPid || parentPid <= 1) {
        break;
      }

      if (!addPid(pids, parentPid)) {
        break;
      }

      currentPid = parentPid;
    }
  }

  return pids;
}

async function currentTmuxClientPid(
  env: NodeJS.ProcessEnv,
  run: RunCommand,
): Promise<number | undefined> {
  if (!env.TMUX) {
    return undefined;
  }

  const result = await run("tmux", ["display-message", "-p", "#{client_pid}"]);

  if (result.exitCode !== 0) {
    return undefined;
  }

  return parsePositiveInteger(result.stdout);
}

async function processParentPid(pid: number, run: RunCommand): Promise<number | undefined> {
  const result = await run("ps", ["-o", "ppid=", "-p", String(pid)]);

  if (result.exitCode !== 0) {
    return undefined;
  }

  return parsePositiveInteger(result.stdout);
}

function addPid(pids: number[], pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || pids.includes(pid)) {
    return false;
  }

  pids.push(pid);
  return true;
}

function parsePositiveInteger(value: string): number | undefined {
  const parsed = Number(value.trim());

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
