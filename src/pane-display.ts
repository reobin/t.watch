import type { TmuxPane } from "./tmux";

export function paneContextTitle(pane: TmuxPane): string | undefined {
  if (pane.processName !== "opencode" && pane.integration?.tool !== "opencode") {
    return undefined;
  }

  const title = pane.title
    .replace(/^OC \|\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  return title && title !== pane.title ? title : undefined;
}
