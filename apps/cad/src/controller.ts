import { type Session, type EditOp, type EditResult, type PreviewResult, type ViewFrame } from '@ck/session';
import type { PartDoc, SketchFeature, SketchSolverStatus } from '@ck/part-model';
import { vertexName, BODY, type Store } from '@kit/store';
import { blockedIssues, blockMessage, type Issue, type ProfileList, type ProfileReport } from './designCheck';
import type { CheckPolicy } from './checkSettings';
import { importStepView, type StepImportResult } from './files/stepImport';
import { applyOpsLocal, saveThreadPrefs, warningsById, type ThreadRow, type ThreadStd } from './threadData';
import { queryInterference, queryMass, queryMeasure, type Interference } from './inspect/kernel';
import type { KernelMeasure } from './inspect/measure';
import type { MassRaw } from './inspect/mass';
import { deleteOps, repairAnchor, rollbackCount as countOf, withRollbackInsert } from './treeActions';
import { fetchSurfaces, hasSurfaceFeatures, mergedView, surfaceNames, withSurfaces } from './surfaceView';
import type { ViewSurface } from '@kit/viewport';
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
  setThreads?(items: unknown[]): void;
  /** Light up the length range of the thread being edited (null clears it). */
  setThreadFocus?(id: string | null): void;
}

