import { missingTmuxMessage, runTmux } from "./commands";
import type { TmuxSessionWatchResult } from "./types";

const pathSubscriptionPrefix = "thud-sh-path-";
const pathSubscriptionFormat = "#{pane_current_path}";
const fieldSeparator = "\x1f";
const pathSnapshotFormat = ["#{pane_id}", "#{pane_current_path}"].join(fieldSeparator);
const pathSnapshotPollIntervalMs = 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type PanePathRecord = {
  id: string;
  path: string;
};

type ControlInput = {
  close: () => void | Promise<void>;
  write: (chunk: Uint8Array) => void | Promise<void>;
};

type ControlReader = {
  cancel: () => Promise<void>;
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  releaseLock: () => void;
};

type ControlOutput = {
  getReader: () => ControlReader;
};
type ResponseBody = ConstructorParameters<typeof Response>[0];

export async function watchPanePaths(
  onChange: () => void | Promise<void>,
  onStop?: (message: string) => void,
): Promise<TmuxSessionWatchResult> {
  let tmuxProcess: ReturnType<typeof Bun.spawn> | undefined;
  let reader: ControlReader | undefined;
  let writer: ControlInput | undefined;
  let syncTimer: ReturnType<typeof setInterval> | undefined;
  let refreshTimeout: ReturnType<typeof setTimeout> | undefined;
  let isSyncingPanePaths = false;
  let stopped = false;
  let cleanedUp = false;
  const subscribedPaneIds = new Set<string>();
  const knownPanePaths = new Map<string, string>();

  const scheduleRefresh = () => {
    if (refreshTimeout) {
      return;
    }

    refreshTimeout = setTimeout(() => {
      refreshTimeout = undefined;
      void onChange();
    }, 0);
  };

  const cleanup = async () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    stopped = true;

    if (refreshTimeout) {
      clearTimeout(refreshTimeout);
      refreshTimeout = undefined;
    }

    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = undefined;
    }

    reader?.cancel().catch(() => undefined);
    Promise.resolve(writer?.close()).catch(() => undefined);
    tmuxProcess?.kill();
  };

  const stopFromError = async (message: string) => {
    if (stopped) {
      return;
    }

    await cleanup();
    onStop?.(message);
  };

  try {
    const sessionId = await currentSessionId();

    if (!sessionId) {
      return { ok: false, message: "tmux pane path watcher unavailable." };
    }

    tmuxProcess = Bun.spawn(["tmux", "-C", "attach-session", "-t", sessionId], {
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
    });
    writer = controlInput(tmuxProcess.stdin);

    if (!writer) {
      tmuxProcess.kill();

      return { ok: false, message: "tmux pane path watcher failed." };
    }

    const panePaths = await listPanePaths();

    if (!panePaths) {
      await cleanup();

      return { ok: false, message: "tmux pane path watcher failed." };
    }

    syncKnownPanePaths(knownPanePaths, panePaths);
    await syncSubscriptions(
      writer,
      subscribedPaneIds,
      panePaths.map((pane) => pane.id),
    );
  } catch (error) {
    await cleanup();

    if (error instanceof Error && error.message.includes("ENOENT")) {
      return { ok: false, message: missingTmuxMessage };
    }

    throw error;
  }

  if (!tmuxProcess || !writer) {
    return { ok: false, message: "tmux pane path watcher failed." };
  }

  const stdout = controlOutput(tmuxProcess.stdout);
  const controlWriter = writer;

  if (!stdout) {
    await cleanup();

    return { ok: false, message: "tmux pane path watcher failed." };
  }

  void readControlOutput(
    stdout,
    (localReader) => {
      reader = localReader;
    },
    (line) => {
      if (line.startsWith(`%subscription-changed ${pathSubscriptionPrefix}`)) {
        const panePath = parsePathSubscriptionChange(line);

        if (!panePath) {
          scheduleRefresh();
          return;
        }

        const previousPath = knownPanePaths.get(panePath.id);
        knownPanePaths.set(panePath.id, panePath.path);

        if (previousPath !== panePath.path) {
          scheduleRefresh();
        }
      }
    },
  ).catch((error) => {
    if (error instanceof Error && error.name === "AbortError") {
      return;
    }

    void stopFromError("tmux pane path watcher stopped.");
  });

  void (async () => {
    const [exitCode, stderr] = await Promise.all([
      tmuxProcess.exited,
      new Response(responseBody(tmuxProcess.stderr)).text().catch(() => ""),
    ]);

    if (!stopped) {
      await stopFromError(
        stderr.trim() ||
          (exitCode === 0 ? "tmux pane path watcher stopped." : "tmux pane path watcher failed."),
      );
    }
  })();

  syncTimer = setInterval(() => {
    if (isSyncingPanePaths) {
      return;
    }

    isSyncingPanePaths = true;

    void (async () => {
      const panePaths = await listPanePaths();

      if (panePaths) {
        if (syncKnownPanePaths(knownPanePaths, panePaths)) {
          scheduleRefresh();
        }

        await syncSubscriptions(
          controlWriter,
          subscribedPaneIds,
          panePaths.map((pane) => pane.id),
        );
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        isSyncingPanePaths = false;
      });
  }, pathSnapshotPollIntervalMs);

  return {
    ok: true,
    watcher: {
      stop: cleanup,
    },
  };
}

