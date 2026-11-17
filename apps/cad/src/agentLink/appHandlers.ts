// What the app does when a linked agent asks (docs/agent-bridge.md). Pure over a small `deps` object, so the rules (what is exposed,
// what is refused, what a result looks like) are tested without the app. The wiring to the controller is in `link.ts`.
import { BridgeError, EDIT_OPS, type BridgeOp } from '@kit/agent-link';
import { APP_READBACK_TOOLS, ReadbackError, type ReadbackHost } from '@kit/readback';
import { RevisionTracker, compactState, type StateInput } from './stateQuery';
import { diffFeatures, planEdit, snapshotFeatures, type KernelOp } from './agentEdit';

export interface AppDoc { name?: string; features?: Array<Record<string, unknown>>; variables?: Array<{ name: string; expr: string }> }
export interface RunReport { ok: boolean; errors: Array<{ line: number; message: string }>; created: string[]; featureCount: number }

/** One installed generator as an agent sees it: its tool schema is the same one the form is made from. */
export interface PluginGeneratorInfo { plugin: string; generator: string; title: string; description?: string; parameters: unknown }
export interface PluginRunReport { ok: boolean; message?: string; issues?: Array<{ param: string; message: string }>; group?: string; created?: number; featureCount?: number }

export interface AppDeps {
  /** Every plugin generator the app has registered (built-in and installed, enabled ones only). */
  plugins?(): Array<{ id: string; name: string; version: string; builtin: boolean; generators: PluginGeneratorInfo[] }>;
  /** Run one generator on the open document: one folder, one undo step, exactly like the Plugins panel's Add. */
  runPlugin?(plugin: string, generator: string, params: Record<string, unknown>): Promise<PluginRunReport>;
  document(): AppDoc | null;
  selection(): string[];
  facts(): { faces: number; triangles: number; rebuildMs: number | null };
  status(): Array<{ id: string; ok: boolean; code?: string; hint?: string }>;
  hasSolid(): boolean;
  /** A PNG of the open part from `view` at `size` px, or null when there is nothing to draw. */
  render(view: string, size: number, section?: { origin: number[]; normal: number[] }): Promise<Uint8Array | null>;
  /** Attach mode, one undo step. */
  runScript(code: string): Promise<RunReport>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** The kernel queries and bodies the measurement tools (bodies, measure, clearance, interference, thickness, draft, dfm) read; null without a solid or a kernel. */
  readback?(): Promise<ReadbackHost | null>;
  /** The user's permission, read again for every edit. */
  allowEdit(): boolean;
  /** The document revision: a counter that goes up after every successful edit, undo, redo and load (Controller.revision). Without it the revision is 0. */
  revision?(): number;
  /** Names the open document; a new one at every load. */
  documentId?(): string;
  /** The bounding box of what is shown (mm), or null without a solid. */
  bounds?(): { min: number[]; max: number[] } | null;
  /** Apply the ops as ONE history step if the document is still at `expectedRevision` (all or none: the kernel rebuilds the candidate first). */
  edit?(expectedRevision: number, ops: KernelOp[], reason: string): Promise<EditOutcome>;
  /** A file the daemon staged for this link (open_asset): its bytes, fetched over loopback. */
  fetchAsset?(handle: string): Promise<Uint8Array>;
  /** Open the file in the app (a new document tab for a part, STEP or SolidCraft; a reference mesh is added to the open one). Throws when it does not open. */
  openAsset?(a: { name: string; kind: AssetKind; bytes: Uint8Array; unit?: string }): Promise<OpenedAsset>;
}
export type EditOutcome = { ok: true; warnings?: number } | { ok: false; stale?: boolean; revision?: number; errors?: Array<{ feature: string; code: string }>; message?: string };
export type AssetKind = 'part' | 'solidcraft' | 'step' | 'stl' | 'obj' | 'glb' | '3mf';
export const ASSET_KINDS: readonly AssetKind[] = ['part', 'solidcraft', 'step', 'stl', 'obj', 'glb', '3mf'];
/** What the app reports after an open: the identity and revision of the document now open and what it holds. */
export interface OpenedAsset { documentId: string; revision: number; counts: { features: number; faces: number }; errorCount: number }

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const NO_EDIT = () => new BridgeError('edit_not_allowed', 'the user has not allowed the agent to change this document', 'ask the user to tick "Allow the agent to change this document" in Settings, Agent link');

