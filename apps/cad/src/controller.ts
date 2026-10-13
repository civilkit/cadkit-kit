import { type Session, type EditOp, type EditResult } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import type { Store } from '@kit/store';

export interface ViewSink {
  setBody(b: unknown | null): void;
  setHighlight(n: string[]): void;
}

export interface KernelFactory {
  open(doc: PartDoc): Promise<Session>;
  cancel?(): void;
}

export class Controller {
  private readonly store: Store;
  private readonly view: ViewSink;
  private readonly kernel: KernelFactory;
  private session: Session | null = null;
  private lastGood: PartDoc | null = null;
  private pendingCancel: (() => void) | null = null;
  private redoStack: EditOp[][] = [];

  constructor(deps: { store: Store; view: ViewSink; kernel: KernelFactory }) {
    this.store = deps.store;
    this.view = deps.view;
    this.kernel = deps.kernel;
  }

  async load(doc: PartDoc): Promise<void> {
    this.store.busy.value = true;
    try {
      this.session = await this.kernel.open(doc);
      await this.refresh();
    } finally {
      this.store.busy.value = false;
    }
  }

  async edit(ops: EditOp[], reason?: string): Promise<EditResult> {
    const s = this.session;
    if (!s) throw new Error('no document loaded');
    this.store.busy.value = true;
    try {
      let result: EditResult;
      try {
        result = await Promise.race([
          s.edit(ops, reason),
          new Promise<never>((_, reject) => {
            this.pendingCancel = () => reject(new Error('cancelled'));
          }),
        ]);
      } catch (e) {
        if ((e as Error).message === 'cancelled') {
          return { ok: false, record: null, hints: [{ feature: '', code: 'cancelled', hint: 'regen cancelled' }] };
        }
        throw e;
      } finally {
        this.pendingCancel = null;
      }
      if (!result.ok) {
        const text =
          result.hints?.map((h) => h.hint).join('; ') ||
          result.schemaError ||
          'edit failed';
        this.store.notify(text, 'error');
        return result;
      }
      this.redoStack = [];
      await this.refresh();
      for (const w of result.refWarnings ?? []) {
        this.store.notify(
          `refDiff ${w.code}${w.feature ? ` on ${w.feature}` : ''}${w.reason ? `: ${w.reason}` : ''}`,
          'warn',
        );
      }
      return result;
    } finally {
      this.store.busy.value = false;
    }
  }

  async undo(): Promise<void> {
    const s = this.session;
    if (!s) return;
    this.store.busy.value = true;
    try {
      const { records } = await s.undo();
      // Session has no forward stack: replay these ops to redo.
      for (const rec of records) this.redoStack.push(rec.ops);
      await this.refresh();
    } finally {
      this.store.busy.value = false;
    }
  }

  async redo(): Promise<void> {
    const ops = this.redoStack.pop();
    if (!ops || !this.session) return;
    // edit() clears the redo stack on success; keep the remaining entries.
    const rest = this.redoStack;
    try {
      await this.edit(ops, 'redo');
    } finally {
      this.redoStack = rest;
    }
  }

  document(): PartDoc | null {
    return this.session?.document ?? null;
  }

  features(): Array<{ id: string; type: string; name?: string }> {
    return this.session
      ? this.session.document.features.map((f) => ({ id: f.id, type: f.type, name: f.name }))
      : [];
  }

  async cancel(): Promise<void> {
    this.pendingCancel?.();
    this.pendingCancel = null;
    this.kernel.cancel?.();
    if (!this.session) return;
    this.store.busy.value = true;
    try {
      this.session = await this.kernel.open(this.lastGood ?? this.session.document);
      await this.refresh();
    } finally {
      this.store.busy.value = false;
    }
  }

  private async refresh(): Promise<void> {
    const s = this.session;
    if (!s) return;
    const body = await s.bodyForView();
    this.view.setBody(body);
    this.store.dropMissing(new Set(body?.mesh.faceIds ?? []));
    const report = await s.verify();
    const errors = new Map(report.regen.errors);
    this.store.featureStatus.value = s.document.features.map((f) => {
      const err = errors.get(f.id);
      if (!err) return { id: f.id, ok: true };
      const hint = report.hints.find((h) => h.feature === f.id && h.code === err.code);
      return { id: f.id, ok: false, code: err.code, hint: hint?.hint };
    });
    this.lastGood = s.document;
  }
}
