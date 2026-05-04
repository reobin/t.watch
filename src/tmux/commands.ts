import type { TmuxCheckResult } from "./types";

export const missingTmuxMessage = "tmux is required but was not found.";

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
