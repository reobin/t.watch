import type { CommandResult } from "./types";

export async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  try {
    const child = Bun.spawn([command, ...args], {
      stderr: "ignore",
      stdout: "pipe",
    });
    const [exitCode, stdout] = await Promise.all([
      child.exited,
      new Response(child.stdout as ReadableStream<Uint8Array>).text(),
    ]);

    return { exitCode, stdout };
  } catch {
    return { exitCode: 1, stdout: "" };
  }
}

export async function commandExitsZero(command: string): Promise<boolean> {
  const result = await runCommand("sh", ["-c", command]);

  return result.exitCode === 0;
}
