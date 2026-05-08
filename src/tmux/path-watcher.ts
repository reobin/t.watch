import { missingTmuxMessage, runTmux } from "./commands";
import type { TmuxSessionWatchResult } from "./types";

const pathSubscriptionPrefix = "thud-sh-path-";
const pathSubscriptionFormat = "#{pane_current_path}";
const pathSubscriptionSyncIntervalMs = 15000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
  let stopped = false;
  let cleanedUp = false;
  const subscribedPaneIds = new Set<string>();

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

    const paneIds = await listPaneIds();

    if (!paneIds) {
      await cleanup();

      return { ok: false, message: "tmux pane path watcher failed." };
    }

    await syncSubscriptions(writer, subscribedPaneIds, paneIds);
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
        scheduleRefresh();
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
    void (async () => {
      const paneIds = await listPaneIds();

      if (paneIds) {
        await syncSubscriptions(controlWriter, subscribedPaneIds, paneIds);
      }
    })().catch(() => undefined);
  }, pathSubscriptionSyncIntervalMs);

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

  if (result.exitCode !== 0 || !sessionId.startsWith("$")) {
    return undefined;
  }

  return sessionId;
}

async function listPaneIds(): Promise<string[] | undefined> {
  const result = await runTmux(["list-panes", "-a", "-F", "#{pane_id}"]);

  if (result.exitCode !== 0) {
    return undefined;
  }

  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
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
