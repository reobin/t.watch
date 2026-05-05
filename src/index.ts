#!/usr/bin/env bun

import { startApp } from "./app";
import { runCli } from "./cli";

const exitCode = await runCli(Bun.argv, startApp);

if (exitCode !== 0) {
  process.exit(exitCode);
}
