type Output = {
  error(message: string): void;
  log(message: string): void;
};

type StartApp = () => Promise<void>;

export async function runCli(
  argv: string[],
  startApp: StartApp,
  output: Output = console,
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

  output.error("Usage: thud [version]");
  return 1;
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
