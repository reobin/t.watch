import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { checkTmux } from "./commands"

describe("checkTmux", () => {
  afterEach(() => {
    mock.restore()
  })

  test("returns the tmux version", async () => {
    const calls = mockTmux({ exitCode: 0, stdout: "tmux 3.5a\n" })

    await expect(checkTmux()).resolves.toEqual({ ok: true, version: "tmux 3.5a" })
    expect(calls).toEqual([["tmux", "-V"]])
  })

  test("returns tmux stderr for failures", async () => {
    mockTmux({ exitCode: 1, stderr: "tmux failed" })

    await expect(checkTmux()).resolves.toEqual({
      ok: false,
      message: "tmux failed",
    })
  })

  test("falls back to stdout for failures without stderr", async () => {
    mockTmux({ exitCode: 1, stdout: "tmux stdout failure" })

    await expect(checkTmux()).resolves.toEqual({
      ok: false,
      message: "tmux stdout failure",
    })
  })

  test("returns a default message for failures without output", async () => {
    mockTmux({ exitCode: 1 })

    await expect(checkTmux()).resolves.toEqual({
      ok: false,
      message: "tmux check failed.",
    })
  })

  test("returns a helpful message when tmux is missing", async () => {
    spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("ENOENT")
    })

    await expect(checkTmux()).resolves.toEqual({
      ok: false,
      message: "tmux is required but was not found.",
    })
  })
})

function mockTmux(result: {
  exitCode: number
  stderr?: string
  stdout?: string
}): string[][] {
  const calls: string[][] = []

  spyOn(Bun, "spawn").mockImplementation((command) => {
    calls.push([...command])

    return {
      exited: Promise.resolve(result.exitCode),
      stderr: result.stderr ?? "",
      stdout: result.stdout ?? "",
    } as ReturnType<typeof Bun.spawn>
  })

  return calls
}
