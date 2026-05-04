import { describe, expect, test } from "bun:test"
import { createTextAttributes } from "@opentui/core"
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
      session({
        name: "work",
        attached: true,
        windows: [
          window({
            index: 1,
            name: "node",
            panes: [
              pane({ processName: "opencode", active: true }),
              pane({ processName: "bash", active: false }),
            ],
          }),
          window({
            index: 2,
            name: "server",
            active: false,
            panes: [pane({ processName: "bun", active: true })],
          }),
        ],
      }),
      session({
        name: "notes",
        windows: [window({ name: "vim", panes: [pane({ processName: "vim" })] })],
      }),
    ]
    const output = renderSessions(sessions)

    expect(output.chunks.map((chunk) => chunk.text).join("")).toBe(
      [
        "t.watch",
        "",
        "● work",
        "  ╭─ opencode",
        "  ╰─ bash",
        "  ╶─ bun",
        "○ notes",
        "  ╶─ vim",
      ].join("\n"),
    )
    expect(
      output.chunks.find((chunk) => chunk.text === "● work")?.attributes,
    ).toBe(createTextAttributes({ bold: true }))
    expect(
      output.chunks.find((chunk) => chunk.text === "○ notes")?.attributes,
    ).toBe(0)
    expect(
      output.chunks.find((chunk) => chunk.text === " opencode")?.attributes,
    ).toBe(createTextAttributes({ bold: true }))
    expect(output.chunks.find((chunk) => chunk.text === "● work")?.fg).toBeDefined()
    expect(output.chunks.map((chunk) => chunk.text).join("")).not.toContain("node")
    expect(output.chunks.map((chunk) => chunk.text).join("")).not.toContain("server")
    expect(output.chunks.map((chunk) => chunk.text).join("")).not.toContain("window")
    expect(output.chunks.map((chunk) => chunk.text).join("")).not.toContain("pane")
    expect(output.chunks.map((chunk) => chunk.text).join("")).not.toContain(">")
    expect(output.chunks.map((chunk) => chunk.text).join("")).not.toContain("active")
  })
})

function session(overrides: Partial<TmuxSession> = {}): TmuxSession {
  return {
    id: "$1",
    name: "default",
    windows: [],
    attached: false,
    createdAt: new Date(0),
    activityAt: new Date(0),
    ...overrides,
  }
}

function window(overrides: Partial<TmuxSession["windows"][number]> = {}) {
  return {
    id: "@1",
    index: 1,
    name: "default",
    active: true,
    panes: [],
    ...overrides,
  }
}

function pane(
  overrides: Partial<TmuxSession["windows"][number]["panes"][number]> = {},
) {
  return {
    id: "%1",
    index: 1,
    active: true,
    command: "bash",
    title: "bash",
    processName: "bash",
    ...overrides,
  }
}
