import { missingTmuxMessage, runTmux } from "./commands";
import type { TmuxSessionWatchResult } from "./types";

const sessionChangeHooks = [
  "session-created",
  "session-closed",
  "session-renamed",
  "after-new-window",
  "window-linked",
  "window-unlinked",
  "after-split-window",
  "after-kill-pane",
  "after-select-pane",
  "after-select-window",
  "session-window-changed",
  "client-attached",
  "client-detached",
  "client-session-changed",
] as const;

export async function watchSessions(
  onChange: () => void | Promise<void>,
  onStop?: (message: string) => void,
  onClientFocusOut?: () => void | Promise<void>,
): Promise<TmuxSessionWatchResult> {
  const hookIndex = String(process.pid);
  const channel = `thud-sh-sessions-${process.pid}`;
  const clientFocusOutChannel = `thud-sh-client-focus-out-${process.pid}`;
  const installedHooks: string[] = [];
  let waitProcess: ReturnType<typeof Bun.spawn> | undefined;
  let clientFocusOutWaitProcess: ReturnType<typeof Bun.spawn> | undefined;
  let stopped = false;
  let cleanedUp = false;
  let watchClientFocusOut = false;
  let refreshTimeout: ReturnType<typeof setTimeout> | undefined;

  try {
    for (const hook of sessionChangeHooks) {
      const hookTarget = `${hook}[${hookIndex}]`;
      const result = await runTmux(["set-hook", "-g", hookTarget, `wait-for -S ${channel}`]);

      if (result.exitCode !== 0) {
        await unsetHooks(installedHooks);

        return {
          ok: false,
          message: result.stderr.trim() || "tmux session watcher failed.",
        };
      }

      installedHooks.push(hookTarget);
    }

    if (onClientFocusOut && (await isFocusEventsEnabled())) {
      const clientName = await currentClientName();

      if (!clientName) {
        await unsetHooks(installedHooks);

        return {
          ok: false,
          message: "tmux client focus watcher failed.",
        };
      }

      const hookTarget = `client-focus-out[${hookIndex}]`;
      const result = await runTmux([
        "set-hook",
        "-g",
        hookTarget,
        `if -F ${quoteTmuxString(`#{==:#{hook_client},${clientName}}`)} ${quoteTmuxString(
          `wait-for -S ${clientFocusOutChannel}`,
        )}`,
      ]);

      if (result.exitCode !== 0) {
        await unsetHooks(installedHooks);

        return {
          ok: false,
          message: result.stderr.trim() || "tmux session watcher failed.",
        };
      }

      installedHooks.push(hookTarget);
      watchClientFocusOut = true;
    }
  } catch (error) {
    await unsetHooks(installedHooks);

    if (error instanceof Error && error.message.includes("ENOENT")) {
      return { ok: false, message: missingTmuxMessage };
    }

    throw error;
  }

  const scheduleRefresh = () => {
    if (refreshTimeout) {
      return;
    }

    refreshTimeout = setTimeout(() => {
      refreshTimeout = undefined;
      void onChange();
    }, 75);
  };

  const cleanup = async () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;

    if (refreshTimeout) {
      clearTimeout(refreshTimeout);
      refreshTimeout = undefined;
    }

    waitProcess?.kill();
    clientFocusOutWaitProcess?.kill();
    await unsetHooks(installedHooks);
  };

  const stopFromError = async (message: string) => {
    stopped = true;
    await cleanup();
    onStop?.(message);
  };

  const waitForChanges = async () => {
    while (!stopped) {
      const tmuxProcess = Bun.spawn(["tmux", "wait-for", channel], {
        stderr: "pipe",
        stdout: "pipe",
      });
      waitProcess = tmuxProcess;

      const [exitCode, stderr] = await Promise.all([
        tmuxProcess.exited,
        new Response(tmuxProcess.stderr).text(),
      ]);

      if (stopped) {
        break;
      }

      if (exitCode !== 0) {
        await stopFromError(stderr.trim() || "tmux session watcher stopped.");
        break;
      }

      scheduleRefresh();
    }
  };

  const waitForClientFocusOut = async () => {
    while (!stopped) {
      const tmuxProcess = Bun.spawn(["tmux", "wait-for", clientFocusOutChannel], {
        stderr: "pipe",
        stdout: "pipe",
      });
      clientFocusOutWaitProcess = tmuxProcess;

      const [exitCode, stderr] = await Promise.all([
        tmuxProcess.exited,
        new Response(tmuxProcess.stderr).text(),
      ]);

      if (stopped) {
        break;
      }

      if (exitCode !== 0) {
        await stopFromError(stderr.trim() || "tmux client focus watcher stopped.");
        break;
      }

      void onClientFocusOut?.();
    }
  };

  void waitForChanges();
  if (watchClientFocusOut) {
    void waitForClientFocusOut();
  }

  return {
    ok: true,
    watcher: {
      stop: async () => {
        stopped = true;
        await cleanup();
      },
    },
  };
}

async function unsetHooks(hooks: string[]): Promise<void> {
  await Promise.all(hooks.map((hook) => runTmux(["set-hook", "-gu", hook]).catch(() => undefined)));
}

async function isFocusEventsEnabled(): Promise<boolean> {
  const result = await runTmux(["show-options", "-gqv", "focus-events"]);

  return result.exitCode === 0 && result.stdout.trim() === "on";
}

async function currentClientName(): Promise<string | undefined> {
  const result = await runTmux(["display-message", "-p", "#{client_name}"]);

  if (result.exitCode !== 0) {
    return undefined;
  }

  return result.stdout.trim() || undefined;
}

function quoteTmuxString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
