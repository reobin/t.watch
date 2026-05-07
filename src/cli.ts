import { formatBenchSummary } from "./benchmark";
import { jumpToNextPane } from "./tmux/jump";

type Output = {
  error(message: string): void;
  log(message: string): void;
};

type StartApp = (options?: AppOptions) => Promise<void>;
type AppOptions = {
  closeOnFocus?: boolean;
};
type JumpActions = {
  jumpToNextPane: typeof jumpToNextPane;
};
type AppMode = "default" | "popup";

const help = `Usage: thud [--mode=default|popup] [--close-on-focus]
       thud [help|version|jump [pane-id]|bench-results [path]]

Commands:
  thud          Start the HUD
  thud help     Show help
  thud version  Print the installed package version
  thud jump     Focus the next pane needing attention
  thud bench-results  Summarize recorded benchmark results

Options:
  --mode=default     Keep thud open after focusing a target
  --mode=popup       Close thud after focusing a target
  --close-on-focus   Close thud after focusing a target`;
const jumpActions: JumpActions = {
  jumpToNextPane,
};

export async function runCli(
  argv: string[],
  startApp: StartApp,
  output: Output = console,
  jump: JumpActions = jumpActions,
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

  if (args[0] === "jump" && args.length <= 2) {
    return jumpToPane(output, jump, args[1]);
  }

  if (args[0] === "bench-results" && args.length <= 2) {
    output.log(formatBenchSummary(args[1]));
    return 0;
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

async function jumpToPane(
  output: Output,
  jump: JumpActions,
  currentPaneId?: string,
): Promise<number> {
  const result = await jump.jumpToNextPane(currentPaneId);

  if (result.ok === false) {
    output.error(result.message);
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
