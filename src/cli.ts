import { nextAttentionPaneId } from "./navigation";
import { focusPaneForAllClients, listSessions } from "./tmux";

type Output = {
  error(message: string): void;
  log(message: string): void;
};

type StartApp = () => Promise<void>;
type TmuxActions = {
  focusPaneForAllClients: typeof focusPaneForAllClients;
  listSessions: typeof listSessions;
};

const usage = "Usage: thud [version|attention]";
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

  if (args.length === 0) {
    await startApp();
    return 0;
  }

  if (args.length === 1 && args[0] === "version") {
    output.log(await packageIdentifier());
    return 0;
  }

  if (args.length === 1 && args[0] === "attention") {
    return focusAttentionPane(output, tmux);
  }

  output.error(usage);
  return 1;
}

async function focusAttentionPane(output: Output, tmux: TmuxActions): Promise<number> {
  const result = await tmux.listSessions();

  if (result.ok === false) {
    output.error(result.message);
    return 1;
  }

  const paneId = nextAttentionPaneId(result.sessions, process.env.TMUX_PANE);

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
