import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { listSessions } from "./sessions";

describe("listSessions", () => {
  afterEach(() => {
    mock.restore();
  });

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
              "waiting",
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
            ["$2", "@3", "%3", "1", "1", "vim", "30", "notes"].join("\x1f"),
          ].join("\n"),
        },
        { exitCode: 0, stdout: "" },
        {
          exitCode: 0,
          stdout: ["100 10 node node /home/reobin/.local/bin/opencode", "200 20 bash -bash"].join(
            "\n",
          ),
        },
      ],
    });

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
                  ssh: false,
                  integration: {
                    tool: "opencode",
                    status: "waiting",
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
                  ssh: false,
                },
              ],
            },
          ],
          attached: true,
          sshAttached: false,
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
                  ssh: false,
                },
              ],
            },
          ],
          attached: false,
          sshAttached: false,
          createdAt: new Date(1700000200 * 1000),
          activityAt: new Date(1700000300 * 1000),
        },
      ],
    });

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
        "#{session_id}\x1f#{window_id}\x1f#{pane_id}\x1f#{pane_index}\x1f#{pane_active}\x1f#{pane_current_command}\x1f#{pane_pid}\x1f#{pane_title}\x1f#{@thud_sh_tool}\x1f#{@thud_sh_status}\x1f#{@thud_sh_status_label}\x1f#{@thud_sh_status_updated_at}\x1f#{pane_current_path}",
      ],
      ["tmux", "list-clients", "-F", "#{session_id}\x1f#{client_pid}"],
      ["ps", "-eo", "pid=,ppid=,comm=,args="],
    ]);
  });

  test("adds path and git metadata from the active pane", async () => {
    const calls = mockTmux({
      results: [
        {
          exitCode: 0,
          stdout: ["$1", "work", "1", "1700000000", "1700000100"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: ["$1", "@1", "1", "work", "1"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: [
            ["$1", "@1", "%1", "1", "1", "bash", "10", "shell", "", "", "", "", "/repo/work"].join(
              "\x1f",
            ),
            ["$1", "@1", "%2", "2", "0", "bash", "20", "shell", "", "", "", "", "/repo/other"].join(
              "\x1f",
            ),
          ].join("\n"),
        },
        { exitCode: 0, stdout: "" },
        { exitCode: 0, stdout: "100 10 bash -bash\n200 20 bash -bash" },
        { exitCode: 0, stdout: "main\n" },
        { exitCode: 0, stdout: " M src/index.ts\n" },
      ],
    });

    const result = await listSessions({ forceGit: true });

    expect(result).toMatchObject({
      ok: true,
      sessions: [
        {
          name: "work",
          path: "/repo/work",
          gitBranch: "main",
          gitDirty: true,
          windows: [
            {
              panes: [
                { id: "%1", currentPath: "/repo/work" },
                { id: "%2", currentPath: "/repo/other" },
              ],
            },
          ],
        },
      ],
    });
    expect(calls.slice(5)).toEqual([
      ["git", "-C", "/repo/work", "symbolic-ref", "--quiet", "--short", "HEAD"],
      ["git", "-C", "/repo/work", "status", "--porcelain"],
    ]);
  });

  test("falls back to the first pane path when the active pane has none", async () => {
    const calls = mockTmux({
      results: [
        {
          exitCode: 0,
          stdout: ["$1", "work", "1", "1700000000", "1700000100"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: ["$1", "@1", "1", "work", "1"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: [
            ["$1", "@1", "%1", "1", "0", "bash", "10", "shell", "", "", "", "", "/repo/first"].join(
              "\x1f",
            ),
            ["$1", "@1", "%2", "2", "1", "bash", "20", "shell", "", "", "", "", ""].join("\x1f"),
          ].join("\n"),
        },
        { exitCode: 0, stdout: "" },
        { exitCode: 0, stdout: "100 10 bash -bash\n200 20 bash -bash" },
        { exitCode: 0, stdout: "main\n" },
        { exitCode: 0, stdout: "" },
      ],
    });

    const result = await listSessions({ forceGit: true });

    expect(result).toMatchObject({
      ok: true,
      sessions: [
        {
          path: "/repo/first",
          gitBranch: "main",
        },
      ],
    });
    if (result.ok) {
      expect(result.sessions[0]?.gitDirty).toBeUndefined();
    }
    expect(calls.slice(5)).toEqual([
      ["git", "-C", "/repo/first", "symbolic-ref", "--quiet", "--short", "HEAD"],
      ["git", "-C", "/repo/first", "status", "--porcelain"],
    ]);
  });

  test("uses the short commit when the git path is detached", async () => {
    const calls = mockTmux({
      results: [
        {
          exitCode: 0,
          stdout: ["$1", "work", "1", "1700000000", "1700000100"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: ["$1", "@1", "1", "work", "1"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: [
            "$1",
            "@1",
            "%1",
            "1",
            "1",
            "bash",
            "10",
            "shell",
            "",
            "",
            "",
            "",
            "/repo/work",
          ].join("\x1f"),
        },
        { exitCode: 0, stdout: "" },
        { exitCode: 0, stdout: "100 10 bash -bash" },
        { exitCode: 1, stdout: "" },
        { exitCode: 0, stdout: "abc1234\n" },
        { exitCode: 0, stdout: "" },
      ],
    });

    const result = await listSessions({ forceGit: true });

    expect(result).toMatchObject({
      ok: true,
      sessions: [{ path: "/repo/work", gitBranch: "abc1234" }],
    });
    if (result.ok) {
      expect(result.sessions[0]?.gitDirty).toBeUndefined();
    }
    expect(calls.slice(5)).toEqual([
      ["git", "-C", "/repo/work", "symbolic-ref", "--quiet", "--short", "HEAD"],
      ["git", "-C", "/repo/work", "rev-parse", "--short", "HEAD"],
      ["git", "-C", "/repo/work", "status", "--porcelain"],
    ]);
  });

  test("keeps the path without git metadata outside a git repo", async () => {
    const calls = mockTmux({
      results: [
        {
          exitCode: 0,
          stdout: ["$1", "work", "1", "1700000000", "1700000100"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: ["$1", "@1", "1", "work", "1"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: ["$1", "@1", "%1", "1", "1", "bash", "10", "shell", "", "", "", "", "/tmp"].join(
            "\x1f",
          ),
        },
        { exitCode: 0, stdout: "" },
        { exitCode: 0, stdout: "100 10 bash -bash" },
        { exitCode: 1, stdout: "" },
        { exitCode: 1, stdout: "" },
      ],
    });

    const result = await listSessions({ forceGit: true });

    expect(result).toMatchObject({
      ok: true,
      sessions: [{ path: "/tmp" }],
    });
    if (result.ok) {
      expect(result.sessions[0]?.gitBranch).toBeUndefined();
      expect(result.sessions[0]?.gitDirty).toBeUndefined();
    }
    expect(calls.slice(5)).toEqual([
      ["git", "-C", "/tmp", "symbolic-ref", "--quiet", "--short", "HEAD"],
      ["git", "-C", "/tmp", "rev-parse", "--short", "HEAD"],
    ]);
  });

  test("detects sessions attached through ssh", async () => {
    mockTmux({
      results: [
        {
          exitCode: 0,
          stdout: ["$1", "work", "1", "1700000000", "1700000100"].join("\x1f"),
        },
        { exitCode: 0, stdout: "" },
        { exitCode: 0, stdout: "" },
        { exitCode: 0, stdout: ["$1", "30"].join("\x1f") },
        {
          exitCode: 0,
          stdout: [
            "10 1 sshd-session sshd-session: reobin [priv]",
            "20 10 bash -bash",
            "30 20 tmux tmux attach",
          ].join("\n"),
        },
      ],
    });

    await expect(listSessions()).resolves.toMatchObject({
      ok: true,
      sessions: [
        {
          name: "work",
          attached: true,
          sshAttached: true,
        },
      ],
    });
  });

  test("keeps local coloring when a session also has a local client", async () => {
    mockTmux({
      results: [
        {
          exitCode: 0,
          stdout: ["$1", "work", "2", "1700000000", "1700000100"].join("\x1f"),
        },
        { exitCode: 0, stdout: "" },
        { exitCode: 0, stdout: "" },
        {
          exitCode: 0,
          stdout: [["$1", "30"].join("\x1f"), ["$1", "40"].join("\x1f")].join("\n"),
        },
        {
          exitCode: 0,
          stdout: [
            "10 1 sshd-session sshd-session: reobin [priv]",
            "20 10 bash -bash",
            "30 20 tmux tmux attach",
            "40 1 tmux tmux attach",
          ].join("\n"),
        },
      ],
    });

    await expect(listSessions()).resolves.toMatchObject({
      ok: true,
      sessions: [
        {
          name: "work",
          attached: true,
          sshAttached: false,
        },
      ],
    });
  });

  test("detects panes opened through ssh", async () => {
    mockTmux({
      results: [
        {
          exitCode: 0,
          stdout: ["$1", "work", "1", "1700000000", "1700000100"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: ["$1", "@1", "1", "work", "1"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: [
            ["$1", "@1", "%1", "1", "1", "ssh", "40", "shell"].join("\x1f"),
            ["$1", "@1", "%2", "2", "0", "bash", "60", "shell"].join("\x1f"),
          ].join("\n"),
        },
        { exitCode: 0, stdout: "" },
        {
          exitCode: 0,
          stdout: ["50 40 ssh ssh server.example.com"].join("\n"),
        },
      ],
    });

    await expect(listSessions()).resolves.toMatchObject({
      ok: true,
      sessions: [
        {
          windows: [
            {
              panes: [
                {
                  processName: "ssh",
                  ssh: true,
                },
                {
                  processName: "bash",
                  ssh: false,
                },
              ],
            },
          ],
        },
      ],
    });
  });

  test("uses zero panes when pane listing fails", async () => {
    mockTmux({
      results: [
        {
          exitCode: 0,
          stdout: ["$1", "work", "2", "1700000000", "1700000100"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: ["$1", "@1", "1", "work", "1"].join("\x1f"),
        },
        { exitCode: 1, stderr: "pane listing failed" },
        { exitCode: 0, stdout: "" },
        { exitCode: 0, stdout: "" },
      ],
    });

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
          sshAttached: false,
          createdAt: new Date(1700000000 * 1000),
          activityAt: new Date(1700000100 * 1000),
        },
      ],
    });
  });

  test("uses unknown for invalid integration statuses", async () => {
    mockTmux({
      results: [
        {
          exitCode: 0,
          stdout: ["$1", "work", "1", "1700000000", "1700000100"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: ["$1", "@1", "1", "work", "1"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: [
            "$1",
            "@1",
            "%1",
            "1",
            "1",
            "node",
            "10",
            "OC | Coding",
            "opencode",
            "",
            "",
            "1700000110",
          ].join("\x1f"),
        },
        { exitCode: 0, stdout: "" },
        {
          exitCode: 0,
          stdout: "100 10 node node /home/reobin/.local/bin/opencode",
        },
      ],
    });

    await expect(listSessions()).resolves.toMatchObject({
      ok: true,
      sessions: [
        {
          windows: [
            {
              panes: [
                {
                  integration: {
                    tool: "opencode",
                    status: "unknown",
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  test("uses the tmux foreground command as the pane name", async () => {
    mockTmux({
      results: [
        {
          exitCode: 0,
          stdout: ["$1", "work", "1", "1700000000", "1700000100"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: ["$1", "@1", "1", "work", "1"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: ["$1", "@1", "%1", "1", "1", "npm", "40", "shell"].join("\x1f"),
        },
        { exitCode: 0, stdout: "" },
        {
          exitCode: 0,
          stdout: ["50 40 sh sh -c vite", "60 50 node node /app/node_modules/.bin/vite"].join("\n"),
        },
      ],
    });

    await expect(listSessions()).resolves.toMatchObject({
      ok: true,
      sessions: [
        {
          windows: [
            {
              panes: [
                {
                  command: "npm",
                  processName: "npm",
                },
              ],
            },
          ],
        },
      ],
    });
  });

  test("uses the runtime target as the pane name", async () => {
    mockSinglePaneTmux({
      pane: ["$1", "@1", "%1", "1", "1", "node", "10", "shell"],
      process: "100 10 node node /home/reobin/.local/bin/opencode",
    });

    await expect(listSessions()).resolves.toMatchObject({
      ok: true,
      sessions: [
        {
          windows: [
            {
              panes: [
                {
                  command: "node",
                  processName: "opencode",
                },
              ],
            },
          ],
        },
      ],
    });
  });

  test("uses runtime args when process comm is decorated", async () => {
    mockSinglePaneTmux({
      pane: ["$1", "@1", "%1", "1", "1", "node", "10", "shell"],
      process:
        "100 10 node-MainThread node /home/reobin/.local/share/mise/installs/node/25.9.0/bin/ocv",
    });

    await expect(listSessions()).resolves.toMatchObject({
      ok: true,
      sessions: [
        {
          windows: [
            {
              panes: [
                {
                  command: "node",
                  processName: "opencode",
                },
              ],
            },
          ],
        },
      ],
    });
  });

  test("keeps runtime names when flags obscure the target", async () => {
    mockSinglePaneTmux({
      pane: ["$1", "@1", "%1", "1", "1", "node", "10", "shell"],
      process: "100 10 node node --loader ts-node/esm ./src/index.ts",
    });

    await expect(listSessions()).resolves.toMatchObject({
      ok: true,
      sessions: [
        {
          windows: [
            {
              panes: [
                {
                  command: "node",
                  processName: "node",
                },
              ],
            },
          ],
        },
      ],
    });
  });

  test("uses package bin names for runtime package entrypoints", async () => {
    const projectPath = process.cwd();

    mockSinglePaneTmux({
      pane: ["$1", "@1", "%1", "1", "1", "bun", "10", "shell", "", "", "", "", projectPath],
      process: `100 10 bun bun ${projectPath}/dist/index.js`,
    });

    await expect(listSessions()).resolves.toMatchObject({
      ok: true,
      sessions: [
        {
          windows: [
            {
              panes: [
                {
                  command: "bun",
                  processName: "thud",
                },
              ],
            },
          ],
        },
      ],
    });
  });

  test("uses package bin names for runtime targets outside the pane cwd", async () => {
    const projectPath = process.cwd();

    mockSinglePaneTmux({
      pane: ["$1", "@1", "%1", "1", "1", "bun", "10", "shell", "", "", "", "", "/"],
      process: `100 10 bun bun ${projectPath}/dist/index.js`,
    });

    await expect(listSessions()).resolves.toMatchObject({
      ok: true,
      sessions: [
        {
          windows: [
            {
              panes: [
                {
                  command: "bun",
                  processName: "thud",
                },
              ],
            },
          ],
        },
      ],
    });
  });

  test("keeps runtime names for package scripts over stale integration", async () => {
    const projectPath = process.cwd();

    mockSinglePaneTmux({
      pane: [
        "$1",
        "@1",
        "%1",
        "1",
        "1",
        "bun",
        "10",
        "shell",
        "opencode",
        "idle",
        "",
        "",
        projectPath,
      ],
      process: "100 10 bun bun start",
    });

    const result = await listSessions();

    expect(result).toMatchObject({
      ok: true,
      sessions: [{ windows: [{ panes: [{ command: "bun", processName: "bun" }] }] }],
    });

    if (result.ok) {
      expect(result.sessions[0]?.windows[0]?.panes[0]?.integration).toBeUndefined();
    }
  });

  test("keeps runtime names when flags precede package scripts", async () => {
    const projectPath = process.cwd();

    mockSinglePaneTmux({
      pane: ["$1", "@1", "%1", "1", "1", "bun", "10", "shell", "", "", "", "", projectPath],
      process: "100 10 bun bun --hot run dev",
    });

    await expect(listSessions()).resolves.toMatchObject({
      ok: true,
      sessions: [{ windows: [{ panes: [{ command: "bun", processName: "bun" }] }] }],
    });
  });

  test("keeps editor panes named after the editor", async () => {
    mockTmux({
      results: [
        {
          exitCode: 0,
          stdout: ["$1", "work", "1", "1700000000", "1700000100"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: ["$1", "@1", "1", "editor", "1"].join("\x1f"),
        },
        {
          exitCode: 0,
          stdout: ["$1", "@1", "%1", "1", "1", "nvim", "40", "node thread"].join("\x1f"),
        },
        { exitCode: 0, stdout: "" },
        {
          exitCode: 0,
          stdout: "400 40 lazygit lazygit",
        },
      ],
    });

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
              name: "editor",
              active: true,
              panes: [
                {
                  id: "%1",
                  index: 1,
                  active: true,
                  command: "nvim",
                  title: "node thread",
                  processName: "nvim",
                  ssh: false,
                },
              ],
            },
          ],
          attached: true,
          sshAttached: false,
          createdAt: new Date(1700000000 * 1000),
          activityAt: new Date(1700000100 * 1000),
        },
      ],
    });
  });

  test("returns an empty list when tmux has no sessions", async () => {
    mockTmux({ exitCode: 1, stderr: "no server running on /tmp/tmux-1000/default" });

    await expect(listSessions()).resolves.toEqual({ ok: true, sessions: [] });
  });

  test("returns an empty list for tmux no sessions errors", async () => {
    mockTmux({ exitCode: 1, stderr: "no sessions" });

    await expect(listSessions()).resolves.toEqual({ ok: true, sessions: [] });
  });

  test("returns tmux stderr for other failures", async () => {
    mockTmux({ exitCode: 1, stderr: "permission denied" });

    await expect(listSessions()).resolves.toEqual({
      ok: false,
      message: "permission denied",
    });
  });

  test("falls back to stdout for failures without stderr", async () => {
    mockTmux({ exitCode: 1, stdout: "stdout failure" });

    await expect(listSessions()).resolves.toEqual({
      ok: false,
      message: "stdout failure",
    });
  });

  test("returns a default message for failures without output", async () => {
    mockTmux({ exitCode: 1 });

    await expect(listSessions()).resolves.toEqual({
      ok: false,
      message: "tmux session listing failed.",
    });
  });

  test("returns a helpful message when tmux is missing", async () => {
    spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("ENOENT");
    });

    await expect(listSessions()).resolves.toEqual({
      ok: false,
      message: "tmux is required but was not found.",
    });
  });
});

function mockTmux(input: {
  exitCode?: number;
  stderr?: string;
  stdout?: string;
  results?: { exitCode: number; stderr?: string; stdout?: string }[];
}): string[][] {
  const calls: string[][] = [];
  const results = input.results ?? [
    {
      exitCode: input.exitCode ?? 0,
      stderr: input.stderr,
      stdout: input.stdout,
    },
  ];

  spyOn(Bun, "spawn").mockImplementation((command) => {
    const args = Array.isArray(command) ? command : command.cmd;
    calls.push([...args]);
    const result = results[Math.min(calls.length - 1, results.length - 1)];

    return {
      exited: Promise.resolve(result.exitCode),
      stderr: result.stderr ?? "",
      stdout: result.stdout ?? "",
    } as unknown as ReturnType<typeof Bun.spawn>;
  });

  return calls;
}

function mockSinglePaneTmux(input: { pane: string[]; process: string }): void {
  mockTmux({
    results: [
      {
        exitCode: 0,
        stdout: ["$1", "work", "1", "1700000000", "1700000100"].join("\x1f"),
      },
      {
        exitCode: 0,
        stdout: ["$1", "@1", "1", "work", "1"].join("\x1f"),
      },
      {
        exitCode: 0,
        stdout: input.pane.join("\x1f"),
      },
      { exitCode: 0, stdout: "" },
      {
        exitCode: 0,
        stdout: input.process,
      },
    ],
  });
}