async function currentSessionId(): Promise<string | undefined> {
  const result = await runTmux(["display-message", "-p", "#{session_id}"]);
  const sessionId = result.stdout.trim();

  if (result.exitCode === 0 && isSessionId(sessionId)) {
    return sessionId;
  }

  const sessionsResult = await runTmux(["list-sessions", "-F", "#{session_id}"]);

  if (sessionsResult.exitCode !== 0) {
    return undefined;
  }

  return sessionsResult.stdout.trim().split(/\r?\n/).find(isSessionId);
}

function isSessionId(value: string): boolean {
  return value.startsWith("$");
}

async function listPanePaths(): Promise<PanePathRecord[] | undefined> {
  const result = await runTmux(["list-panes", "-a", "-F", pathSnapshotFormat]);

  if (result.exitCode !== 0) {
    return undefined;
  }

  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(parsePanePath);
}

function parsePanePath(line: string): PanePathRecord {
  const [id, path] = line.split(fieldSeparator);

  return { id: id ?? "", path: path ?? "" };
}

function parsePathSubscriptionChange(line: string): PanePathRecord | undefined {
  const valueSeparator = " : ";
  const separatorIndex = line.indexOf(valueSeparator);

  if (separatorIndex === -1) {
    return undefined;
  }

  const fields = line.slice(0, separatorIndex).split(/\s+/);
  const paneId = fields.at(-1);

  if (!paneId) {
    return undefined;
  }

  return { id: paneId, path: line.slice(separatorIndex + valueSeparator.length) };
}

function syncKnownPanePaths(
  knownPanePaths: Map<string, string>,
  panePaths: PanePathRecord[],
): boolean {
  let changed = false;
  const nextPaneIds = new Set(panePaths.map((pane) => pane.id));

  for (const paneId of knownPanePaths.keys()) {
    if (!nextPaneIds.has(paneId)) {
      knownPanePaths.delete(paneId);
      changed = true;
    }
  }

  for (const pane of panePaths) {
    const hadPane = knownPanePaths.has(pane.id);
    const previousPath = knownPanePaths.get(pane.id);

    if (!hadPane || previousPath !== pane.path) {
      changed = true;
    }

    knownPanePaths.set(pane.id, pane.path);
  }

  return changed;
}

async function syncSubscriptions(
  writer: ControlInput,
  subscribedPaneIds: Set<string>,
  paneIds: string[],
): Promise<void> {
  const nextPaneIds = new Set(paneIds);

  for (const paneId of subscribedPaneIds) {
    if (!nextPaneIds.has(paneId)) {
      await sendControlCommand(writer, `refresh-client -B '${subscriptionName(paneId)}'`);
      subscribedPaneIds.delete(paneId);
    }
  }

  for (const paneId of nextPaneIds) {
    if (!subscribedPaneIds.has(paneId)) {
      await sendControlCommand(
        writer,
        `refresh-client -B '${subscriptionName(paneId)}:${paneId}:${pathSubscriptionFormat}'`,
      );
      subscribedPaneIds.add(paneId);
    }
  }
}

async function sendControlCommand(writer: ControlInput, command: string): Promise<void> {
  await writer.write(encoder.encode(`${command}\n`));
}

async function readControlOutput(
  stream: ControlOutput,
  onReader: (reader: ControlReader) => void,
  onLine: (line: string) => void,
): Promise<void> {
  const localReader = stream.getReader();
  let buffer = "";
  onReader(localReader);

  try {
    while (true) {
      const { done, value } = await localReader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");

      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        onLine(line);
        newlineIndex = buffer.indexOf("\n");
      }
    }
  } finally {
    localReader.releaseLock();
  }
}

function subscriptionName(paneId: string): string {
  return `${pathSubscriptionPrefix}${paneId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function controlInput(value: unknown): ControlInput | undefined {
  if (hasMethod(value, "getWriter")) {
    const writer = value.getWriter() as ControlInput;

    return {
      close: () => writer.close(),
      write: (chunk) => writer.write(chunk),
    };
  }

  if (hasMethod(value, "write")) {
    return {
      close: () => {
        if (hasMethod(value, "end")) {
          value.end();
          return;
        }

        if (hasMethod(value, "close")) {
          value.close();
        }
      },
      write: (chunk) => {
        value.write(chunk);
        if (hasMethod(value, "flush")) {
          return value.flush() as void | Promise<void>;
        }
      },
    };
  }

  return undefined;
}

function controlOutput(value: unknown): ControlOutput | undefined {
  return hasMethod(value, "getReader") ? (value as ControlOutput) : undefined;
}

function responseBody(value: unknown): ResponseBody {
  if (typeof value === "string") {
    return value;
  }

  if (hasMethod(value, "getReader")) {
    return value as ResponseBody;
  }

  return undefined;
}

function hasMethod<Name extends string>(
  value: unknown,
  name: Name,
): value is Record<Name, (...args: unknown[]) => unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return typeof (value as Record<string, unknown>)[name] === "function";
}
