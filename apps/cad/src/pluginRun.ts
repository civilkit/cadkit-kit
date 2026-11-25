// Runs a plugin generator against the open document: the checked parameters become a script (packages/plugin), the script runs in attach
// mode on the kernel's scratch build (nothing of the open document is touched), and the ops it records come back stamped with one tree
// folder, ready for controller.preview() or controller.commit() (one undo step), exactly like a wizard's ops.
import type { EditOp } from '@ck/session';
import { runScript, type ScriptHost } from '@kit/script';
import { contextOf, trimForPreview, type SketchCurveIO, type GenerateContext, type PluginRegistry, type RunRecord, type Values } from '@kit/plugin';
import { groupOps, wizardGroupName } from './wizardGroup';
import { scratchRows } from './pluginDoc';

/** the script API version plugins' `engine` ranges are checked against */
export const PLUGIN_API_VERSION = '1.0.0';
/** `edit`: this run REPLACES the folder `group` (its feature ids), in the same place in the tree, instead of adding a new folder */
export interface PluginSel { pluginId: string; generatorId: string; values: Values; edit?: { group: string; ids: string[] } }
type Doc = { features: Array<Record<string, unknown>>; seq?: number; appearance?: Record<string, unknown>; bodyNames?: Record<string, unknown>; pluginRuns?: Record<string, RunRecord> };
/** view-state fields a run may write besides its features (colours and names from appearance() / bodyName()) */
export type PluginExtras = Partial<Record<'appearance' | 'bodyNames' | 'pluginRuns', Record<string, unknown>>>;
export type PluginOps = { ok: true; /** the curves the run drew into the open sketch (then `ops` is empty) */ sketchAdds?: SketchCurveIO[]; ops: EditOp[]; group: string | undefined; title: string; record: RunRecord; extras: PluginExtras; previewSkipped?: string[]; /** the preview's script had slow detail cut out by shape (so a kernel failure may be worth a retry with the full script) */ trimmedScript?: boolean } | { ok: false; message: string; issues: Array<{ param: string; message: string }> };

/** Does the view-state key belong to one of these features (a feature id, a face name of it, or the body key made from one)? */
const keyOf = (key: string, ids: ReadonlySet<string>): boolean => { const k = key.startsWith('@body:') ? key.slice(6) : key; return ids.has(k.split('.')[0]); };

