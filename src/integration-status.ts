import { RGBA, bold, fg, type TextChunk } from "@opentui/core";
import type { TmuxPaneIntegrationStatus, TmuxSession } from "./tmux";

const statusPalette = {
  red: 1,
  green: 2,
  magenta: 5,
  cyan: 6,
} as const;

const sessionStatusPriority = [
  "waiting",
  "idle",
  "error",
  "unknown",
] as const satisfies readonly TmuxPaneIntegrationStatus[];

export type IntegrationStatusSummary = {
  status: TmuxPaneIntegrationStatus;
  count: number;
};

export function sessionStatusSummary(session: TmuxSession): IntegrationStatusSummary | undefined {
  const counts = new Map<TmuxPaneIntegrationStatus, number>();

  for (const window of session.windows) {
    for (const pane of window.panes) {
      const status = pane.integration?.status;

      if (status) {
        counts.set(status, (counts.get(status) ?? 0) + 1);
      }
    }
  }

  for (const status of sessionStatusPriority) {
    const count = counts.get(status);

    if (count) {
      return { status, count };
    }
  }

  return undefined;
}

export function statusCircle(status: TmuxPaneIntegrationStatus, textMutedFg: RGBA): TextChunk {
  switch (status) {
    case "idle":
      return bold(terminalFg(statusPalette.green, "●"));
    case "running":
      return bold(terminalFg(statusPalette.cyan, "●"));
    case "waiting":
      return bold(terminalFg(statusPalette.magenta, "●"));
    case "error":
      return bold(terminalFg(statusPalette.red, "●"));
    case "unknown":
      return fg(textMutedFg)("●");
  }
}

export function statusLabel(status: TmuxPaneIntegrationStatus): string {
  switch (status) {
    case "idle":
      return "idle";
    case "running":
      return "running";
    case "waiting":
      return "waiting";
    case "error":
      return "error";
    case "unknown":
      return "unknown";
  }
}

export function statusColor(status: TmuxPaneIntegrationStatus, textMutedFg: RGBA): RGBA {
  switch (status) {
    case "idle":
      return RGBA.fromIndex(statusPalette.green);
    case "running":
      return RGBA.fromIndex(statusPalette.cyan);
    case "waiting":
      return RGBA.fromIndex(statusPalette.magenta);
    case "error":
      return RGBA.fromIndex(statusPalette.red);
    case "unknown":
      return textMutedFg;
  }
}

function terminalFg(index: number, text: string): TextChunk {
  return fg(RGBA.fromIndex(index))(text);
}
