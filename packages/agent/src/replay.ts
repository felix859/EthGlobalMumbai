// Demo safety net: record every real run's events, replay them later through the same `emit`
// interface. If testnet or the facilitator breaks while judges watch, the UI still has a run to show.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunEvent } from "@pennyagent/shared";

export interface TimedEvent {
  /** milliseconds since the run started */
  t: number;
  event: RunEvent;
}
export interface Recording {
  version: 1;
  recordedAt: string;
  question?: string;
  events: TimedEvent[];
  /** Set on hand-made fixtures. */
  _note?: string;
}

export const recordDir = () => process.env.RECORD_DIR ?? "runs";

/** Wraps an `emit`: forwards every event unchanged and saves the run when it finishes. */
export function recordRun(emit: (e: RunEvent) => void, opts: { question?: string; dir?: string } = {}) {
  const start = Date.now();
  const events: TimedEvent[] = [];
  let saved: Promise<string> | undefined;
  const save = (): Promise<string> =>
    (saved ??= (async () => {
      const dir = opts.dir ?? recordDir();
      await mkdir(dir, { recursive: true });
      const file = join(dir, `run-${new Date(start).toISOString().replace(/[:.]/g, "-")}.json`);
      const rec: Recording = { version: 1, recordedAt: new Date(start).toISOString(), question: opts.question, events };
      await writeFile(file, JSON.stringify(rec, null, 2));
      return file;
    })());
  return {
    emit(e: RunEvent) {
      events.push({ t: Date.now() - start, event: e });
      emit(e);
      // Only successful runs are worth replaying; errors are not.
      if (e.type === "answer") void save().catch(() => {});
    },
    save,
  };
}

export async function loadRecording(file: string): Promise<Recording> {
  const rec = JSON.parse(await readFile(file, "utf8")) as Recording;
  if (rec.version !== 1 || !Array.isArray(rec.events)) throw new Error(`Not a PennyAgent recording: ${file}`);
  return rec;
}

/** Newest saved recording in `dir`, falling back to sample.json. Returns undefined if there is none. */
export async function latestRecording(dir = recordDir()): Promise<Recording | undefined> {
  const files = await readdir(dir).catch(() => [] as string[]);
  const runs = files.filter((f) => /^run-.*\.json$/.test(f)).sort();
  const pick = runs.at(-1) ?? (files.includes("sample.json") ? "sample.json" : undefined);
  return pick ? loadRecording(join(dir, pick)) : undefined;
}

/** Plays a recording back through `emit`, preserving order and (capped) timing. */
export async function replayRun(
  rec: Recording,
  emit: (e: RunEvent) => void,
  opts: { speed?: number; maxGapMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const speed = opts.speed ?? 1;
  const maxGap = opts.maxGapMs ?? 1500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let prev = 0;
  for (const { t, event } of rec.events) {
    const gap = Math.min(Math.max(t - prev, 0), maxGap) / speed;
    if (gap > 0) await sleep(gap);
    prev = t;
    emit(event);
  }
}
