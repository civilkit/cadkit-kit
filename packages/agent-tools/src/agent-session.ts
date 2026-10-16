// AgentSession: the state behind the agent tools. It owns ONE kernel transport and the open document (a kernel Session),
// a bounded linear history of document states (undo/redo), named checkpoints, a notes string and the script-origin marks.
import { Session, referencers } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { hintFor } from '@ck/driver-verify';
import { runScript, type ScriptHost, type ScriptError } from '@kit/script';
import type { EditOp } from '@ck/session';
import { ToolError } from './errors';
import { defaultRegistry, type Registry } from './registry';

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
const clone = <T>(x: T): T => structuredClone(x);

export class AgentSession {
  session!: Session;
  readonly registry: Registry;
  notes = '';
  readonly checkpoints = new Map<string, DocState>();
  private history: DocState[] = [];
  private cursor = -1;
  /** feature id -> 'script#N'; mirrors the `origin` field of the feature JSON (kept here in case a document round trip drops it). */
  readonly origins = new Map<string, string>();
  scriptRuns = 0;
  private readonly tag = `agent-main-${++tagSeq}`;
  private readonly scratchTag = `agent-scratch-${tagSeq}`;
  private ownsTransport = false;
  private listeners = new Set<(e: { version: number; label: string; doc: PartDoc }) => void>();
  version = 0;
  get snapshotFn() { return this.opts.snapshotFn; }

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
        const hand = referencers(current, id).filter((r) => !drop.has(r));
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
    };
    let res;
    try {
      res = await runScript(code, host, base, mode === 'attach' ? { prefix: { features: prefix as never, seq: current.seq } } : {});
    } catch (e) {
      throw new ToolError('script_crash', String((e as Error).message ?? e), 'the runner itself failed; simplify the script and try again');
    }
    const errors = res.errors.map((e: ScriptError) => this.decorate(e, raw));
    const regenMs = performance.now() - t0;
    if (errors.length || !res.document) return { ok: false, errors, warnings: [], mode, run, created: [], removed: [], regenMs };
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
    const warnings = rep.warnings;
    // kernel errors of the final document (should not happen after a clean scratch build)
    const late = rep.errors.map(([fid, err]) => ({ line: 0, feature: fid, message: (err as { message?: string }).message ?? err.code ?? 'error', code: err.code, hint: hintFor(fid, err.code ?? '', err.params ?? {}).hint }));
    return { ok: late.length === 0, errors: late, warnings, mode, run, created: [...mine], removed, regenMs: performance.now() - t0 };
  }

  private decorate(e: ScriptError, raw: Array<[string, { code?: string; message?: string; params?: Record<string, unknown> }]>) {
    const hit = e.feature ? raw.find(([id]) => id === e.feature) : undefined;
    const code = hit?.[1]?.code;
    return { line: e.line, message: e.message, ...(e.feature ? { feature: e.feature } : {}), ...(code ? { code, hint: hintFor(e.feature!, code, hit![1].params ?? {}).hint } : {}) };
  }

  async close(): Promise<void> {
    if (this.ownsTransport) await this.transport.close?.().catch(() => {});
  }
}
