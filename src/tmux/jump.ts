import { benchAsync, createBenchRun } from "../benchmark";
import { nextJumpPaneCandidateId } from "../navigation";
import {
  focusPaneForAllClients,
  focusPaneForCurrentClient,
  missingTmuxMessage,
  runTmux,
} from "./commands";
import type { TmuxFocusPaneResult, TmuxPaneIntegrationStatus } from "./types";

const fieldSeparator = "\x1f";
const paneFormat = [
  "#{pane_id}",
  "#{pane_active}",
  "#{window_active}",
  "#{session_attached}",
  "#{@thud_sh_tool}",
  "#{@thud_sh_status}",
].join(fieldSeparator);

type JumpPane = {
  id: string;
  active: boolean;
  windowActive: boolean;
  sessionAttached: boolean;
  status?: TmuxPaneIntegrationStatus;
};
type JumpPaneListResult =
  | {
      ok: true;
      panes: JumpPane[];
    }
  | {
      ok: false;
      message: string;
    };

export async function jumpToNextPane(
  currentPaneId = process.env.TMUX_PANE,
): Promise<TmuxFocusPaneResult> {
  const bench = createBenchRun("jump");
  const timings: Record<string, number> = {};

  try {
    const panesResult = await benchAsync("jumpListPanesMs", timings, listJumpPanes);

    if (panesResult.ok === false) {
      bench.add(timings);
      bench.log({ ok: false, message: panesResult.message });

      return panesResult;
    }

    const reliableCurrentPaneId = currentPaneId;
    const resolvedCurrentPaneId =
      reliableCurrentPaneId ?? currentAttachedActivePaneId(panesResult.panes);
    const paneId = nextJumpPaneCandidateId(panesResult.panes, resolvedCurrentPaneId);

    if (!paneId) {
      bench.add(timings);
      bench.log({ ok: true, targetFound: false });

      return { ok: true };
    }

    if (reliableCurrentPaneId) {
      const currentFocusResult = await benchAsync("jumpCurrentFocusMs", timings, () =>
        focusPaneForCurrentClient(paneId),
      );

      if (currentFocusResult.ok === true || currentFocusResult.message === missingTmuxMessage) {
        bench.add(timings);
        bench.log({
          ok: currentFocusResult.ok,
          targetFound: true,
          focusFallback: false,
          message: currentFocusResult.ok ? undefined : currentFocusResult.message,
        });

        return currentFocusResult;
      }
    }

    const fallbackFocusResult = await benchAsync("jumpFallbackFocusMs", timings, () =>
      focusPaneForAllClients(paneId),
    );
    bench.add(timings);
    bench.log({
      ok: fallbackFocusResult.ok,
      targetFound: true,
      focusFallback: true,
      message: fallbackFocusResult.ok ? undefined : fallbackFocusResult.message,
    });

    return fallbackFocusResult;
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      bench.add(timings);
      bench.log({ ok: false, message: missingTmuxMessage });

      return { ok: false, message: missingTmuxMessage };
    }

    throw error;
  }
}

async function listJumpPanes(): Promise<JumpPaneListResult> {
  const result = await runTmux(["list-panes", "-a", "-F", paneFormat]);

  if (result.exitCode === 0) {
    return {
      ok: true,
      panes: result.stdout.trim().split(/\r?\n/).filter(Boolean).map(parseJumpPane),
    };
  }

  if (isNoSessionsError(result.stderr)) {
    return { ok: true, panes: [] };
  }

  return {
    ok: false,
    message: result.stderr.trim() || result.stdout.trim() || "tmux pane listing failed.",
  };
}

function parseJumpPane(line: string): JumpPane {
  const [id, active, windowActive, sessionAttached, tool, status] = line.split(fieldSeparator);

  return {
    id: id ?? "",
    active: Number(active) > 0,
    windowActive: Number(windowActive) > 0,
    sessionAttached: Number(sessionAttached) > 0,
    status: parseJumpStatus(tool, status),
  };
}

function parseJumpStatus(
  tool: string | undefined,
  status: string | undefined,
): TmuxPaneIntegrationStatus | undefined {
  if (!tool) {
    return undefined;
  }

  if (status === "idle" || status === "running" || status === "waiting") {
    return status;
  }

  return undefined;
}

function currentAttachedActivePaneId(panes: JumpPane[]): string | undefined {
  return panes.find((pane) => pane.sessionAttached && pane.windowActive && pane.active)?.id;
}

function isNoSessionsError(stderr: string): boolean {
  const message = stderr.trim().toLowerCase();

  return message.includes("no server running") || message.includes("no sessions");
}
