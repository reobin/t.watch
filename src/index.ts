#!/usr/bin/env bun

import { runCli } from "./cli";

const exitCode = await runCli(Bun.argv, async (options) => {
  const { startApp } = await import("./app");

  await startApp(options);
});

if (exitCode !== 0) {
  process.exit(exitCode);
}
