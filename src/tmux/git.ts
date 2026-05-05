export type GitMetadata = {
  branch?: string;
  dirty?: boolean;
};

export async function gitMetadata(path: string): Promise<GitMetadata> {
  const branch = await gitBranch(path);

  if (!branch) {
    return {};
  }

  const dirty = await gitDirty(path);

  return {
    branch,
    ...(dirty ? { dirty } : {}),
  };
}

async function gitBranch(path: string): Promise<string | undefined> {
  const branch = await runGit(path, ["symbolic-ref", "--quiet", "--short", "HEAD"]);

  if (branch) {
    return branch;
  }

  return runGit(path, ["rev-parse", "--short", "HEAD"]);
}

async function gitDirty(path: string): Promise<boolean> {
  return Boolean(await runGit(path, ["status", "--porcelain"], { compact: false }));
}

async function runGit(
  path: string,
  args: string[],
  options: { compact: boolean } = { compact: true },
): Promise<string | undefined> {
  let gitProcess: ReturnType<typeof Bun.spawn>;

  try {
    gitProcess = Bun.spawn(["git", "-C", path, ...args], {
      stderr: "pipe",
      stdout: "pipe",
    });
  } catch {
    return undefined;
  }

  const [exitCode, stdout] = await Promise.all([
    gitProcess.exited,
    new Response(gitProcess.stdout as ReadableStream<Uint8Array>).text(),
  ]);
  const value = stdout.trim();

  if (exitCode !== 0 || !value || (options.compact && /\s/.test(value))) {
    return undefined;
  }

  return value;
}
