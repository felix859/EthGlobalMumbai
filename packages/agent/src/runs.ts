// In-memory registry of runs for the HTTP API. Each run keeps its full event list, so an SSE client that connects
// late (or reconnects) still sees the whole run from `started`. Finished runs are forgotten after `keepMs`.
import { randomUUID } from "node:crypto";
import type { RunEvent } from "@pennyagent/shared";

type Listener = (e: RunEvent) => void;

interface Run {
  events: RunEvent[];
  listeners: Set<Listener>;
  /** Called once the run has finished, so open streams can end. */
  doneListeners: Set<() => void>;
  done: boolean;
}

export class RunHub {
  private runs = new Map<string, Run>();

  constructor(private readonly keepMs = 15 * 60_000) {}

  create(id: string = randomUUID()): string {
    this.runs.set(id, { events: [], listeners: new Set(), doneListeners: new Set(), done: false });
    return id;
  }

  has = (id: string) => this.runs.has(id);

  /** Runs that have not finished yet. */
  get active() {
    let n = 0;
    for (const r of this.runs.values()) if (!r.done) n++;
    return n;
  }

  emit(id: string, e: RunEvent) {
    const r = this.runs.get(id);
    if (!r || r.done) return;
    r.events.push(e);
    for (const l of r.listeners) l(e);
  }

  /** Marks the run finished (its promise settled). Late events (e.g. a slow audit) are dropped after this. */
  finish(id: string) {
    const r = this.runs.get(id);
    if (!r || r.done) return;
    r.done = true;
    for (const l of r.doneListeners) l();
    r.listeners.clear();
    r.doneListeners.clear();
    setTimeout(() => this.runs.delete(id), this.keepMs).unref();
  }

  /**
   * Replays past events to `onEvent`, then streams new ones. `onDone` fires when the run finishes (immediately, after
   * the replay, if it already has). Returns an unsubscribe function, or null for an unknown run.
   */
  subscribe(id: string, onEvent: Listener, onDone: () => void): (() => void) | null {
    const r = this.runs.get(id);
    if (!r) return null;
    for (const e of r.events) onEvent(e);
    if (r.done) {
      onDone();
      return () => {};
    }
    r.listeners.add(onEvent);
    r.doneListeners.add(onDone);
    return () => {
      r.listeners.delete(onEvent);
      r.doneListeners.delete(onDone);
    };
  }
}
