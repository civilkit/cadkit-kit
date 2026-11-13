// AgentSession: the state behind the agent tools. It owns ONE kernel transport and the open document (a kernel Session),
// a bounded linear history of document states (undo/redo), named checkpoints, a notes string and the script-origin marks.
import { Session, referencers } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { repairHint } from './hints';
import { runScript, SHEET_FEATURE_TYPES, type InertiaFact, type ScriptHost, type ScriptError } from '@kit/script';
import type { EditOp } from '@ck/session';
import { ToolError } from './errors';
import { defaultRegistry, type Registry } from './registry';
import type { Interference } from '@kit/readback';

type Transport = { request(m: Record<string, unknown>): Promise<{ ok?: boolean; trap?: string; error?: unknown; result?: unknown }>; close?(): Promise<void> };
export interface AgentSessionOptions {
  wasmPath?: string;
  /** The script-API method registry (list_methods / docs read from it). Default: a minimal one generated from the docs. */
  registry?: Registry;
  /** Open on a transport that already exists (tests). */
  transport?: Transport;
  /** Replace the snapshot renderer (tests; default: the @kit/snapshot package, loaded on demand). */
  snapshotFn?: (session: unknown, opts: Record<string, unknown>) => Promise<unknown>;
  maxHistory?: number;
  maxCheckpoints?: number;
}
export interface DocState { doc: PartDoc; label: string; time: number }
export interface ScriptRunReport {
  ok: boolean;
  errors: Array<{ line: number; message: string; feature?: string; code?: string; hint?: string }>;
  warnings: unknown[];
  mode: 'new' | 'attach';
  run: number;
  created: string[];
  removed: string[];
  regenMs: number;
}

let tagSeq = 0;

const SHEET_TYPES = new Set<string>(SHEET_FEATURE_TYPES);
/** One entry of the kernel's `sheetMetal` regen result (docs/sheet-metal.md): the rule and, for a sheet feature, the flat pattern and the role names. */
export interface SheetEntry {
  id: string;
  type: string;
  rule: SheetRule;
  flatPattern?: FlatPattern;
  roles?: { faces: Array<{ role: string; face: string | null }>; edges: Array<{ role: string; faces: string[]; mid: number[] }> };
}
export interface SheetRule { name: string; thickness: number; kFactor: number; bendRadius: number; reliefWidth: number; reliefDepth: number; cornerRelief: number; cornerReliefShape: string; hemGap: number; gap: number }
export interface FlatPattern {
  rule: string; thickness: number; kFactor: number;
  /** width, length (in the plane of the base sketch), thickness; mm */
  flatSize: number[];
  /** outer loop (CCW) then the holes; points [x, y] in the flat plane */
  outline: number[][][];
  bends: Array<{ bend: number; role?: string; feature: string; direction: string; angleDeg: number; includedAngleDeg: number; radius: number; allowance: number; length: number; start: number[]; end: number[] }>;
  bendZones: number[][];
  unfolded: boolean;
}

