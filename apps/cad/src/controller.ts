import { type Session, type EditOp, type EditResult, type PreviewResult, type ViewFrame } from '@ck/session';
import type { PartDoc, SketchFeature, SketchSolverStatus } from '@ck/part-model';
import type { Store } from '@kit/store';
import { defaultFlip, foldSolution, fromFeature, toFeature, type SketchDraft } from '@kit/sketch';

/** The solved sketch a viewport draws while a sketch feature is open for editing. */
export interface SketchEditView {
  featureId: string;
  frame: ViewFrame;
  sketch: SketchFeature;
  status?: SketchSolverStatus;
}

/** Result of a speculative sketch drag: `stale` when a newer drag superseded it. */
export interface SketchPreview {
  ok: boolean;
  stale?: boolean;
  view?: SketchEditView;
  hint?: string;
  status?: SketchSolverStatus;
}

/** One edge as the kernel reports it: `key` is the persistent name the viewport selects by. */
export interface ViewEdge { key?: string; faces?: string[]; mid?: number[]; /** world-space polyline of the edge */ pts?: number[][] }

export interface ViewSink {
  setBody(b: unknown | null): void;
  setHighlight(n: string[]): void;
  setSketchEdit(v: SketchEditView | null): void;
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
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewSeq = 0;
  private previewWake: (() => void) | null = null;

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

  /** Speculative edit: shows the candidate body, leaves document and history untouched.
   *  Debounced ~150 ms; a newer preview supersedes an older one (stale:true, body dropped). */
  async preview(ops: EditOp[], delayMs = 150): Promise<PreviewResult & { hint?: string }> {
    const seq = ++this.previewSeq;
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewWake?.();
    await new Promise<void>((resolve) => {
      this.previewWake = resolve;
      this.previewTimer = setTimeout(() => { this.previewTimer = null; resolve(); }, delayMs);
    });
    this.previewWake = null;
    if (seq !== this.previewSeq) {
      return { ok: true, errors: [], hints: [], body: null, stale: true };
    }
    this.previewTimer = null;
    const s = this.session;
    if (!s) return { ok: false, errors: [], hints: [], body: null, schemaError: 'no document loaded' };
    const r = await s.preview(ops);
    if (seq !== this.previewSeq) {
      return { ok: true, errors: [], hints: [], body: null, stale: true };
    }
    if (r.stale) return r;
    if (r.ok && r.body) {
      this.view.setBody(r.body);
      return r;
    }
    const hint =
      r.hints?.map((h) => h.hint).join('; ') ||
      r.schemaError ||
      'preview failed';
    return { ...r, hint };
  }

  /** Drop a pending/committed preview: restore the last good body, no edit record. */
  async cancelPreview(): Promise<void> {
    this.previewSeq++;
    if (this.previewTimer) { clearTimeout(this.previewTimer); this.previewTimer = null; }
    this.previewWake?.();
    this.previewWake = null;
    const s = this.session;
    if (!s) return;
    const body = await s.bodyForView().catch(() => null);
    this.view.setBody(body);
  }