/** A cut plane from the wire: {origin?, normal}, origin defaulting to the world origin. */
function planeArg(v: unknown): { origin: number[]; normal: number[] } {
  const p = (v ?? {}) as { origin?: unknown; normal?: unknown };
  const vec = (x: unknown, name: string): number[] => {
    if (!Array.isArray(x) || x.length !== 3 || x.some((n) => typeof n !== 'number' || !Number.isFinite(n))) throw new BridgeError('bad_input', `${name} must be three numbers [x, y, z]`);
    return x as number[];
  };
  const normal = vec(p.normal, 'normal');
  if (!normal.some((n) => n !== 0)) throw new BridgeError('bad_input', 'normal must not be the zero vector');
  return { origin: p.origin === undefined ? [0, 0, 0] : vec(p.origin, 'origin'), normal };
}

export function makeAppHandler(d: AppDeps): (op: BridgeOp, args: Record<string, unknown>) => Promise<unknown> {
  const tracker = new RevisionTracker();
  const source = () => {
    const doc = d.document();
    if (!doc) return null;
    const bad = new Map(d.status().filter((s) => !s.ok).map((s) => [s.id, s]));
    return { doc, bad, revision: d.revision?.() ?? 0, documentId: d.documentId?.() ?? '' };
  };
  /** Remember the document as it is now, so a later `sinceRevision` can say what changed (before and after every edit, and at every read). */
  const observe = () => { const s = source(); if (s) tracker.observe({ documentId: s.documentId, revision: s.revision, features: (s.doc.features ?? []) as Array<Record<string, unknown>>, bad: s.bad }); };
  return async (op, args) => {
    const edits = EDIT_OPS.has(op);
    if (edits) observe();
    try { return await run(op, args); } finally { if (edits) observe(); }
  };
  async function run(op: BridgeOp, args: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'state': {
        const src = source();
        if (!src) return { open: false, hint: 'no document is open in the app' };
        const { doc, bad } = src;
        // the default is the compact, filtered, paged form; `summary` and `full` are the earlier shapes, unchanged
        if (args.detail !== 'summary' && args.detail !== 'full') {
          const b = d.bounds?.() ?? null;
          const state = { documentId: src.documentId, revision: src.revision, name: doc.name ?? null, features: (doc.features ?? []) as Array<Record<string, unknown>>, bad, variableCount: (doc.variables ?? []).length, selection: d.selection(), hasSolid: d.hasSolid(), faces: d.facts().faces, bounds: b };
          const out = compactState(state, args as StateInput, tracker);
          tracker.observe(state);
          return out;
        }
        tracker.observe({ documentId: src.documentId, revision: src.revision, features: (doc.features ?? []) as Array<Record<string, unknown>>, bad });
        const features = (doc.features ?? []).map((f) => ({
          id: String(f.id), type: String(f.type), ...(f.name ? { name: String(f.name) } : {}), ...(f.suppressed ? { suppressed: true } : {}),
          ...(bad.get(String(f.id)) ? { error: { code: bad.get(String(f.id))!.code, ...(bad.get(String(f.id))!.hint ? { hint: bad.get(String(f.id))!.hint } : {}) } } : {}),
        }));
        return {
          open: true, documentId: src.documentId, revision: src.revision, name: doc.name ?? null, featureCount: features.length, features,
          variables: (doc.variables ?? []).map((v) => ({ name: v.name, expr: v.expr })),
          selection: d.selection(), hasSolid: d.hasSolid(), ...d.facts(),
          ...(args.detail === 'full' ? { document: doc } : {}),
        };
      }
      case 'screenshot': {
        if (!d.document() || !d.hasSolid()) throw new BridgeError('no_body', 'the open document has no solid to draw', 'build something first, or ask the user to');
        const view = typeof args.view === 'string' ? args.view : 'iso';
        const size = typeof args.size === 'number' ? Math.max(64, Math.min(1536, Math.round(args.size))) : 768;
        const section = args.section === undefined ? undefined : planeArg(args.section);
        const png = await d.render(view, size, section);
        if (!png) throw new BridgeError('snapshot_failed', 'the app could not draw the model', 'try another view or a smaller size');
        return { png: toBase64(png), view, size, bytes: png.length };
      }
      case 'section': {
        // a read: the exact cross-section of the open document at a plane (the same answer as the headless `section` tool)
        if (!d.document()) throw new BridgeError('no_document', 'no document is open in the app', 'ask the user to open or start a part first');
        if (!d.hasSolid()) throw new BridgeError('no_body', 'the open document has no solid to cut', 'build something first, or ask the user to');
        const host = d.readback ? await d.readback() : null;
        if (!host) throw new BridgeError('no_kernel', 'the app has no kernel session to cut with', 'wait for the part to finish loading and try again');
        const plane = planeArg(args.plane);
        const r = await host.kernel.section(plane);
        const round = (n: number) => Math.round(n * 1000) / 1000;
        const loops = (r.loops ?? []).map((l) => ({ kind: l.kind, area: round(l.area), edges: l.edges?.length ?? 0, ...(args.detail ? { pts: l.pts } : {}) }));
        return { plane, frame: r.frame, area: round(r.area), bbox2d: r.bbox2d, openChains: r.openChains ?? 0, loops };
      }
      case 'plugin_list': {
        if (!d.plugins) throw new BridgeError('unsupported', 'this app build has no plugins');
        return { plugins: d.plugins() };
      }
      case 'plugin_run': {
        if (!d.allowEdit()) throw NO_EDIT();
        if (!d.runPlugin) throw new BridgeError('unsupported', 'this app build has no plugins');
        if (typeof args.plugin !== 'string' || typeof args.generator !== 'string') throw new BridgeError('bad_input', 'plugin and generator must be strings (see app_plugin_list)');
        if (args.params !== undefined && (typeof args.params !== 'object' || args.params === null || Array.isArray(args.params))) throw new BridgeError('bad_input', 'params must be an object');
        if (!d.document()) throw new BridgeError('no_document', 'no document is open in the app', 'ask the user to open or start a part first');
        const r = await d.runPlugin(args.plugin, args.generator, (args.params ?? {}) as Record<string, unknown>);
        if (!r.ok) throw new BridgeError('plugin_failed', r.message ?? 'the plugin run failed', r.issues?.length ? r.issues.map((i) => `${i.param} ${i.message}`).join('; ') : 'see app_plugin_list for the parameters');
        return r;
      }
      case 'run_script': {
        if (!d.allowEdit()) throw NO_EDIT();
        if (typeof args.code !== 'string' || !args.code.trim()) throw new BridgeError('bad_input', 'code must be a non-empty string');
        if (!d.document()) throw new BridgeError('no_document', 'no document is open in the app', 'ask the user to open or start a part first');
        return await d.runScript(args.code);
      }
      case 'edit': {
        if (!d.allowEdit()) throw NO_EDIT();
        if (!d.edit) throw new BridgeError('unsupported', 'this app build cannot run edit transactions');
        const src = source();
        if (!src) throw new BridgeError('no_document', 'no document is open in the app', 'ask the user to open or start a part first');
        const expected = args.expectedRevision;
        if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 0) throw new BridgeError('bad_input', 'expectedRevision is required: the revision of the last app_state you read');
        const stale = (now: number) => new BridgeError('stale_revision', `expectedRevision ${expected} is not the app's revision ${now}: the document changed`, 'read app_state with sinceRevision set to your revision to see what changed, then send the edit again with the new revision');
        if (expected !== src.revision) throw stale(src.revision);
        const features = (src.doc.features ?? []) as Array<Record<string, unknown>>;
        const ops = planEdit(args.ops, { features });          // every op checked before the kernel is asked; a bad one refuses all
        if (args.dryRun === true) return { ok: true, dryRun: true, revision: src.revision, documentId: src.documentId, validated: ops.length };
        const before = snapshotFeatures(features, src.bad);
        const r = await d.edit(expected, ops, typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim().slice(0, 120) : 'Agent edit');
        if (!r.ok) {
          if (r.stale) throw stale(r.revision ?? -1);
          throw new BridgeError('edit_rejected', `${r.errors?.length ? r.errors.map((e) => `${e.feature}: ${e.code}`).join('; ') : r.message ?? 'the rebuild failed'}; nothing was changed`, 'fix the op named above (app_state with ids and fields params shows the feature), or check the values; the document is as it was');
        }
        const after = source();
        const now = (after?.doc.features ?? []) as Array<Record<string, unknown>>;
        const diff = diffFeatures(before, now, after?.bad ?? new Map());
        const errors = now.filter((f) => after?.bad.has(String(f.id))).map((f) => ({ feature: String(f.id), code: after!.bad.get(String(f.id))!.code ?? 'error' }));
        return {
          revision: after?.revision ?? src.revision, documentId: after?.documentId ?? src.documentId,
          changedIds: [...diff.changed, ...diff.added], addedIds: diff.added, removedIds: diff.removed,
          validation: { errorCount: errors.length, errors: errors.slice(0, 10), warnings: r.warnings ?? 0 },
        };
      }
      case 'open_asset': {
        // the bytes never came through the model: the daemon read an allowed file and staged it; the app fetches it by handle and checks it is the file described
        if (!d.allowEdit()) throw NO_EDIT();
        if (!d.fetchAsset || !d.openAsset) throw new BridgeError('unsupported', 'this app build cannot open files for an agent');
        const { handle, name, kind, bytes, sha256, unit } = args as { handle?: unknown; name?: unknown; kind?: unknown; bytes?: unknown; sha256?: unknown; unit?: unknown };
        if (typeof handle !== 'string' || typeof name !== 'string' || !ASSET_KINDS.includes(kind as AssetKind) || typeof bytes !== 'number' || typeof sha256 !== 'string') throw new BridgeError('bad_input', 'open_asset needs handle, name, kind, bytes and sha256');
        const data = await d.fetchAsset(handle);
        if (data.length !== bytes) throw new BridgeError('asset_mismatch', `the file that arrived is ${data.length} bytes, not ${bytes}`);
        if ((await sha256Hex(data)) !== sha256) throw new BridgeError('asset_mismatch', 'the file that arrived is not the one that was staged (the checksum differs)');
        let r: OpenedAsset;
        try { r = await d.openAsset({ name, kind: kind as AssetKind, bytes: data, ...(typeof unit === 'string' ? { unit } : {}) }); }
        catch (e) { throw e instanceof BridgeError ? e : new BridgeError('open_failed', String((e as Error)?.message ?? e), 'the file may be damaged or of a version this app cannot read'); }
        return { ...r, name, kind, bytes, sha256, previewRef: { tool: 'app_screenshot', args: { view: 'iso', size: 768 } } };
      }
      case 'undo': case 'redo': {
        if (!d.allowEdit()) throw NO_EDIT();
        await (op === 'undo' ? d.undo() : d.redo());
        return { done: op };
      }
      case 'bodies': case 'measure': case 'clearance': case 'interference': case 'thickness': case 'draft': case 'dfm': case 'interfaces': {
        // reads only: no edit permission, the document is never touched
        if (!d.document()) throw new BridgeError('no_document', 'no document is open in the app', 'ask the user to open or start a part first');
        if (!d.hasSolid()) throw new BridgeError('no_body', 'the open document has no solid to measure', 'build something first, or ask the user to');
        const host = d.readback ? await d.readback() : null;
        if (!host) throw new BridgeError('no_kernel', 'the app has no kernel session to measure with', 'wait for the part to finish loading and try again');
        const tool = APP_READBACK_TOOLS.find((t) => t.name === op)!;
        try { const { data, summary } = await tool.run(args, host); return { ...(summary ? { summary } : {}), ...(data as Record<string, unknown>) }; }
        catch (e) { if (e instanceof ReadbackError) throw new BridgeError(e.code, e.message, e.hint); throw e; }
      }
      default: throw new BridgeError('unknown_op', `the app does not know ${String(op)}`);
    }
  }
}
