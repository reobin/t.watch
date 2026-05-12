import { runCommand } from "./command";
import { windowOwnerPidCandidates } from "./process";
import type { NotificationBackend, RunCommand, Visibility, VisibilityBackend } from "./types";

export const macosNotificationBackend: NotificationBackend = {
  available: ({ platform }) => platform === "darwin",
  send: (notification) =>
    runCommand("osascript", [
      "-e",
      `display notification ${appleScriptString(notification.body)} with title ${appleScriptString(
        notification.title,
      )}`,
    ]).then(() => undefined),
};

export const macosVisibilityBackend: VisibilityBackend = {
  available: ({ platform }) => platform === "darwin",
  visibility: ({ pid, env }) => macosTerminalVisibility(pid, runCommand, env),
};

export async function macosTerminalVisibility(
  pid: number,
  run: RunCommand = runCommand,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Visibility> {
  const pids = await windowOwnerPidCandidates(pid, env, run);

  if (pids.length === 0) {
    return "unknown";
  }

  const script = [
    'tell application "System Events"',
    `set candidateIds to {${pids.join(", ")}}`,
    "set foundWindowOwner to false",
    "repeat with candidateId in candidateIds",
    "set candidateUnixId to candidateId as integer",
    "set targetProcesses to every process whose unix id is candidateUnixId",
    "repeat with targetProcess in targetProcesses",
    "if (count of windows of targetProcess) is greater than 0 then",
    "set foundWindowOwner to true",
    'if visible of targetProcess is false then return "hidden"',
    "repeat with targetWindow in windows of targetProcess",
    'if value of attribute "AXMinimized" of targetWindow is false then return "visible"',
    "end repeat",
    "end if",
    "end repeat",
    "end repeat",
    'if foundWindowOwner then return "hidden"',
    'return "unknown"',
    "end tell",
  ].join("\n");
  const visibility = await run("osascript", ["-e", script]);

  if (visibility.exitCode !== 0) {
    return "unknown";
  }

  return parseVisibility(visibility.stdout.trim());
}

function parseVisibility(value: string): Visibility {
  return value === "visible" || value === "hidden" ? value : "unknown";
}

function appleScriptString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
