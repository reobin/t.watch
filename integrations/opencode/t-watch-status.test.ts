import { afterEach, describe, expect, test } from "bun:test"
import { TWatchStatus } from "./t-watch-status"

describe("TWatchStatus", () => {
  afterEach(() => {
    delete process.env.TMUX_PANE
  })

  test("marks OpenCode questions as requesting", async () => {
    process.env.TMUX_PANE = "%1"
    const shell = mockShell()
    const plugin = await TWatchStatus({ $: shell.$ as typeof Bun.$ })

    await plugin.event({ event: { type: "question.asked" } })

    expect(statuses(shell.calls)).toEqual(["idle", "requesting"])
  })

  test("marks answered or dismissed OpenCode questions as working", async () => {
    process.env.TMUX_PANE = "%1"
    const shell = mockShell()
    const plugin = await TWatchStatus({ $: shell.$ as typeof Bun.$ })

    await plugin.event({ event: { type: "question.asked" } })
    await plugin.event({ event: { type: "question.replied" } })
    await plugin.event({ event: { type: "question.rejected" } })

    expect(statuses(shell.calls)).toEqual([
      "idle",
      "requesting",
      "working",
      "working",
    ])
  })
})

function mockShell(): { calls: string[]; $: unknown } {
  const calls: string[] = []

  return {
    calls,
    $(strings: TemplateStringsArray, ...values: unknown[]) {
      let command = strings[0] ?? ""

      for (let i = 0; i < values.length; i++) {
        command += String(values[i]) + (strings[i + 1] ?? "")
      }

      calls.push(command)

      return {
        quiet: async () => {},
      }
    },
  }
}

function statuses(calls: string[]): string[] {
  return calls.flatMap((call) => {
    const match = call.match(/@t_watch_status\s+(\S+)/)

    return match?.[1] ? [match[1]] : []
  })
}