export async function pluginOps(registry: PluginRegistry, full: Doc, sel: PluginSel, host: ScriptHost, up?: 'y' | 'z', docCtx?: GenerateContext['doc'], opts: { /** the sketch the user has open: a plugin reads it and draws into it */ openSketch?: GenerateContext['openSketch']; preview?: boolean; /** a preview with everything in it: the retry when the trimmed one did not build */ full?: boolean } = {}): Promise<PluginOps> {
  const found = registry.find(sel.pluginId, sel.generatorId);
  if (!found) return { ok: false, message: `no generator ${sel.pluginId}/${sel.generatorId}`, issues: [] };
  // an edit runs against the document WITHOUT the folder it replaces, so its names (the cabinet's own bodies) are free again
  const gone = new Set(sel.edit?.ids ?? []);
  if (gone.size) {
    // a feature outside the folder that is built on one of its features would be deleted along with it: say so instead
    const outside = full.features.filter((f) => !gone.has(String(f.id)) && [...gone].some((id) => new RegExp(`\\b${id}\\b`).test(JSON.stringify({ ...f, id: undefined }))));
    if (outside.length) return { ok: false, message: `built on this folder: ${outside.map((f) => String(f.name ?? f.id)).join(', ')}. Delete or change those first.`, issues: [] };
  }
  const doc: Doc = gone.size ? { ...full, features: full.features.filter((f) => !gone.has(String(f.id))) } : full;
  // the run itself is built on the features BEFORE the folder: the ones after it (a Move folder, a cut of a body by name) may refer to bodies the folder makes, and come back after it
  const before = gone.size ? full.features.slice(0, Math.max(0, full.features.findIndex((f) => gone.has(String(f.id))))) : doc.features;
  const used = doc.features.flatMap((f) => [f.name, f.group, f.body].filter((x): x is string => typeof x === 'string'));
  // a plugin that reads the model (measure) gets the run's script built on top of the features before the folder; its bodies come back with their volumes
  const seq0 = Math.max(full.seq ?? 1, ...full.features.map((f) => { const m = /^F(\d+)$/.exec(String(f.id ?? '')); return m ? Number(m[1]) + 1 : 1; }));
  const scratch: GenerateContext['scratch'] | undefined = host.build && host.facts ? { async build(script: string) {
    const r = await runScript(script, host, {}, { prefix: { features: before, seq: seq0 } });
    if (r.errors.length) throw new Error(r.errors[0].message);
    const built = await host.build!(r.document as never, true);
    const f = await host.facts!({ mass: true });
    await host.release?.();
    const g = built.geometry as { mesh?: never; faceLumps?: Record<string, number> } | undefined;
    return scratchRows((g?.mesh ?? null) as never, g?.faceLumps, (f.bodies ?? []) as never);
  } } : undefined;
  let sketchAdds: SketchCurveIO[] | null = null;
  const p = await registry.prepare(sel.pluginId, sel.generatorId, sel.values, contextOf(used, { ...(opts.openSketch ? { openSketch: opts.openSketch, sketchOut: (a: SketchCurveIO[]) => { sketchAdds = a; } } : {}), ...(up ? { up } : {}), ...(docCtx ? { doc: docCtx } : {}), ...(scratch ? { scratch } : {}), ...(opts.preview ? { preview: true } : {}) }));
  if (!p.ok) return { ok: false, message: p.message, issues: p.issues };
  if (sketchAdds) return { ok: true, sketchAdds, ops: [], group: undefined, title: found.decl.title, record: p.record, extras: {} };
  if (!host.build) return { ok: false, message: 'noScratch', issues: [] };
  // ids are never reused: the next one comes from the whole document, the removed features included
  const seq = Math.max(full.seq ?? 1, ...full.features.map((f) => { const m = /^F(\d+)$/.exec(String(f.id ?? '')); return m ? Number(m[1]) + 1 : 1; }));
  // a preview leaves out the slow detail it can recognise (engraved text, rows of identical holes); if the trimmed script does not run, the full one does
  const trim = opts.preview && !opts.full ? trimForPreview(p.script) : null;
  let r = await runScript(trim?.skipped.length ? trim.script : p.script, host, {}, { prefix: { features: before, seq } });
  let autoSkipped = trim?.skipped.length ? trim.skipped.map((s) => s.what) : [];
  if (autoSkipped.length && r.errors.length) { r = await runScript(p.script, host, {}, { prefix: { features: before, seq } }); autoSkipped = []; }
  if (r.errors.length) return { ok: false, message: r.errors.map((e) => e.message).join('; '), issues: [] };
  if (!r.ops.length) return { ok: false, message: 'the generator added nothing', issues: [] };
  const group = sel.edit?.group ?? wizardGroupName(doc.features as never, found.decl.title);
  let ops = groupOps(r.ops as EditOp[], group);
  if (gone.size) {
    // the new features go where the old folder stood, so later features (and a Move folder) still come after the bodies they use. The session checks every op's
    // `index` against the document as it is BEFORE the batch, so a rebuilt folder with more features than the old one cannot use rising indexes:
    // every feature is inserted at the folder's first position, last one first, which leaves them in order.
    const at = Math.max(0, full.features.findIndex((f) => gone.has(String(f.id))));
    const adds = ops.filter((o) => o.op === 'add').reverse().map((o) => ({ ...o, index: at }) as EditOp);
    ops = [...[...gone].map((id) => ({ op: 'remove', id, cascade: true }) as EditOp), ...adds, ...ops.filter((o) => o.op !== 'add')];
  }
  // appearance() and bodyName() are not features: they come back in the run's document, keyed by the feature ids the run used, so they merge into the open document's own
  const out = (r.document ?? {}) as Doc;
  const extras: PluginExtras = {};
  for (const k of ['appearance', 'bodyNames'] as const) {
    const mine = out[k];
    const kept = Object.fromEntries(Object.entries(full[k] ?? {}).filter(([key]) => !keyOf(key, gone)));   // the replaced folder's colours go with it
    if ((mine && Object.keys(mine).length) || Object.keys(kept).length !== Object.keys(full[k] ?? {}).length) extras[k] = { ...kept, ...(mine ?? {}) };
  }
  const first = (ops.find((o) => o.op === 'add') as { feature?: { id?: unknown } } | undefined)?.feature?.id;
  const record: RunRecord = { ...p.record, ...(typeof first === 'string' ? { first } : {}) };
  // the record is found by the folder's first feature (a rename changes the folder's name, not its features); the replaced folder's own record goes
  const kept = Object.fromEntries(Object.entries(full.pluginRuns ?? {}).filter(([, r]) => !(r.first && gone.has(r.first))));
  extras.pluginRuns = { ...kept, ...(group ? { [group]: record } : {}) };
  const declared = opts.preview ? (record.meta as { previewSkipped?: string[] } | undefined)?.previewSkipped ?? [] : [];
  const skipped = [...declared, ...autoSkipped.filter((w) => !declared.includes(w))];
  return { ok: true, ops, group, title: found.decl.title, record, extras, ...(skipped.length ? { previewSkipped: skipped, ...(autoSkipped.length ? { trimmedScript: true } : {}) } : {}) };
}

/** The record of the run that made the folder `name`: found by the folder's first feature, so a renamed folder is still found; the name is only the fallback. */
export function runOfFolder(doc: { features: ReadonlyArray<{ id?: unknown; group?: unknown }>; pluginRuns?: Record<string, RunRecord> } | null | undefined, name: string): RunRecord | undefined {
  const runs = doc?.pluginRuns;
  if (!doc || !runs) return undefined;
  const ids = new Set(doc.features.filter((f) => f.group === name).map((f) => String(f.id)));
  return Object.values(runs).find((r) => r.first && ids.has(r.first)) ?? runs[name];
}