  /** Commit the editor draft as exactly one edit record (one batch). */
  async commit(ops: EditOp[], reason?: string): Promise<EditResult> {
    this.previewSeq++;
    if (this.previewTimer) { clearTimeout(this.previewTimer); this.previewTimer = null; }
    this.previewWake?.();
    this.previewWake = null;
    return this.edit(ops, reason);
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

  // ---- sketch session (S1): open a sketch, drag with the solver, confirm/cancel ----

  private sketchOpen: { featureId: string; upTo: number; draft: SketchDraft; baselineDof: number | null; isNew: boolean; undo: SketchDraft[]; status: SketchSolverStatus | null } | null = null;
  private sketchTimer: ReturnType<typeof setTimeout> | null = null;
  private sketchWake: (() => void) | null = null;
  private sketchSeq = 0;
  /** The preview now running in the kernel worker. The worker runs every request it is sent, so a newer
   *  drag must wait for this one instead of queueing behind it: only the latest waiting drag ever runs. */
  private sketchInflight: Promise<unknown> | null = null;

  /** Open a sketch feature for editing: solve it as of its place in the tree (the
   *  features after it are cut off with `upTo`) and hand the viewport the solved
   *  sketch and its plane frame. Returns null when the feature is missing or not a
   *  sketch. The document, the edit stack and the displayed body are untouched. */
  async beginSketch(featureId: string): Promise<SketchEditView | null> {
    const s = this.session;
    if (!s) return null;
    const features = s.document.features;
    const index = features.findIndex((f) => f.id === featureId);
    if (index < 0) return null;
    const feature = features[index] as unknown as Record<string, unknown>;
    if (feature.type !== 'sketch') return null;
    const draft = fromFeature(feature);
    this.sketchOpen = { featureId, upTo: index + 1, draft, baselineDof: null, isNew: false, undo: [], status: null };
    this.sketchSeq++;
    const res = await this.previewSketch(draft, index + 1, false);
    if (!res.ok || !res.view) { this.sketchOpen = null; return null; }
    this.sketchOpen.baselineDof = res.status?.dof ?? null;
    this.sketchOpen.status = res.status ?? null;
    this.showSketch(res.view);
    return res.view;
  }

  /** Start a new, empty sketch on a standard plane at the end of the tree. Nothing is written until
   *  commitSketch: cancelling leaves the document exactly as it was. */
  async beginNewSketch(plane: 'front' | 'top' | 'right' | { kind: 'face' | 'feature'; id: string } = 'front'): Promise<SketchEditView | null> {
    const s = this.session;
    if (!s) return null;
    const id = `F${s.document.seq}`;
    const draft = fromFeature({
      type: 'sketch', id, name: 'Sketch', plane: typeof plane === 'string' ? { kind: 'std', id: plane } : plane,
      points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [],
    });
    const upTo = s.document.features.length + 1;
    this.sketchOpen = { featureId: id, upTo, draft, baselineDof: null, isNew: true, undo: [], status: null };
    this.sketchSeq++;
    const res = await this.previewSketch(draft, upTo, true);
    if (!res.ok || !res.view) { this.sketchOpen = null; return null; }
    this.sketchOpen.baselineDof = res.status?.dof ?? null;
    this.sketchOpen.status = res.status ?? null;
    this.showSketch(res.view);
    return res.view;
  }

  /** A sketch tool produced a new draft: it becomes the draft at once (so the next tool step builds on it),
   *  the previous one goes on the sketch's own undo stack, and the kernel solves and previews it. */
  async applySketchDraft(draft: SketchDraft): Promise<SketchPreview> {
    const open = this.sketchOpen;
    if (!open) return { ok: false, hint: 'no sketch open' };
    open.undo.push(open.draft);
    open.draft = draft;
    return this.updateSketch(draft, 0);
  }

  /** Undo the last tool edit in the open sketch. False when there is nothing to undo. */
  async undoSketch(): Promise<boolean> {
    const open = this.sketchOpen;
    const prev = open?.undo.pop();
    if (!open || !prev) return false;
    open.draft = prev;
    await this.updateSketch(prev, 0);
    return true;
  }

  /** Drag a point: preview the pinned draft on the sketch's own partial regen.
   *  Debounced ~100 ms; a newer drag supersedes an older one (stale:true, no view).
   *  On failure the previous good sketch stays on screen and `hint` says why. */
  async updateSketch(draft: SketchDraft, delayMs = 100): Promise<SketchPreview> {
    const seq = ++this.sketchSeq;
    if (this.sketchTimer) clearTimeout(this.sketchTimer);
    this.sketchWake?.();
    let wake: () => void = () => {};
    await new Promise<void>((resolve) => {
      wake = resolve;
      this.sketchWake = resolve;
      this.sketchTimer = setTimeout(() => { this.sketchTimer = null; resolve(); }, delayMs);
    });
    if (this.sketchWake === wake) this.sketchWake = null;
    if (seq !== this.sketchSeq) return { ok: true, stale: true };
    this.sketchTimer = null;
    const open = this.sketchOpen;
    if (!open) return { ok: false, hint: 'no sketch open' };
    while (this.sketchInflight) {
      await this.sketchInflight.catch(() => {});
      if (seq !== this.sketchSeq) return { ok: true, stale: true };
    }
    const running = this.previewSketch(draft, open.upTo, open.isNew);
    this.sketchInflight = running;
    let res: Awaited<typeof running>;
    try { res = await running; } finally { if (this.sketchInflight === running) this.sketchInflight = null; }
    if (seq !== this.sketchSeq) return { ok: true, stale: true };
    // A drag the solver could not absorb comes back as a successful regen that
    // echoes the sketch unsolved (status.solved false): refuse it, keep the
    // last good solved sketch on screen (the point snaps back).
    if (draft.temp.length && res.status && res.status.solved === false) {
      const hint = open.baselineDof === 0 ? 'app.sketch.fullyDefined' : 'app.sketch.conflict';
      open.status = res.status ?? open.status;
      return { ok: false, hint, status: res.status };
    }
    if (res.ok && res.view) {
      open.status = res.status ?? null;
      // Fold the solver's result into the draft: regen only re-solves on expr
      // changes, so the committed sketch must carry the solved coordinates.
      open.draft = foldSolution(draft, res.view.sketch);
      this.showSketch(res.view);
      return { ok: true, view: res.view, status: res.status };
    }
    return { ok: false, hint: res.hint, status: res.status };
  }

  /** Commit the open sketch as exactly one replace edit (the temporary drag fix is
   *  dropped) and close the sketch overlay. Null when no sketch is open. */
  async commitSketch(): Promise<EditResult | null> {
    const open = this.sketchOpen;
    if (!open) return null;
    this.sketchOpen = null;
    this.closeSketchPreview();
    this.view.setSketchEdit(null);
    const feature = toFeature(open.draft);
    return this.edit([open.isNew ? { op: 'add', feature } : { op: 'replace', id: open.featureId, feature }], open.isNew ? 'new sketch' : 'sketch');
  }

  private sketchFrameNow: ViewFrame | null = null;
  private showSketch(v: SketchEditView): void {
    this.sketchFrameNow = v.frame;
    this.view.setSketchEdit(v);
  }

  /** The plane frame of the open sketch (null when none is open). */
  sketchFrame(): ViewFrame | null {
    return this.sketchOpen ? this.sketchFrameNow : null;
  }

  /** The solver's verdict on the open sketch (degrees of freedom, conflicts), from the last preview. */
  sketchStatus(): SketchSolverStatus | null {
    return this.sketchOpen?.status ?? null;
  }

  /** The draft being edited in the open sketch session (null when none). The
   *  shell drags on top of this so folds from earlier drags are kept. */
  sketchDraft(): SketchDraft | null {
    return this.sketchOpen?.draft ?? null;
  }

  /** Close the sketch overlay without writing anything. */
  async cancelSketch(): Promise<void> {
    this.sketchOpen = null;
    this.closeSketchPreview();
    this.view.setSketchEdit(null);
  }

  private closeSketchPreview(): void {
    this.sketchSeq++;
    if (this.sketchTimer) { clearTimeout(this.sketchTimer); this.sketchTimer = null; }
    this.sketchWake?.();
    this.sketchWake = null;
  }

  /** Speculative regen of the sketch on its partial upTo tag; no document write. */
  private async previewSketch(draft: SketchDraft, upTo: number, isNew = false): Promise<{ ok: boolean; view?: SketchEditView; hint?: string; status?: SketchSolverStatus }> {
    const s = this.session;
    if (!s) return { ok: false, hint: 'no document loaded' };
    const feature = toFeature(draft, { includeTemp: true });
    const r = await s.preview([isNew ? { op: 'add', feature } : { op: 'replace', id: draft.id, feature }], { upTo, solveSketches: true });
    // a prefix with no solid yet (a first sketch) has no body but still carries its sketches
    const sketches = r.body?.sketches ?? r.sketches;
    if (r.ok && sketches) {
      const entry = sketches.find((x) => x.id === draft.id);
      if (entry) return { ok: true, view: { featureId: draft.id, frame: entry.frame, sketch: entry.sketch, status: entry.status }, status: entry.status };
      return { ok: false, hint: 'sketch missing from the regen reply' };
    }
    const hint = r.hints?.map((h) => h.hint).join('; ') || r.schemaError || 'sketch did not solve';
    return { ok: false, hint };
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

  /** The last body handed to the viewer (its box and sketch frames), for choosing sensible defaults. */
  private lastView: { box: { min: number[]; max: number[] }; sketches: Array<{ id: string; frame: { o: number[]; z: number[] } }>; edges?: ViewEdge[] } | null = null;

  /** The bounding box of the body on screen (null when there is none). */
  bodyBox(): { min: number[]; max: number[] } | null {
    return this.lastView?.box ?? null;
  }

  /** The edges of the body on screen: persistent key, the two faces they separate, and a point on each. */
  bodyEdges(): ViewEdge[] {
    return this.lastView?.edges ?? [];
  }

  /** Whether a new extrude of this sketch should be flipped so a cut goes into the material. */
  extrudeFlip(sketchId: string, op: 'add' | 'cut'): boolean {
    const v = this.lastView;
    const frame = v?.sketches.find((x) => x.id === sketchId)?.frame ?? null;
    return defaultFlip(op, frame, v?.box ?? null);
  }

  private async refresh(): Promise<void> {
    const s = this.session;
    if (!s) return;
    const body = await s.bodyForView();
    this.lastView = body;
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
