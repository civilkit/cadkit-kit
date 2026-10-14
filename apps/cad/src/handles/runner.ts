// Connects a HandleSession to the controller: every drag step previews (latest wins, one preview in flight at a time, the
// same gate the sketch drags use), release commits as ONE edit, Esc puts the last good body back.
import type { EditOp } from '@ck/session';
import type { HandleDragSink, Vec3 } from '@kit/viewport';
import type { HandleCommit, HandleSession } from './session';

export interface RunnerDeps {
  /** Show the ops without committing (Controller.preview, no extra debounce: this class gates). Resolves with a hint when it failed. */
  preview(ops: EditOp[]): Promise<{ ok: boolean; stale?: boolean; hint?: string } | void>;
  /** Drop the speculative body (Controller.cancelPreview). */
  cancelPreview(): Promise<void>;
  /** Make the edit; `create` means the app opens the Editor on the new feature. */
  commit(c: HandleCommit): Promise<void>;
  /** The reason the last preview failed, or null once one worked. */
  hint?(text: string | null): void;
  /** A drag started / ended (the app can pause other work). */
  busy?(on: boolean): void;
}

export class HandleRunner {
  private pending: EditOp[] | null | undefined = undefined;
  private inflight: Promise<void> | null = null;
  private shown = false;

  constructor(private readonly deps: RunnerDeps) {}

  /** The viewport-side sink for a session. */
  sink(s: HandleSession): HandleDragSink {
    return {
      onStart: () => { this.deps.busy?.(true); },
      onDrag: (id, q, vec) => this.drag(s.preview(id, q, vec)),
      onCommit: (id, q, vec) => { void this.commit(s.commit(id, q, vec)); },
      onCancel: () => { void this.cancel(); },
      format: s.format ? (id, q) => s.format!(id, q) : undefined,
      step: s.step ? (id) => s.step!(id) : undefined,
      live: s.live ? (id, q, vec) => s.live!(id, q, vec) : undefined,
    };
  }

  drag(ops: EditOp[] | null): void {
    this.pending = ops;
    this.pump();
  }

  private pump(): void {
    if (this.inflight) return;
    this.inflight = (async () => {
      while (this.pending !== undefined) {
        const ops = this.pending;
        this.pending = undefined;
        if (ops === null) {
          if (this.shown) { this.shown = false; await this.deps.cancelPreview(); }
          this.deps.hint?.(null);
          continue;
        }
        const r = await this.deps.preview(ops).catch(() => undefined);
        this.shown = true;
        if (r && !r.stale) this.deps.hint?.(r.ok ? null : (r.hint ?? null));
      }
    })().finally(() => { this.inflight = null; });
  }

  /** Wait for the preview now running; steps queued behind it are dropped. */
  private async settle(): Promise<void> {
    this.pending = undefined;
    while (this.inflight) await this.inflight;
  }

  async commit(c: HandleCommit | null): Promise<void> {
    await this.settle();
    this.deps.hint?.(null);
    try {
      if (c) await this.deps.commit(c);
      else if (this.shown) await this.deps.cancelPreview();
    } finally {
      this.shown = false;
      this.deps.busy?.(false);
    }
  }

  async cancel(): Promise<void> {
    await this.settle();
    this.deps.hint?.(null);
    try { if (this.shown) await this.deps.cancelPreview(); } finally { this.shown = false; this.deps.busy?.(false); }
  }
}

export type { Vec3 };
