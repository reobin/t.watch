import type { TmuxCheckResult, TmuxClient, TmuxFocusPaneResult } from "./types";

export const missingTmuxMessage = "tmux is required but was not found.";
const clientSeparator = "\x1f";
const clientFormat = ["#{client_name}", "#{client_tty}"].join(clientSeparator);

export async function checkTmux(): Promise<TmuxCheckResult> {
  try {
    const result = await runTmux(["-V"]);

    if (result.exitCode === 0) {
      return { ok: true, version: result.stdout.trim() };
    }

    return {
      ok: false,
      message: result.stderr.trim() || result.stdout.trim() || "tmux check failed.",
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      return { ok: false, message: missingTmuxMessage };
    }

    throw error;
  }
}

export async function focusPaneForAllClients(paneId: string): Promise<TmuxFocusPaneResult> {
  const clients = await listClients();

  if (clients.length === 0) {
    return { ok: false, message: "No tmux clients attached." };
  }

  const results = await Promise.all(
    clients.map((client) => runTmux(["switch-client", "-c", client.target, "-t", paneId])),
  );
  const successfulSwitch = results.some((result) => result.exitCode === 0);

  if (successfulSwitch) {
    return { ok: true };
  }

  const message = results.find((result) => result.stderr.trim() || result.stdout.trim());

  return {
    ok: false,
    message: message?.stderr.trim() || message?.stdout.trim() || "tmux pane focus failed.",
  };
}

async function listClients(): Promise<TmuxClient[]> {
  const result = await runTmux(["list-clients", "-F", clientFormat]);

  if (result.exitCode !== 0) {
    return [];
  }

  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(parseClient);
}

function parseClient(line: string): TmuxClient {
  const [name, tty] = line.split(clientSeparator);

  return { target: name || tty || "" };
}

export async function runTmux(args: string[]): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  const tmuxProcess = Bun.spawn(["tmux", ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });

  const [exitCode, stderr, stdout] = await Promise.all([
    tmuxProcess.exited,
    new Response(tmuxProcess.stderr).text(),
    new Response(tmuxProcess.stdout).text(),
  ]);

  return { exitCode, stderr, stdout };
}
