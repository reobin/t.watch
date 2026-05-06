import { nextJumpPaneId } from "./navigation";
import { focusPaneForAllClients, listSessions } from "./tmux";
import type { AppOptions } from "./app";

type Output = {
  error(message: string): void;
  log(message: string): void;
};

type StartApp = (options?: AppOptions) => Promise<void>;
type TmuxActions = {
  focusPaneForAllClients: typeof focusPaneForAllClients;
  listSessions: typeof listSessions;
};
type AppMode = "default" | "popup";

const help = `Usage: thud [--mode=default|popup] [--close-on-focus]
       thud [help|version|jump]

Commands:
  thud          Start the HUD
  thud help     Show help
  thud version  Print the installed package version
  thud jump     Focus the next pane needing attention

Options:
  --mode=default     Keep thud open after focusing a target
  --mode=popup       Close thud after focusing a target
  --close-on-focus   Close thud after focusing a target`;
const tmuxActions: TmuxActions = {
  focusPaneForAllClients,
  listSessions,
};

export async function runCli(
  argv: string[],
  startApp: StartApp,
  output: Output = console,
  tmux: TmuxActions = tmuxActions,
): Promise<number> {
  const args = argv.slice(2);
  const parsedOptions = parseAppOptions(args);

  if (parsedOptions.ok === true) {
    await startApp(parsedOptions.options);
    return 0;
  }

  if (args.length === 1 && args[0] === "help") {
    output.log(help);
    return 0;
  }

  if (args.length === 1 && args[0] === "version") {
    output.log(await packageIdentifier());
    return 0;
  }

  if (args.length === 1 && args[0] === "jump") {
    return jumpToPane(output, tmux);
  }

  output.error(help);
  return 1;
}

function parseAppOptions(args: string[]): { ok: true; options: AppOptions } | { ok: false } {
  let mode: AppMode = "default";
  let closeOnFocus = false;

  for (const arg of args) {
    if (arg === "--close-on-focus") {
      closeOnFocus = true;
      continue;
    }

    if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);

      if (value !== "default" && value !== "popup") {
        return { ok: false };
      }

      mode = value;
      continue;
    }

    return { ok: false };
  }

  return { ok: true, options: { closeOnFocus: closeOnFocus || mode === "popup" } };
}

async function jumpToPane(output: Output, tmux: TmuxActions): Promise<number> {
  const result = await tmux.listSessions();

  if (result.ok === false) {
    output.error(result.message);
    return 1;
  }

  const paneId = nextJumpPaneId(result.sessions, process.env.TMUX_PANE);

  if (!paneId) {
    return 0;
  }

  const focusResult = await tmux.focusPaneForAllClients(paneId);

  if (focusResult.ok === false) {
    output.error(focusResult.message);
    return 1;
  }

  return 0;
}

async function packageIdentifier(): Promise<string> {
  const packageJson = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
    name?: unknown;
    version?: unknown;
  };

  if (typeof packageJson.name !== "string") {
    throw new Error("package.json name is missing.");
  }

  if (typeof packageJson.version !== "string") {
    throw new Error("package.json version is missing.");
  }

  return `${packageJson.name}@${packageJson.version}`;
}
