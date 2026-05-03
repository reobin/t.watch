import { describe, expect, test } from "bun:test"
import {
  renderLoading,
  renderMessage,
  renderNoSessions,
  renderSessions,
} from "./render"
import type { TmuxSession } from "./tmux"

describe("render", () => {
  test("renders a message with the app title", () => {
    expect(renderMessage("Something happened.")).toBe(
      "t.watch\n\nSomething happened.",
    )
  })

  test("renders the loading state", () => {
    expect(renderLoading()).toBe("t.watch\n\nLoading tmux sessions...")
  })

  test("renders the empty sessions state", () => {
    expect(renderNoSessions()).toBe("t.watch\n\nNo tmux sessions running.")
  })

  test("renders session names", () => {
    const sessions: TmuxSession[] = [
      session({ name: "work" }),
      session({ name: "notes" }),
    ]

    expect(renderSessions(sessions)).toBe(
      ["t.watch", "", "Sessions", "", "* work", "* notes"].join("\n"),
    )
  })
})

function session(overrides: Partial<TmuxSession> = {}): TmuxSession {
  return {
    id: "$1",
    name: "default",
    windows: 1,
    attached: false,
    createdAt: new Date(0),
    activityAt: new Date(0),
    ...overrides,
  }
}
