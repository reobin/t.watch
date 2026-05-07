import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { benchAsync, createBenchRun, formatBenchSummary } from "./benchmark";

const originalBench = process.env.THUD_BENCH;
const originalBenchLog = process.env.THUD_BENCH_LOG;
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "thud-bench-test-"));
  delete process.env.THUD_BENCH;
  delete process.env.THUD_BENCH_LOG;
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });

  if (originalBench === undefined) {
    delete process.env.THUD_BENCH;
  } else {
    process.env.THUD_BENCH = originalBench;
  }

  if (originalBenchLog === undefined) {
    delete process.env.THUD_BENCH_LOG;
  } else {
    process.env.THUD_BENCH_LOG = originalBenchLog;
  }
});

describe("benchmark logging", () => {
  test("summarizes zero records for missing logs", () => {
    const path = join(directory, "missing.jsonl");

    expect(formatBenchSummary(path)).toBe(`Benchmark log: ${path}\nrecords: 0`);
  });

  test("ignores invalid records and summarizes finite metric values", () => {
    const path = join(directory, "bench.jsonl");

    writeFileSync(
      path,
      [
        "not json",
        JSON.stringify(null),
        JSON.stringify({ event: "startup", firstRenderMs: 100, listSessionsMs: Number.NaN }),
        JSON.stringify({ event: "startup", firstRenderMs: 10, listSessionsMs: 5 }),
        JSON.stringify({ event: "startup", firstRenderMs: 20 }),
      ].join("\n"),
    );

    expect(formatBenchSummary(path)).toBe(
      [
        `Benchmark log: ${path}`,
        "records: 3",
        "firstRenderMs: count=3 min=10ms p50=20ms p95=100ms max=100ms",
        "listSessionsMs: count=1 min=5ms p50=5ms p95=5ms max=5ms",
      ].join("\n"),
    );
  });

  test("does not write benchmark records when disabled", () => {
    const path = join(directory, "bench.jsonl");
    process.env.THUD_BENCH_LOG = path;
    const bench = createBenchRun("startup", { mode: "default" });

    bench.add({ firstRenderMs: 10 });
    bench.log({ ok: true });

    expect(bench.enabled).toBe(false);
    expect(formatBenchSummary(path)).toBe(`Benchmark log: ${path}\nrecords: 0`);
  });

  test("writes enabled benchmark records without undefined fields", () => {
    const path = join(directory, "nested", "bench.jsonl");
    process.env.THUD_BENCH = "1";
    process.env.THUD_BENCH_LOG = path;
    const bench = createBenchRun("startup", { mode: "popup", ignored: undefined });

    bench.add({ firstRenderMs: 12.3 });
    bench.log({ ok: true });

    const record = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

    expect(record.event).toBe("startup");
    expect(record.mode).toBe("popup");
    expect(record.firstRenderMs).toBe(12.3);
    expect(record.ok).toBe(true);
    expect(record.ignored).toBeUndefined();
    expect(typeof record.totalMs).toBe("number");
    expect(typeof record.timestamp).toBe("string");
    expect(record.pid).toBe(process.pid);
  });

  test("benchAsync records elapsed time only when benchmarking is enabled", async () => {
    const disabledFields: Record<string, number> = {};

    await expect(benchAsync("workMs", disabledFields, async () => "result")).resolves.toBe(
      "result",
    );
    expect(disabledFields.workMs).toBeUndefined();

    process.env.THUD_BENCH = "true";
    const enabledFields: Record<string, number> = {};

    await expect(benchAsync("workMs", enabledFields, async () => "result")).resolves.toBe("result");
    expect(typeof enabledFields.workMs).toBe("number");
  });
});
