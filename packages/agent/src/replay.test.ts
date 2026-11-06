import { describe, it, expect } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunEvent } from "@pennyagent/shared";
import { latestRecording, loadRecording, recordRun, replayRun, type Recording } from "./replay.js";

const rec = (): Recording => ({
  version: 1, recordedAt: "x",
  events: [
    { t: 0, event: { type: "started", runId: "r", budgetTinybars: "1" } },
    { t: 100, event: { type: "thinking", text: "hi" } },
    { t: 10_000, event: { type: "answer", text: "done" } },
  ],
});

describe("replayRun", () => {
  it("emits events in order and caps long gaps", async () => {
    const out: RunEvent[] = [], sleeps: number[] = [];
    await replayRun(rec(), (e) => out.push(e), { sleep: async (ms) => void sleeps.push(ms), maxGapMs: 1500 });
    expect(out.map((e) => e.type)).toEqual(["started", "thinking", "answer"]);
    expect(sleeps).toEqual([100, 1500]);
  });
  it("speed multiplier shortens delays", async () => {
    const sleeps: number[] = [];
    await replayRun(rec(), () => {}, { sleep: async (ms) => void sleeps.push(ms), speed: 2, maxGapMs: 1500 });
    expect(sleeps).toEqual([50, 750]);
  });
});

describe("recordRun", () => {
  it("forwards events, and saves a loadable file when the answer arrives", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pa-"));
    const out: RunEvent[] = [];
    const r = recordRun((e) => out.push(e), { dir, question: "q" });
    r.emit({ type: "started", runId: "r", budgetTinybars: "1" });
    r.emit({ type: "answer", text: "ok" });
    const file = await r.save();
    expect(out).toHaveLength(2);
    const loaded = await loadRecording(file);
    expect(loaded.question).toBe("q");
    expect(loaded.events.map((x) => x.event.type)).toEqual(["started", "answer"]);
    expect(await readdir(dir)).toHaveLength(1);
  });
  it("latestRecording picks the newest run, and nothing when empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pa-"));
    expect(await latestRecording(dir)).toBeUndefined();
    const r = recordRun(() => {}, { dir });
    r.emit({ type: "answer", text: "ok" });
    await r.save();
    expect((await latestRecording(dir))?.events).toHaveLength(1);
  });
  it("the committed sample fixture is a valid recording", async () => {
    const sample = await loadRecording(join(process.cwd(), "runs", "sample.json"));
    expect(sample.events.at(-1)?.event.type).toBe("answer");
  });
});
