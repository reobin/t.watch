import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const defaultBenchLogPath = "/tmp/thud-sh-bench.jsonl";
const summaryMetrics = [
  "totalMs",
  "firstRenderMs",
  "rendererMs",
  "themeMs",
  "tmuxCheckMs",
  "refreshSessionsMs",
  "listSessionsMs",
  "listSessionsCommandMs",
  "listWindowsMs",
  "listPanesMs",
  "listClientsMs",
  "psMs",
  "processTreeMs",
  "gitMetadataMs",
  "watcherMs",
] as const;

type BenchValue = string | number | boolean | null | undefined;
type BenchFields = Record<string, BenchValue>;

type BenchRun = {
  readonly enabled: boolean;
  readonly startedAt: number;
  add(fields: BenchFields): void;
  elapsed(): number;
  log(fields?: BenchFields): void;
};

type BenchRecord = Record<string, unknown>;

function isBenchEnabled(): boolean {
  return process.env.THUD_BENCH === "1" || process.env.THUD_BENCH === "true";
}

function benchLogPath(): string {
  return process.env.THUD_BENCH_LOG || defaultBenchLogPath;
}

export function benchNow(): number {
  return performance.now();
}

export function createBenchRun(event: string, fields: BenchFields = {}): BenchRun {
  const enabled = isBenchEnabled();
  const startedAt = benchNow();
  const record: BenchFields = { event, ...fields };

  return {
    enabled,
    startedAt,
    add(nextFields) {
      if (!enabled) {
        return;
      }

      Object.assign(record, nextFields);
    },
    elapsed() {
      return elapsedMs(startedAt);
    },
    log(nextFields = {}) {
      if (!enabled) {
        return;
      }

      writeBenchRecord({ ...record, ...nextFields, totalMs: elapsedMs(startedAt) });
    },
  };
}

export async function benchAsync<T>(
  name: string,
  fields: BenchFields,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isBenchEnabled()) {
    return fn();
  }

  const startedAt = benchNow();

  try {
    return await fn();
  } finally {
    fields[name] = elapsedMs(startedAt);
  }
}

export function elapsedMs(startedAt: number): number {
  return Math.round((benchNow() - startedAt) * 10) / 10;
}

function writeBenchRecord(fields: BenchFields): void {
  if (!isBenchEnabled()) {
    return;
  }

  const path = benchLogPath();

  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(cleanFields(fields))}\n`, "utf8");
  } catch {}
}

export function formatBenchSummary(path = benchLogPath()): string {
  const records = readBenchRecords(path);

  if (records.length === 0) {
    return `Benchmark log: ${path}\nrecords: 0`;
  }

  const lines = [`Benchmark log: ${path}`, `records: ${records.length}`];

  for (const metric of summaryMetrics) {
    const values = records
      .map((record) => record[metric])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .sort((left, right) => left - right);

    if (values.length === 0) {
      continue;
    }

    lines.push(
      `${metric}: count=${values.length} min=${formatMs(values[0])} p50=${formatMs(
        percentile(values, 0.5),
      )} p95=${formatMs(percentile(values, 0.95))} max=${formatMs(values.at(-1) ?? values[0])}`,
    );
  }

  return lines.join("\n");
}

function readBenchRecords(path: string): BenchRecord[] {
  let content: string;

  try {
    content = readFileSync(path, "utf8");
  } catch {
    return [];
  }

  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => parseBenchRecord(line))
    .filter((record): record is BenchRecord => Boolean(record));
}

function parseBenchRecord(line: string): BenchRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(line);

    return parsed && typeof parsed === "object" ? (parsed as BenchRecord) : undefined;
  } catch {
    return undefined;
  }
}

function cleanFields(fields: BenchFields): BenchRecord {
  const record: BenchRecord = {
    timestamp: new Date().toISOString(),
    pid: process.pid,
  };

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      record[key] = value;
    }
  }

  return record;
}

function percentile(values: number[], percentileValue: number): number {
  const index = Math.min(values.length - 1, Math.ceil(values.length * percentileValue) - 1);

  return values[Math.max(0, index)] ?? 0;
}

function formatMs(value: number): string {
  return `${Math.round(value * 10) / 10}ms`;
}
