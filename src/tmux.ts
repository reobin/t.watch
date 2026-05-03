export type TmuxCheckResult =
  | {
      ok: true
      version: string
    }
  | {
      ok: false
      message: string
    }

const missingTmuxMessage = "tmux is required but was not found."

export async function checkTmux(): Promise<TmuxCheckResult> {
  try {
    const process = Bun.spawn(["tmux", "-V"], {
      stderr: "pipe",
      stdout: "pipe",
    })

    const [exitCode, stderr, stdout] = await Promise.all([
      process.exited,
      new Response(process.stderr).text(),
      new Response(process.stdout).text(),
    ])

    if (exitCode === 0) {
      return { ok: true, version: stdout.trim() }
    }

    return {
      ok: false,
      message: stderr.trim() || stdout.trim() || "tmux check failed.",
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      return { ok: false, message: missingTmuxMessage }
    }

    throw error
  }
}