/** What the viewer is handed: the solid's view body plus the surface bodies. */
export type ShownBody = NonNullable<Awaited<ReturnType<Session['bodyForView']>>> & { surfaces?: ViewSurface[] };

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
  /** Rollback marker: id of the last feature that is on (`''` none, null = all). View only: the session has no op that sets the document's `rollback`. */
  private rollbackAnchor: string | null = null;
  private lastIds: string[] = [];
  /** A part name set in the app (the session cannot rename the document); applied to what `document()` returns. */
  private docName: string | null = null;

  constructor(deps: { store: Store; view: ViewSink; kernel: KernelFactory }) {
    this.store = deps.store;
    this.view = deps.view;
    this.kernel = deps.kernel;
  }

  async load(doc: PartDoc): Promise<void> {
    this.store.busy.value = true;
    try {
      this.session = await this.kernel.open(doc);
      this.rollbackAnchor = null; this.lastIds = []; this.docName = null;
      await this.refresh();
    } finally {
      this.store.busy.value = false;
    }
  }

  async edit(ops: EditOp[], reason?: string): Promise<EditResult> {
    const s = this.session;
    if (!s) throw new Error('no document loaded');
    const guarded = !this.unguarded;
    this.unguarded = false;
    const policy = guarded ? this.policy?.() ?? null : null;
    const blocking = policy && policy.blocking.length > 0 ? policy : null;
    // while rolled back, new features go in right after the marker
    const at = this.rollbackCount();
    const adds = ops.filter((o) => o.op === 'add' && o.index === undefined).length;
    ops = withRollbackInsert(ops, at);
    this.store.busy.value = true;
    try {
      let result: EditResult;
      // Block rules compare against the part as it is now: the last check of this state, or one made first.
      const before = blocking ? await this.baselineFor(blocking) : null;
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
      // the marker moves past what was just inserted
      if (at !== null && adds) this.rollbackAnchor = s.document.features[at + adds - 1]?.id ?? this.rollbackAnchor;
      await this.refresh();
      if (blocking && before) {
        const blocked = await this.blockCheck(blocking, before);
        if (blocked) {
          // Same path as a failed edit: the part goes back, the history has no record, the shell logs a rejection.
          await s.undo();
          await this.refresh();
          this.store.notify(blocked, 'error');
          return { ok: false, record: null, hints: [{ feature: '', code: 'designCheckBlocked', hint: blocked }] };
        }
      } else if (policy?.afterEdit) this.scheduleAfterEdit();
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
    const upTo = this.rollbackCount();
    const r = await s.preview(ops, upTo === null ? undefined : { upTo });
    if (seq !== this.previewSeq) {
      return { ok: true, errors: [], hints: [], body: null, stale: true };
    }
    if (r.stale) return r;
    if (r.ok && r.body) {
      // the candidate's features, worked out here (an op it cannot apply, like a move, falls back to the committed ones)
      const cand = applyOpsLocal(s.document.features as unknown as Array<Record<string, unknown>>, ops) ?? s.document.features;
      const surfaces = await this.surfacesFor(s, { ...s.document, features: cand } as unknown as PartDoc, upTo, '-psurf');
      if (seq !== this.previewSeq) return { ok: true, errors: [], hints: [], body: null, stale: true };
      this.view.setBody(withSurfaces(r.body, surfaces));
      await this.previewExtras(s, ops, seq);
      return r;
    }
    const hint =
      r.hints?.map((h) => h.hint).join('; ') ||
      r.schemaError ||
      'preview failed';
    return { ...r, hint };
  }

  /**
   * Warnings and cosmetic threads of a regen. The Session reports only `errors` today (verify() and preview() drop the
   * rest of the regen reply), so when the document has a thread feature this asks the kernel for the reply itself; with a
   * Session that passes `threads` / `warnings` through, `report.regen` already has them and no request is made.
   */
  private async regenExtras(s: Session, doc: PartDoc, tag: string, from?: { threads?: unknown[]; warnings?: unknown[] }): Promise<{ threads: unknown[]; warnings: unknown[] }> {
    if (from && (from.threads || from.warnings)) return { threads: from.threads ?? [], warnings: from.warnings ?? [] };
    if (!doc.features.some((f) => (f as { type?: string }).type === 'thread')) return { threads: [], warnings: [] };
    try {
      const k = (s as unknown as { kernel?: { request(m: unknown): Promise<{ ok?: boolean; result?: unknown }> } }).kernel;
      const modeled = doc.features.some((f) => (f as { type?: string; modeled?: unknown }).type === 'thread' && (f as { modeled?: unknown }).modeled === true);
      const t0 = Date.now();
      const r = await k?.request({ type: 'regen', tag, part: doc });
      if (modeled && r?.ok) saveThreadPrefs({ modeledMs: Date.now() - t0 });   // remembered: the editor's "about N s to rebuild" note
      const res = (r?.ok ? r.result : null) as { threads?: unknown[]; warnings?: unknown[] } | null;
      return { threads: res?.threads ?? [], warnings: res?.warnings ?? [] };
    } catch { return { threads: [], warnings: [] }; }
  }
  private committedExtras: { threads: unknown[]; warnings: unknown[] } = { threads: [], warnings: [] };
  private shownThreads: unknown[] = [];
  private applyExtras(x: { threads: unknown[]; warnings: unknown[] }): void {
    this.shownThreads = x.threads;
    this.view.setThreads?.(x.threads);
    this.store.featureWarnings.value = warningsById(x.warnings);
  }
  /** After a preview of an edit that touches a thread: the warnings and markers of the candidate (restored by cancelPreview / the next refresh). */
  private async previewExtras(s: Session, ops: EditOp[], seq: number): Promise<void> {
    const feats = applyOpsLocal(s.document.features as unknown as Array<Record<string, unknown>>, ops);
    const hasThread = (feats ?? []).some((f) => f.type === 'thread');
    if (feats && !hasThread && this.committedExtras.threads.length) { this.applyExtras({ threads: [], warnings: [] }); return; }   // the candidate removes the last thread
    if (!feats || !hasThread) { if (this.store.featureWarnings.value && Object.keys(this.store.featureWarnings.value).length) this.applyExtras(this.committedExtras); return; }
    const x = await this.regenExtras(s, { ...s.document, features: feats } as unknown as PartDoc, `${this.previewTagOf(s)}-x`);
    if (seq !== this.previewSeq) return;
    this.applyExtras(x);
  }
  private previewTagOf(s: Session): string { return (s as unknown as { tag?: string }).tag ?? 'main'; }

  private threadCache: { standards?: ThreadStd[]; sizes: Map<string, ThreadRow[]> } = { sizes: new Map() };
  /** The thread standards (cached: the tables never change within a kernel). Empty when there is no document. */
  async threadStandards(): Promise<ThreadStd[]> {
    if (this.threadCache.standards) return this.threadCache.standards;
    const s = this.session;
    if (!s) return [];
    const r = await s.threadData();
    this.threadCache.standards = (r.standards ?? []) as ThreadStd[];
    return this.threadCache.standards;
  }
  /** The sizes of one standard with all numbers (cached per standard). */
  async threadSizes(standard: string): Promise<ThreadRow[]> {
    const hit = this.threadCache.sizes.get(standard);
    if (hit) return hit;
    const s = this.session;
    if (!s) return [];
    const r = await s.threadData(standard);
    const rows = (r.sizes ?? []) as ThreadRow[];
    this.threadCache.sizes.set(standard, rows);
    return rows;
  }
  /** One size row, or null when the standard / size is unknown. */
  async threadRow(standard: string, size: string): Promise<ThreadRow | null> {
    return (await this.threadSizes(standard).catch(() => [])).find((r) => r.size === size) ?? null;
  }
  /** The markers and warnings of the last committed state, as the last refresh saw them. */
  threadsNow(): unknown[] { return this.committedExtras.threads; }
  /** The markers of what is on screen now: the committed ones, or the candidate of a preview in progress. */
  threadsShown(): unknown[] { return this.shownThreads; }

  /** Drop a pending/committed preview: restore the last good body, no edit record. */
  async cancelPreview(): Promise<void> {
    this.applyExtras(this.committedExtras);
    this.previewSeq++;
    if (this.previewTimer) { clearTimeout(this.previewTimer); this.previewTimer = null; }
    this.previewWake?.();
    this.previewWake = null;
    const s = this.session;
    if (!s) return;
    const body = await this.bodyNow(s).catch(() => null);
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
    const upTo = (this.rollbackCount() ?? s.document.features.length) + 1;
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
    this.skipGuardOnce();
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
    const r = await s.preview([isNew ? { op: 'add', feature, index: upTo - 1 } : { op: 'replace', id: draft.id, feature }], { upTo, solveSketches: true });
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
    const d = this.session?.document ?? null;
    return d && this.docName !== null ? { ...d, name: this.docName } : d;
  }

  /** Rename the part. The session has no document-level op, so the name lives here and is applied to `document()`
   *  (so Save and the top bar see it); it is not an undo step. */
  setPartName(name: string): void {
    const n = name.trim();
    if (this.session && n) this.docName = n;
  }

  /** How many features the rollback marker lets through (null = the whole model). */
  rollbackCount(): number | null {
    return countOf(this.rollbackAnchor, this.session?.document.features.map((f) => f.id) ?? []);
  }

  /** Move the rollback marker: show the model as it was after the first `count` features (null = roll forward to the end).
   *  The document and history are untouched; features after the marker are not built. */
  async setRollback(count: number | null): Promise<void> {
    const s = this.session;
    if (!s) return;
    const ids = s.document.features.map((f) => f.id);
    this.rollbackAnchor = count === null || count >= ids.length ? null : count <= 0 ? '' : ids[count - 1];
    this.store.busy.value = true;
    try { await this.refresh(); } finally { this.store.busy.value = false; }
  }

  /** Delete these features (those that depend on one of them go too only when they are selected as well; otherwise the
   *  session refuses and says what still uses it). */
  async deleteFeatures(ids: string[]): Promise<EditResult | null> {
    const s = this.session;
    if (!s || !ids.length) return null;
    const ops = deleteOps(s.document.features as unknown as Array<{ id: string }>, ids);
    return ops.length ? this.edit(ops, `delete ${ids.join(', ')}`) : null;
  }

  /** Build everything again from the document. (The kernel keeps no regen cache, so every build is already a full one.) */
  async rebuild(): Promise<void> {
    if (!this.session) return;
    this.store.busy.value = true;
    try { await this.refresh(); } finally { this.store.busy.value = false; }
  }

  /** Names of every face, edge or corner on screen, for Select all. */
  pickableNames(mode: 'face' | 'edge' | 'vertex'): string[] {
    const v = this.lastView;
    if (!v) return [];
    if (mode === 'face') return [...new Set<string>((v as unknown as { mesh?: { faceIds?: string[] } }).mesh?.faceIds ?? [])];
    const edges = v.edges ?? [];
    if (mode === 'edge') return edges.flatMap((e) => (e.key ? [e.key] : []));
    const out = new Set<string>();
    for (const e of edges) for (const p of [e.pts?.[0], e.pts?.[e.pts.length - 1]]) if (p) out.add(vertexName(p));
    return [...out];
  }

  /** Show the solid of a STEP file in the viewport (view only: it is not a feature of the part and the next edit replaces it). */
  async importStep(text: string, name: string): Promise<StepImportResult> {
    if (!this.session) return { ok: false, code: 'noSession', message: 'no document loaded' };
    this.store.busy.value = true;
    try {
      const r = await importStepView(this.session, text, name);
      if (r.ok) this.view.setBody(r.view);
      return r;
    } finally { this.store.busy.value = false; }
  }

  features(): Array<{ id: string; type: string; name?: string }> {
    return this.session
      ? this.session.document.features.map((f) => ({ id: f.id, type: f.type, name: f.name }))
      : [];
  }

  /** The design-check policy now in force (rule modes, limits), or null for none. The app sets it. */
  policy: (() => CheckPolicy | null) | null = null;
  /** Called with every finished policy check (after an edit), for the panel and the status chip. */
  onCheck: ((r: { report: ProfileReport; revision: number; policy: CheckPolicy }) => void) | null = null;
  private unguarded = false;
  private baseline: { revision: number; key: string; issues: Issue[] } | null = null;
  private afterTimer: ReturnType<typeof setTimeout> | null = null;
  private afterRunning = false;
  private afterAgain = false;

  /** The next edit is not subject to Block rules (sketch confirmations). */
  private skipGuardOnce(): void { this.unguarded = true; }

  private async rawCheck(profile: string | Record<string, unknown>, opts?: { samples?: number; maxIssues?: number }): Promise<ProfileReport | null> {
    const s = this.session;
    if (!s) return null;
    try { return await s.checkProfile(profile, opts); } catch (e) { this.store.notify((e as Error).message, 'error'); return null; }
  }

  private async baselineFor(p: CheckPolicy): Promise<Issue[] | null> {
    const key = JSON.stringify(p.profile);
    if (this.baseline && this.baseline.revision === this.revision && this.baseline.key === key) return this.baseline.issues;
    const report = await this.rawCheck(p.profile);
    if (!report) return null;
    this.baseline = { revision: this.revision, key, issues: report.issues };
    return report.issues;
  }

  /** After an edit: the message to reject it with when a Block rule has new violations, else null (and the result is the new baseline). */
  private async blockCheck(p: CheckPolicy, before: Issue[]): Promise<string | null> {
    const report = await this.rawCheck(p.profile);
    if (!report) return null;
    const fresh = blockedIssues(before, report.issues, p.blocking);
    if (fresh.length) return blockMessage(fresh, p.titles);
    this.baseline = { revision: this.revision, key: JSON.stringify(p.profile), issues: report.issues };
    this.onCheck?.({ report, revision: this.revision, policy: p });
    return null;
  }

  /** Run the active profile shortly after the last edit; never two at once (a second request waits and reruns once). */
  private scheduleAfterEdit(delayMs = 400): void {
    if (this.afterTimer) clearTimeout(this.afterTimer);
    this.afterTimer = setTimeout(() => { this.afterTimer = null; void this.runAfterEdit(); }, delayMs);
  }
  private async runAfterEdit(): Promise<void> {
    if (this.afterRunning) { this.afterAgain = true; return; }
    const p = this.policy?.();
    if (!p || !p.afterEdit) return;
    this.afterRunning = true;
    try {
      const r = await this.checkProfile(p.profile);
      if (r) {
        this.baseline = { revision: r.revision, key: JSON.stringify(p.profile), issues: r.report.issues };
        this.onCheck?.({ report: r.report, revision: r.revision, policy: p });
      }
    } finally {
      this.afterRunning = false;
      if (this.afterAgain) { this.afterAgain = false; this.scheduleAfterEdit(0); }
    }
  }

  /** Counts the documents shown so far; a design-check result carries the number it was made for and is stale once it moves. */
  revision = 0;
  private profileList: ProfileList | null = null;

  /** The built-in design-rule profiles and their rule parameters (asked once, then kept). Null without a document or on a kernel error. */
  async profiles(): Promise<ProfileList | null> {
    if (this.profileList) return this.profileList;
    const s = this.session;
    if (!s) return null;
    try { this.profileList = await s.profiles(); } catch (e) { this.store.notify((e as Error).message, 'error'); return null; }
    return this.profileList;
  }

  /** Run a design-rule profile (built-in id or inline rules) on the part. Only when asked: never part of a rebuild.
   *  Shows the busy state and can be cancelled like a rebuild. `null` when cancelled, without a document or on a kernel error. */
  async checkProfile(profile: string | Record<string, unknown>, opts?: { samples?: number; maxIssues?: number }): Promise<{ report: ProfileReport; revision: number } | null> {
    const s = this.session;
    if (!s) return null;
    const revision = this.revision;
    this.store.busy.value = true;
    try {
      const report = await Promise.race([
        s.checkProfile(profile, opts),
        new Promise<never>((_, reject) => { this.pendingCancel = () => reject(new Error('cancelled')); }),
      ]);
      return { report, revision };
    } catch (e) {
      if ((e as Error).message !== 'cancelled') this.store.notify((e as Error).message, 'error');
      return null;
    } finally {
      this.pendingCancel = null;
      this.store.busy.value = false;
    }
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

  /** The last body handed to the viewer, with its surface bodies kept apart (`lastView` has them merged in). */
  private shown: ShownBody | null = null;
  /** The last body handed to the viewer (its box and sketch frames), for choosing sensible defaults. */
  private lastView: { box: { min: number[]; max: number[] }; sketches: Array<{ id: string; frame: { o: number[]; z: number[] } }>; edges?: ViewEdge[]; mesh?: { positions: ArrayLike<number>; normals?: ArrayLike<number>; triFace?: ArrayLike<number>; faceIds?: string[] } } | null = null;

  /** The bounding box of the body on screen (null when there is none). */
  bodyBox(): { min: number[]; max: number[] } | null {
    return this.lastView?.box ?? null;
  }

  /** The triangles of the body on screen (three vertices per triangle, xyz, millimetres); null when there is none. */
  bodyMesh(): { positions: ArrayLike<number> } | null {
    const m = this.lastView?.mesh;
    return m && m.positions.length > 0 ? m : null;
  }

  /** The mesh arrays of the body on screen with normals and face ids (what the handles measure faces from), or null. */
  bodyFaces(): { positions: ArrayLike<number>; normals: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] } | null {
    const m = this.lastView?.mesh;
    return m && m.normals && m.triFace && m.faceIds && m.positions.length > 0 ? { positions: m.positions, normals: m.normals, triFace: m.triFace, faceIds: m.faceIds } : null;
  }


  // ---- Inspect tools: read-only kernel queries on the current state. They never edit the document; null on a kernel error or no document. ----
  private async inspect<T>(go: (s: Session) => Promise<T | null>): Promise<T | null> {
    const s = this.session;
    if (!s) return null;
    try { return await go(s); } catch (e) { this.store.notify((e as Error).message, 'error'); return null; }
  }
  /** Volume, area, centre of mass and principal moments (unit density) of the body. */
  massProps(): Promise<MassRaw | null> { return this.inspect((s) => queryMass(s)); }
  /** The kernel's measurement of one or two faces / edges. */
  measure(refs: Array<Record<string, unknown>>): Promise<KernelMeasure | null> { return this.inspect((s) => queryMeasure(s, refs)); }
  /** Pairs of solid bodies that share volume. */
  interference(): Promise<Interference | null> { return this.inspect((s) => queryInterference(s)); }

  /** STEP text of the current document, from the kernel (null when nothing is loaded). */
  async exportStep(): Promise<string | null> {
    return this.session ? this.session.step() : null;
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

  /** The body to show: the whole model, or the first `rollbackCount()` features while rolled back. */
  private async bodyNow(s: Session): Promise<ShownBody | null> {
    const n = this.rollbackCount();
    let body: Awaited<ReturnType<Session['bodyForView']>>;
    if (n === null) body = await s.bodyForView();
    else {
      const r = await s.preview([], { upTo: n });
      if (!r.ok) this.store.notify(r.hints?.map((h) => h.hint).join('; ') || r.schemaError || 'rolled-back model did not build', 'error');
      body = r.body;
    }
    return withSurfaces(body, await this.surfacesFor(s, s.document, n));
  }

  /**
   * The surface bodies (sheets) of a document. `Session.bodyForView` returns only the solid, so with a feature that makes a
   * sheet this asks the kernel for the regen reply itself (a second regen on its own tag); documents without one pay nothing.
   */
  private async surfacesFor(s: Session, doc: PartDoc, upTo: number | null, suffix = '-surf'): Promise<ViewSurface[]> {
    if (!hasSurfaceFeatures(doc.features as never)) return [];
    const k = (s as unknown as { kernel?: { request(m: unknown): Promise<{ ok?: boolean; result?: unknown }> } }).kernel;
    return fetchSurfaces(k, doc, `${this.previewTagOf(s)}${suffix}`, upTo);
  }

  /** The surface bodies on screen: feature id and the face names it owns. */
  surfaceBodies(): Array<{ id: string; faces: string[] }> {
    return (this.shown?.surfaces ?? []).map((x) => ({ id: x.id, faces: x.mesh.faceIds }));
  }
  /** The id of the surface body that owns this face or edge name (null for the solid, or a corner). */
  surfaceOf(name: string): string | null {
    return surfaceNames(this.shown).get(name) ?? null;
  }
  /** Whether the part has a solid on screen (a part of surfaces only has none: no volume, no mass). */
  hasSolid(): boolean {
    return (this.shown?.mesh.triFace.length ?? 0) > 0;
  }

  private async refresh(): Promise<void> {
    const s = this.session;
    if (!s) return;
    const ids = s.document.features.map((f) => f.id);
    this.rollbackAnchor = repairAnchor(this.rollbackAnchor, this.lastIds, ids);
    this.lastIds = ids;
    const body = await this.bodyNow(s);
    this.revision++;
    this.shown = body;
    this.lastView = body ? mergedView(body) : null;   // solid and sheets as one mesh: what picking lists, measure and section read
    this.view.setBody(body);
    // everything that can be selected now: faces, edges and the corners at the ends of edges
    const existing = new Set<string>(this.lastView?.mesh?.faceIds ?? []);
    if (body) existing.add(BODY);
    for (const e of (this.lastView?.edges ?? []) as Array<{ key?: string; pts: number[][] }>) {
      if (e.key) existing.add(e.key);
      for (const p of [e.pts[0], e.pts[e.pts.length - 1]]) if (p) existing.add(vertexName(p));
    }
    this.store.dropMissing(existing);
    const report = await s.verify();
    this.committedExtras = await this.regenExtras(s, s.document, this.previewTagOf(s), report.regen as unknown as { threads?: unknown[]; warnings?: unknown[] });
    this.applyExtras(this.committedExtras);
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