/** Features whose JSON mentions `id` or one of its persistent names (F2.C1, F2.S.e1|F5.B0#30): faces and edges are strings in refs. */
export function usersOf(doc: PartDoc, id: string): string[] {
  const hit = (v: unknown): boolean => {
    if (typeof v === 'string') return v.split('|').some((p) => { const q = p.replace(/#\d+$/, ''); return q === id || q.startsWith(`${id}.`); });
    if (Array.isArray(v)) return v.some(hit);
    if (v && typeof v === 'object') return Object.values(v).some(hit);
    return false;
  };
  return (doc.features as unknown as Array<Record<string, unknown>>).filter((f) => f.id !== id && Object.entries(f).some(([k, v]) => k !== 'id' && k !== 'origin' && hit(v))).map((f) => String(f.id));
}
const clone = <T>(x: T): T => structuredClone(x);

export class AgentSession {
  session!: Session;
  readonly registry: Registry;
  /** the document the last script build used (its features give the sketch frames in repair hints) */
  private scratchDoc: { features: Array<Record<string, unknown>> } | undefined;
  notes = '';
  readonly checkpoints = new Map<string, DocState>();
  private history: DocState[] = [];
  private cursor = -1;
  /** feature id -> 'script#N'; mirrors the `origin` field of the feature JSON (kept here in case a document round trip drops it). */
  readonly origins = new Map<string, string>();
  scriptRuns = 0;
  private readonly tag = `agent-main-${++tagSeq}`;
  private readonly scratchTag = `agent-scratch-${tagSeq}`;
  private sheetMemo: { version: number; entries: SheetEntry[] } | null = null;
  private ownsTransport = false;
  private listeners = new Set<(e: { version: number; label: string; doc: PartDoc }) => void>();
  version = 0;
  get snapshotFn() { return this.opts.snapshotFn; }

  /** The kernel's `interference` request on the open document (pairs of bodies that share volume); null when there is no solid. */
  async interference(): Promise<Interference | null> {
    const r = await this.transport.request({ type: 'interference', tag: this.tag });
    if (r.trap) throw new Error(`trap: ${String(r.trap)}`);
    if (!r.ok) throw new Error(typeof r.error === 'string' ? r.error : (r.error as { message?: string } | undefined)?.message ?? 'request failed');
    return (r.result ?? null) as Interference | null;
  }

  /** Re-read the origin marks from the open document (after undo / restore). */
  rebuildOrigins(): void {
    this.origins.clear();
    for (const f of this.doc.features as unknown as Array<{ id: string; origin?: string }>) if (typeof f.origin === 'string') this.origins.set(f.id, f.origin);
  }

  /** A hand edit (what the GUI does): applied through the kernel Session and recorded on the history. */
  async applyEdit(ops: EditOp[], reason = 'hand edit') {
    const r = await this.session.edit(ops, reason);
    if (r.ok) await this.setDocument(this.doc, reason);
    return r;
  }

  private constructor(readonly transport: Transport, readonly opts: AgentSessionOptions) {
    this.registry = opts.registry ?? defaultRegistry();
  }

  static async open(opts: AgentSessionOptions = {}): Promise<AgentSession> {
    let transport = opts.transport;
    let own = false;
    if (!transport) {
      const { createWorkerKernel } = await import('@ck/kernel-client/node');
      transport = (await createWorkerKernel(opts.wasmPath)) as unknown as Transport;
      own = true;
    }
    const a = new AgentSession(transport, opts);
    a.ownsTransport = own;
    await a.setDocument(emptyPart('Part1'), 'open', false);
    return a;
  }

  get doc(): PartDoc { return this.session.document; }
  get canUndo(): boolean { return this.cursor > 0; }
  get canRedo(): boolean { return this.cursor < this.history.length - 1; }
  historyInfo(): { cursor: number; length: number; labels: string[] } { return { cursor: this.cursor, length: this.history.length, labels: this.history.map((h) => h.label) }; }

  /** Subscribe to document changes (the daemon's event stream). */
  onChange(fn: (e: { version: number; label: string; doc: PartDoc }) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Make `doc` the open document (a fresh kernel Session on the shared transport). `record` pushes it on the undo history. */
  async setDocument(doc: PartDoc, label: string, record = true): Promise<void> {
    const s = new Session(clone(doc), this.transport as never, 'agent', this.tag);
    await s.regenReport();   // warms the tag; throws on a trap
    this.session = s;
    if (record) {
      this.history.length = this.cursor + 1;
      this.history.push({ doc: clone(doc), label, time: Date.now() });
      const max = this.opts.maxHistory ?? 50;
      if (this.history.length > max) this.history.splice(0, this.history.length - max);
      this.cursor = this.history.length - 1;
    } else if (!this.history.length) {
      this.history.push({ doc: clone(doc), label, time: Date.now() });
      this.cursor = 0;
    }
    this.version++;
    for (const l of this.listeners) l({ version: this.version, label, doc: clone(doc) });
  }

  async undo(): Promise<string | null> {
    if (!this.canUndo) return null;
    const undone = this.history[this.cursor].label;
    this.cursor--;
    await this.setDocument(this.history[this.cursor].doc, `undo ${undone}`, false);
    return undone;
  }
  async redo(): Promise<string | null> {
    if (!this.canRedo) return null;
    this.cursor++;
    const h = this.history[this.cursor];
    await this.setDocument(h.doc, `redo ${h.label}`, false);
    return h.label;
  }

  saveCheckpoint(name: string): DocState {
    const max = this.opts.maxCheckpoints ?? 20;
    if (!this.checkpoints.has(name) && this.checkpoints.size >= max) {
      const oldest = [...this.checkpoints.entries()].sort((a, b) => a[1].time - b[1].time)[0][0];
      this.checkpoints.delete(oldest);
    }
    const st = { doc: this.doc, label: name, time: Date.now() };
    this.checkpoints.set(name, st);
    return st;
  }

  originOf(f: { id?: unknown; origin?: unknown }): string | null {
    return (typeof f.origin === 'string' ? f.origin : null) ?? this.origins.get(String(f.id)) ?? null;
  }

  /** Build `doc` on a scratch kernel tag (no display work unless `view`); the open document is untouched. */
  async scratchBuild(doc: Record<string, unknown>, view: boolean) {
    this.scratchDoc = doc as { features: Array<Record<string, unknown>> };
    const r = await this.transport.request({ type: 'regen', tag: this.scratchTag, part: { ...emptyPart('script'), ...doc }, ...(view ? {} : { opts: { noView: true } }) });
    if (r.trap || !r.ok || !r.result) throw new Error(r.trap ?? (typeof r.error === 'string' ? r.error : 'regen failed'));
    const res = r.result as { errors?: Array<[string, { code?: string; message?: string; params?: Record<string, unknown> }]>; body?: Record<string, unknown> | null };
    const errors = res.errors ?? [];
    if (!view) return { errors };
    const body = res.body ?? null;
    if (!body) return { errors, geometry: { mesh: null, edges: [], box: null } };
    const { meshFromBody } = await import('@ck/mesh');
    const mesh = meshFromBody(body as Parameters<typeof meshFromBody>[0]) as never as { positions: ArrayLike<number> } | null;
    return { errors, geometry: { mesh: mesh && mesh.positions.length > 0 ? mesh : null, edges: (body.edges as never[] | undefined) ?? [], box: (body.box as { min: number[]; max: number[] } | undefined) ?? null } };
  }
  /**
   * The two fields of a regen reply of the open document that the Session drops (`limits` of a drafted extrude, `components` of an
   * assembly, asked with `dofReport` as the app does), read from a regen on a scratch tag so the open document's own state is untouched.
   */
  async viewReplyExtras(): Promise<{ limits: unknown; components: unknown[] }> {
    const r = await this.transport.request({ type: 'regen', tag: `${this.scratchTag}-view`, part: this.doc, opts: { dofReport: true } });
    if (r.trap || !r.ok || !r.result) throw new Error(r.trap ?? (typeof r.error === 'string' ? r.error : 'regen failed'));
    const res = r.result as { limits?: unknown; components?: unknown };
    await this.transport.request({ type: 'regen', tag: `${this.scratchTag}-view`, part: { format: 'ck-part', version: 1, name: 'scratch', features: [], seq: 1, rollback: null }, opts: { noView: true } }).catch(() => null);
    return { limits: res.limits, components: Array.isArray(res.components) ? res.components : [] };
  }
  /**
   * The `sheetMetal` list of a regen reply of the open document (one entry per sheet feature, in document order: its rule, the flat pattern with
   * the bend table after that feature, and the role names), which the kernel Session drops. Empty without sheet features. Kept per document version.
   */
  async sheetMetal(): Promise<SheetEntry[]> {
    const feats = this.doc.features as unknown as Array<{ id: string; type: string }>;
    if (!feats.some((f) => SHEET_TYPES.has(f.type))) return [];
    if (this.sheetMemo?.version === this.version) return this.sheetMemo.entries;
    const tag = `${this.scratchTag}-sheet`;   // a scratch tag: the open document's own kernel state is untouched
    const r = await this.transport.request({ type: 'regen', tag, part: this.doc, opts: { noView: true } });
    await this.transport.request({ type: 'regen', tag, part: { format: 'ck-part', version: 1, name: 'scratch', features: [], seq: 1, rollback: null }, opts: { noView: true } }).catch(() => null);
    if (r.trap || !r.ok || !r.result) throw new Error(r.trap ?? (typeof r.error === 'string' ? r.error : 'regen failed'));
    const raw = ((r.result as { sheetMetal?: SheetEntry[] }).sheetMetal ?? []).slice();
    const order = new Map(feats.map((f, i) => [f.id, i]));
    raw.sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0));
    this.sheetMemo = { version: this.version, entries: raw };
    return raw;
  }
  /** A stateless kernel request about a flat pattern (sheetDxf, sheetBendTable): the reply's result, or a ToolError with the kernel's refusal. */
  async sheetRequest(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
    const r = await this.transport.request(msg);
    if (r.trap) throw new ToolError('kernel_trap', r.trap, 'the kernel failed on this request; retry, or restore a checkpoint');
    if (!r.ok || !r.result) {
      const e = r.error as { message?: string; field?: string; detail?: string; hint?: string } | string | undefined;
      const text = typeof e === 'string' ? e : e ? [e.message, e.detail].filter(Boolean).join(': ') : 'refused';
      throw new ToolError('bad_input', `${String(msg.type)}: ${text}`, (typeof e === 'object' && e?.hint) || (typeof e === 'object' && e?.field ? `check the field ${e.field}` : 'check the options'));
    }
    return r.result as Record<string, unknown>;
  }
  /** Mass properties / validity of the document `scratchBuild` built last (a script's read-back). */
  async scratchFacts(need: { mass?: boolean; validate?: boolean; describe?: string[]; text?: { string: string; font?: string; height: number; spacing?: number } }) {
    const out: { text?: never; volume?: number | null; area?: number | null; com?: number[] | null; inertia?: InertiaFact | null; valid?: boolean | null; issues?: Array<{ code: string; entity: string; detail: string }>; faces?: Array<{ name: string; surface?: string; area?: number; radius?: number }> } = {};
    if (need.text) {
      const r = await this.transport.request({ type: 'textMetrics', ...need.text }) as { ok: boolean; result?: unknown; error?: { message?: string } | string };
      if (!r.ok) throw new Error(`text(): ${typeof r.error === 'string' ? r.error : r.error?.message ?? 'the kernel could not measure the text'}`);
      out.text = r.result as never;
    }
    if (need.mass) {
      const r = await this.transport.request({ type: 'massProps', tag: this.scratchTag });
      const m = (r.ok ? r.result : null) as { volume?: number; area?: number; com?: number[]; principal?: number[]; axes?: number[][]; firstMoment?: number[]; inertia?: number[][]; inertiaOrigin?: number[][] } | null;
      out.volume = m?.volume ?? null; out.area = m?.area ?? null; out.com = m?.com ?? null;
      out.inertia = m?.inertia && m.inertiaOrigin && m.firstMoment && m.principal && m.axes ? { firstMoment: m.firstMoment as never, tensor: m.inertia, tensorOrigin: m.inertiaOrigin, principal: m.principal as never, axes: m.axes as never } : null;
    }
    if (need.validate) {
      const r = await this.transport.request({ type: 'validate', tag: this.scratchTag });
      const v = (r.ok ? r.result : null) as { ok?: boolean; issues?: Array<{ code: string; entity: string; detail: string }> } | null;
      out.valid = v ? v.ok === true : null; out.issues = v?.issues ?? [];
    }
    if (need.describe?.length) {
      const r = await this.transport.request({ type: 'describe', tag: this.scratchTag, names: need.describe });
      const d = (r.ok ? r.result : null) as { items?: Array<{ name: string; surface?: string; area?: number; radius?: number }> } | null;
      out.faces = (d?.items ?? []).map((i) => ({ name: i.name, surface: i.surface, area: i.area, radius: i.radius }));
    }
    return out;
  }
  private async releaseScratch(): Promise<void> {
    await this.transport.request({ type: 'regen', tag: this.scratchTag, part: { format: 'ck-part', version: 1, name: 'scratch', features: [], seq: 1, rollback: null }, opts: { noView: true } }).catch(() => null);
  }

  /**
   * Run a script. 'new' replaces the document with the script's part. 'attach' appends the script's features to the open
   * document; `replace` says which earlier script features go first: 'last' (default: those of the most recent script run, so
   * re-running a corrected script does not duplicate it), 'all' (every script feature) or 'none' (pure append). Hand-made
   * features are never removed. The result is applied only when the whole script builds (atomic); otherwise nothing changes.
   */
  async runScript(code: string, mode: 'new' | 'attach', opts: { name?: string; replace?: 'last' | 'all' | 'none' } = {}): Promise<ScriptRunReport> {
    const t0 = performance.now();
    const raw: Array<[string, { code?: string; message?: string; params?: Record<string, unknown> }]> = [];
    const run = this.scriptRuns + 1;
    const origin = `script#${run}`;
    const current = this.doc;
    let prefix: PartDoc['features'] = [];
    const removed: string[] = [];
    if (mode === 'attach') {
      const replace = opts.replace ?? 'last';
      let drop = new Set<string>();
      if (replace !== 'none') {
        const marks = current.features.map((f) => [String(f.id), this.originOf(f as never)] as const).filter((x): x is [string, string] => x[1] !== null);
        const lastRun = Math.max(0, ...marks.map(([, o]) => Number(/^script#(\d+)$/.exec(o)?.[1] ?? 0)));
        drop = new Set(marks.filter(([, o]) => replace === 'all' || o === `script#${lastRun}`).map(([id]) => id));
      }
      // a hand-made feature that uses a feature about to be replaced would break: refuse, say which
      for (const id of drop) {
        const hand = [...new Set([...referencers(current, id), ...usersOf(current, id)])].filter((r) => !drop.has(r));
        if (hand.length) {
          return {
            ok: false, mode, run, created: [], removed: [], regenMs: 0, warnings: [],
            errors: [{ line: 0, feature: hand[0], message: `hand-made feature ${hand.join(', ')} depends on script feature ${id}, which this run would replace`, hint: `use replace:'none' to append without replacing, or remove ${hand.join(', ')} first` }],
          };
        }
      }
      prefix = current.features.filter((f) => !drop.has(String(f.id)));
      removed.push(...drop);
    }
    const base: Record<string, unknown> = mode === 'attach' ? { name: current.name, material: current.material, counters: current.counters } : {};
    if (mode === 'new' && opts.name) base.name = opts.name;
    let captured: Record<string, unknown> | null = null;
    const host: ScriptHost = {
      load: async (d) => { captured = d; },
      edit: async () => ({ ok: true }),
      geometry: () => ({ mesh: null, edges: [], box: null }),
      build: async (d, view) => {
        const r = await this.scratchBuild(d, view);
        for (const e of r.errors) raw.push(e);
        return r as never;
      },
      release: () => this.releaseScratch(),
      facts: (need) => this.scratchFacts(need),
    };
    let res;
    try {
      res = await runScript(code, host, base, mode === 'attach' ? { prefix: { features: prefix as never, seq: current.seq } } : {});
    } catch (e) {
      throw new ToolError('script_crash', String((e as Error).message ?? e), 'the runner itself failed; simplify the script and try again');
    }
    const errors = res.errors.map((e: ScriptError) => this.decorate(e, raw));
    const regenMs = performance.now() - t0;
    if (errors.length || !res.document) return { ok: false, errors, warnings: (res.warnings ?? []).map((w) => ({ code: 'scriptWarning', line: w.line, message: w.message })), mode, run, created: [], removed: [], regenMs };
    // stamp the origin on the script's features
    const mine = new Set(res.ops.map((o) => String(o.feature.id)));
    const feats = (res.document.features as Array<Record<string, unknown>>).map((f) => (mine.has(String(f.id)) ? { ...f, origin } : f));
    const doc = { ...(captured ?? res.document), ...(res.document as object), features: feats } as unknown as PartDoc;
    if (mode === 'new') this.origins.clear();
    for (const id of removed) this.origins.delete(id);
    for (const id of mine) this.origins.set(id, origin);
    this.scriptRuns = run;
    await this.setDocument(doc, `${origin} (${mode})`);
    const rep = await this.session.regenReport();
    const multi = await this.multiBodyCutWarnings(doc.features as unknown as Array<Record<string, unknown>>, mine).catch(() => []);
    const warnings = [...(res.warnings ?? []).map((w) => ({ code: 'scriptWarning', line: w.line, message: w.message })), ...rep.warnings, ...multi];
    // kernel errors of the final document (should not happen after a clean scratch build)
    const late = rep.errors.map(([fid, err]) => ({ line: 0, feature: fid, message: (err as { message?: string }).message ?? err.code ?? 'error', code: err.code, hint: repairHint(fid, err.code ?? '', err.params ?? {}, this.doc as never) }));
    return { ok: late.length === 0, errors: late, warnings, mode, run, created: [...mine], removed, regenMs: performance.now() - t0 };
  }

  /** Per-lump volume and centre of mass of a feature list, built on the scratch tag; null when it does not build. */
  private async lumpsOf(features: Array<Record<string, unknown>>, base: PartDoc): Promise<Array<{ volume: number; com: number[] }> | null> {
    const r = await this.scratchBuild({ ...(base as unknown as Record<string, unknown>), features }, false);
    if (r.errors.length) return null;
    const m = await this.transport.request({ type: 'massProps', tag: this.scratchTag, bodies: true });
    return m.ok ? ((m.result as { bodies?: Array<{ volume: number; com: number[] }> }).bodies ?? []) : null;
  }

  /**
   * A cut applies to EVERY body that exists when it runs. When this run added cuts (or holes), rebuild the list just before and just after
   * each one and warn when it changed more than one body. Only checked when the result has several bodies, for at most 24 cuts and 8 seconds.
   */
  private async multiBodyCutWarnings(feats: Array<Record<string, unknown>>, mine: Set<string>): Promise<Array<{ code: string; line: number; message: string }>> {
    const isCut = (f: Record<string, unknown>) => mine.has(String(f.id)) && ((['extrude', 'revolve', 'sweep', 'loft'].includes(String(f.type)) && f.op === 'cut') || f.type === 'hole');
    const cuts = feats.map((f, i) => ({ f, i })).filter(({ f }) => isCut(f));
    if (!cuts.length) return [];
    const final = await this.session.massProps({ bodies: true }).catch(() => null);
    if ((final?.bodies?.length ?? 0) < 2) return [];
    const out: Array<{ code: string; line: number; message: string }> = [];
    const t0 = performance.now();
    let checked = 0;
    for (const { f, i } of cuts) {
      if (checked >= 24 || performance.now() - t0 > 8000) break;
      const before = await this.lumpsOf(feats.slice(0, i), this.doc);
      if (!before || before.length < 2) continue;
      checked++;
      const after = await this.lumpsOf(feats.slice(0, i + 1), this.doc);
      if (!after) continue;
      const same = (x: { volume: number; com: number[] }, y: { volume: number; com: number[] }) => Math.abs(x.volume - y.volume) <= 1e-6 * Math.max(1, x.volume) && Math.hypot(x.com[0] - y.com[0], x.com[1] - y.com[1], x.com[2] - y.com[2]) <= 1e-6;
      const left = [...after];
      let changed = 0;
      for (const b of before) { const k = left.findIndex((y) => same(b, y)); if (k >= 0) left.splice(k, 1); else changed++; }
      if (changed > 1) out.push({ code: 'cutHitManyBodies', line: 0, message: `${f.id} (${String(f.name ?? f.type)}) changed ${changed} bodies: a cut applies to every body that exists when it runs. If only one body should be cut, build the others after this cut or leave clearance` });
    }
    return out;
  }

  private decorate(e: ScriptError, raw: Array<[string, { code?: string; message?: string; params?: Record<string, unknown> }]>) {
    const hit = e.feature ? raw.find(([id]) => id === e.feature) : undefined;
    const code = hit?.[1]?.code;
    return { line: e.line, message: e.message, ...(e.feature ? { feature: e.feature } : {}), ...(code ? { code, hint: repairHint(e.feature!, code, hit![1].params ?? {}, this.scratchDoc as never) } : {}) };
  }

  async close(): Promise<void> {
    if (this.ownsTransport) await this.transport.close?.().catch(() => {});
  }
}
