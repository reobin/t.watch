type GitMetadata = {
  branch?: string;
  dirty?: boolean;
};

type GitMetadataOptions = {
  force?: boolean;
};

const gitMetadataCacheTtlMs = 10000;
const gitMetadataCache = new Map<string, { metadata: GitMetadata; updatedAt: number }>();

export async function gitMetadata(
  path: string,
  options: GitMetadataOptions = {},
): Promise<GitMetadata> {
  const cached = gitMetadataCache.get(path);
  const now = Date.now();

  if (!options.force && cached && now - cached.updatedAt < gitMetadataCacheTtlMs) {
    return cached.metadata;
  }

  const branch = await gitBranch(path);

  if (!branch) {
    const metadata = {};

    gitMetadataCache.set(path, { metadata, updatedAt: now });

    return metadata;
  }

  const dirty = await gitDirty(path);
  const metadata = {
    branch,
    ...(dirty ? { dirty } : {}),
  };

  gitMetadataCache.set(path, { metadata, updatedAt: now });

  return metadata;
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
