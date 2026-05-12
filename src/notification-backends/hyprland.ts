import { runCommand } from "./command";
import { windowOwnerPidCandidates } from "./process";
import type { RunCommand, Visibility, VisibilityBackend } from "./types";

export const hyprlandVisibilityBackend: VisibilityBackend = {
  available: ({ env }) => Boolean(env.HYPRLAND_INSTANCE_SIGNATURE),
  visibility: ({ pid, env }) => hyprlandVisibility(pid, runCommand, env),
};

export async function hyprlandVisibility(
  pid: number,
  run: RunCommand = runCommand,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Visibility> {
  const result = await run("hyprctl", ["clients", "-j"]);

  if (result.exitCode !== 0) {
    return "unknown";
  }

  const directVisibility = parseHyprlandVisibility(result.stdout, pid);

  if (directVisibility !== "unknown") {
    return directVisibility;
  }

  return parseHyprlandVisibility(result.stdout, await windowOwnerPidCandidates(pid, env, run));
}

export function parseHyprlandVisibility(stdout: string, pids: number | number[]): Visibility {
  try {
    const clients = JSON.parse(stdout) as HyprlandClient[];
    const targetPids = new Set(Array.isArray(pids) ? pids : [pids]);
    const client = clients.find((client) => client.pid !== undefined && targetPids.has(client.pid));

    if (!client) {
      return "unknown";
    }

    if (
      client.hidden ||
      client.mapped === false ||
      (client.monitor !== undefined && client.monitor < 0)
    ) {
      return "hidden";
    }

    return "visible";
  } catch {
    return "unknown";
  }
}

type HyprlandClient = {
  pid?: number;
  hidden?: boolean;
  mapped?: boolean;
  monitor?: number;
};
