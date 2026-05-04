import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { listSessions } from "./sessions"

describe("listSessions", () => {
  afterEach(() => {
    mock.restore()
  })

  test("parses tmux sessions", async () => {
    const calls = mockTmux({
      results: [
        {
          exitCode: 0,
          stdout: [
            ["$1", "work", "2", "1700000000", "1700000100"].join("\x1f"),
            ["$2", "notes", "0", "1700000200", "1700000300"].join("\x1f"),
          ].join("\n"),
        },
        {
          exitCode: 0,
          stdout: [
            ["$1", "@1", "1", "node", "1"].join("\x1f"),
            ["$1", "@2", "2", "shell", "0"].join("\x1f"),
            ["$2", "@3", "1", "notes", "1"].join("\x1f"),
          ].join("\n"),
        },
        {
          exitCode: 0,
          stdout: [
            [
              "$1",
              "@1",
              "%1",
              "1",
              "1",
              "node",
              "10",
              "OC | Coding",
              "opencode",
              "requesting",
              "",
              "1700000110",
            ].join("\x1f"),
            [
              "$1",
              "@2",
              "%2",
              "1",
              "1",
              "bash",
              "20",
              "shell",
              "opencode",
              "idle",
              "",
              "1700000120",
            ].join("\x1f"),
            ["$2", "@3", "%3", "1", "1", "vim", "30", "notes"].join(
              "\x1f",
            ),
          ].join("\n"),
        },
        {
          exitCode: 0,
          stdout: [
            "100 10 node node /home/reobin/.local/bin/opencode",
            "200 20 bash -bash",
          ].join("\n"),
        },
      ],
    })

    await expect(listSessions()).resolves.toEqual({
      ok: true,
      sessions: [
        {
          id: "$1",
          name: "work",
          windows: [
            {
              id: "@1",
              index: 1,
              name: "node",
              active: true,
              panes: [
                {
                  id: "%1",
                  index: 1,
                  active: true,
                  command: "node",
                  title: "OC | Coding",
                  processName: "opencode",
                  integration: {
                    tool: "opencode",
                    status: "requesting",
                    updatedAt: new Date(1700000110 * 1000),
                  },
                },
              ],
            },
            {
              id: "@2",
              index: 2,
              name: "shell",
              active: false,
              panes: [
                {
                  id: "%2",
                  index: 1,
                  active: true,
                  command: "bash",
                  title: "shell",
                  processName: "bash",
                },
              ],
            },
          ],
          attached: true,
          createdAt: new Date(1700000000 * 1000),
          activityAt: new Date(1700000100 * 1000),
        },
        {
          id: "$2",
          name: "notes",
          windows: [
            {
              id: "@3",
              index: 1,
              name: "notes",
              active: true,
              panes: [
                {
                  id: "%3",
                  index: 1,
                  active: true,
                  command: "vim",
                  title: "notes",
                  processName: "vim",
                },
              ],
            },
          ],
          attached: false,
          createdAt: new Date(1700000200 * 1000),
          activityAt: new Date(1700000300 * 1000),
        },
      ],
    })

    expect(calls).toEqual([
      [
        "tmux",
        "list-sessions",
        "-F",
        "#{session_id}\x1f#{session_name}\x1f#{session_attached}\x1f#{session_created}\x1f#{session_activity}",
      ],
      [
        "tmux",
        "list-windows",
        "-a",
        "-F",
        "#{session_id}\x1f#{window_id}\x1f#{window_index}\x1f#{window_name}\x1f#{window_active}",
      ],
      [
        "tmux",
        "list-panes",
        "-a",
        "-F",
        "#{session_id}\x1f#{window_id}\x1f#{pane_id}\x1f#{pane_index}\x1f#{pane_active}\x1f#{pane_current_command}\x1f#{pane_pid}\x1f#{pane_title}\x1f#{@t_watch_tool}\x1f#{@t_watch_status}\x1f#{@t_watch_status_label}\x1f#{@t_watch_status_updated_at}",
      ],
      ["ps", "-eo", "pid=,ppid=,comm=,args="],
    ])
  })

  test("uses zero panes when pane listing fails", async () => {
    mockTmux({
      results: [
        {
          exitCode: 0,
          stdout: ["$1", "work", "2", "1700000000", "1700000100"].join(
            "\x1f",
          ),
        },
        {
          exitCode: 0,
          stdout: ["$1", "@1", "1", "work", "1"].join("\x1f"),
        },
        { exitCode: 1, stderr: "pane listing failed" },
        { exitCode: 0, stdout: "" },
      ],
    })

    await expect(listSessions()).resolves.toEqual({
      ok: true,
      sessions: [
        {
          id: "$1",
          name: "work",
          windows: [
            {
              id: "@1",
              index: 1,
              name: "work",
              active: true,
              panes: [],
            },
          ],
          attached: true,
          createdAt: new Date(1700000000 * 1000),
          activityAt: new Date(1700000100 * 1000),
        },
      ],
    })
  })

  test("returns an empty list when tmux has no sessions", async () => {
    mockTmux({ exitCode: 1, stderr: "no server running on /tmp/tmux-1000/default" })

    await expect(listSessions()).resolves.toEqual({ ok: true, sessions: [] })
  })

  test("returns an empty list for tmux no sessions errors", async () => {
    mockTmux({ exitCode: 1, stderr: "no sessions" })

    await expect(listSessions()).resolves.toEqual({ ok: true, sessions: [] })
  })

  test("returns tmux stderr for other failures", async () => {
    mockTmux({ exitCode: 1, stderr: "permission denied" })

    await expect(listSessions()).resolves.toEqual({
      ok: false,
      message: "permission denied",
    })
  })

  test("falls back to stdout for failures without stderr", async () => {
    mockTmux({ exitCode: 1, stdout: "stdout failure" })

    await expect(listSessions()).resolves.toEqual({
      ok: false,
      message: "stdout failure",
    })
  })

  test("returns a default message for failures without output", async () => {
    mockTmux({ exitCode: 1 })

    await expect(listSessions()).resolves.toEqual({
      ok: false,
      message: "tmux session listing failed.",
    })
  })

  test("returns a helpful message when tmux is missing", async () => {
    spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("ENOENT")
    })

    await expect(listSessions()).resolves.toEqual({
      ok: false,
      message: "tmux is required but was not found.",
    })
  })
})

function mockTmux(input: {
  exitCode?: number
  stderr?: string
  stdout?: string
  results?: { exitCode: number; stderr?: string; stdout?: string }[]
}): string[][] {
  const calls: string[][] = []
  const results = input.results ?? [
    {
      exitCode: input.exitCode ?? 0,
      stderr: input.stderr,
      stdout: input.stdout,
    },
  ]

  spyOn(Bun, "spawn").mockImplementation((command) => {
    const args = Array.isArray(command) ? command : command.cmd
    calls.push([...args])
    const result = results[Math.min(calls.length - 1, results.length - 1)]

    return {
      exited: Promise.resolve(result.exitCode),
      stderr: result.stderr ?? "",
      stdout: result.stdout ?? "",
    } as unknown as ReturnType<typeof Bun.spawn>
  })

  return calls
}
