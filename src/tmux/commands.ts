import type { TmuxCheckResult, TmuxFocusPaneResult } from "./types";

export const missingTmuxMessage = "tmux is required but was not found.";
const clientSeparator = "\x1f";
const clientFormat = ["#{client_name}", "#{client_tty}", "#{client_control_mode}"].join(
  clientSeparator,
);
type TmuxClientsResult =
  | {
      ok: true;
      clients: ClientRecord[];
    }
  | {
      ok: false;
      message: string;
    };
type ClientRecord = {
  target: string;
  controlMode: boolean;
};

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
  try {
    const clientsResult = await listClients();

    if (clientsResult.ok === false) {
      return clientsResult;
    }

    if (clientsResult.clients.length === 0) {
      return { ok: false, message: "No tmux clients attached." };
    }

    const results = await Promise.all(
      clientsResult.clients.map((client) =>
        runTmux(["switch-client", "-c", client.target, "-t", paneId]),
      ),
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
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      return { ok: false, message: missingTmuxMessage };
    }

    throw error;
  }
}

export async function focusPaneForCurrentClient(paneId: string): Promise<TmuxFocusPaneResult> {
  try {
    const result = await runTmux(["switch-client", "-t", paneId]);

    if (result.exitCode === 0) {
      return { ok: true };
    }

    return {
      ok: false,
      message: result.stderr.trim() || result.stdout.trim() || "tmux pane focus failed.",
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      return { ok: false, message: missingTmuxMessage };
    }

    throw error;
  }
}

async function listClients(): Promise<TmuxClientsResult> {
  const result = await runTmux(["list-clients", "-F", clientFormat]);

  if (result.exitCode !== 0) {
    return {
      ok: false,
      message: result.stderr.trim() || result.stdout.trim() || "tmux client listing failed.",
    };
  }

  return {
    ok: true,
    clients: result.stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseClient)
      .filter(isVisibleClient),
  };
}

function parseClient(line: string): ClientRecord {
  const [name, tty, controlMode] = line.split(clientSeparator);

  return { target: name || tty || "", controlMode: Number(controlMode) > 0 };
}

function isVisibleClient(client: ClientRecord): boolean {
  return !client.controlMode;
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
