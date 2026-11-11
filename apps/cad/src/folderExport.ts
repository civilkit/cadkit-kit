// Export the geometry of a feature-tree folder: STEP, STL or a frozen .ckpart of the bodies the folder's features created or changed.
// A body belongs to the folder when one of its faces carries the id of a folder feature (face names say which feature made them, also for
// a pattern's or mirror's copy: `F4.S.h1@F9.2` belongs to F4 and F9). The folder is cut out of the part by keeping only those bodies in a
// scratch copy of the document (a `deleteBody` in `keep` mode at the end), so the file holds exactly the solids the kernel built, and the
// open document is never touched. No DOM and no kernel here: the planning is pure, the build goes through a request function.
import type { PartDoc } from '@ck/part-model';
import { refOf } from './bodyOps';
import type { BodyRow } from './bodies';
import { partOfStep, VOLUME_TOLERANCE } from './files/sldprtImport';

export type FolderFormat = 'step' | 'stl' | 'ckpart';
type Feat = { id: string; type?: string; suppressed?: boolean; [k: string]: unknown };

/** Features that make no solid: a folder holding only these has nothing to export. */
const NO_SOLID = new Set(['sketch', 'sketch3d', 'plane', 'axis', 'helix', 'projectCurve', 'editCurve', 'splitLine']);

/** The feature ids a face name belongs to: the one that made it and the ones that repeated it (`F4.S.h1@F9.2`). */
export function faceFeatures(face: string): string[] {
  const first = face.split('|')[0];
  const base = /^(F\d+)(?=[.:@#]|$)/.exec(first)?.[1];
  const via = [...first.matchAll(/@(F\d+)(?=[.:@#]|$)/g)].map((m) => m[1]);
  return [...(base ? [base] : []), ...via];
}

/** Why a folder cannot be exported; the app shows `io.folder.<reason>` with the params and its hint. */
export type FolderRefusal = 'rolledBack' | 'empty' | 'onlySketches' | 'allSuppressed' | 'noBodies';
/** The message and the hint (what to do next) of each refusal, as locale keys. */
export const REFUSAL_KEYS: Record<FolderRefusal, { message: string; hint: string }> = {
  rolledBack: { message: 'io.folder.rolledBack', hint: 'io.folder.hint.rolledBack' },
  empty: { message: 'io.folder.empty', hint: 'io.folder.hint.empty' },
  onlySketches: { message: 'io.folder.onlySketches', hint: 'io.folder.hint.onlySketches' },
  allSuppressed: { message: 'io.folder.allSuppressed', hint: 'io.folder.hint.allSuppressed' },
  noBodies: { message: 'io.folder.noBodies', hint: 'io.folder.hint.noBodies' },
};
export type FolderPlan =
  | { ok: true; bodies: BodyRow[]; /** the folder holds every body of the part: nothing needs cutting out */ whole: boolean; /** bodies that also carry faces of features outside the folder */ shared: number; doc: PartDoc }
  | { ok: false; reason: FolderRefusal; params: Record<string, string | number> };

/** The bodies of `rows` that belong to the folder `ids` (its rows and the sketches under them). */
export function folderBodyRows(ids: ReadonlySet<string>, rows: readonly BodyRow[]): BodyRow[] {
  return rows.filter((r) => r.faces.some((f) => faceFeatures(f).some((id) => ids.has(id))));
}

/** The document with a `deleteBody` (keep) at the end that leaves only `bodies`. Not saved anywhere: the scratch copy the export builds. */
export function keepOnlyDoc(doc: PartDoc, bodies: readonly BodyRow[]): PartDoc {
  const used = new Set(doc.features.map((f) => f.id));
  let n = Math.max(doc.seq, 1);
  while (used.has(`F${n}`)) n++;
  const { viewCache: _cache, thumbnail: _thumb, ...plain } = doc as PartDoc & { viewCache?: unknown; thumbnail?: unknown };
  const keep = bodies.map((b) => refOf({ ...(b.docName ? { docName: b.docName } : {}), face: [...b.faces].sort()[0] }));
  return { ...plain, features: [...doc.features, { type: 'deleteBody', id: `F${n}`, name: 'Keep folder bodies', mode: 'keep', bodies: keep }], seq: n + 1 } as unknown as PartDoc;
}

/**
 * What exporting folder `name` (feature ids `ids`) would write, or why not. `rows` are the bodies of the shown result; a rolled-back
 * document shows only part of the history, so it is refused rather than exported short.
 */
export function planFolderExport(doc: PartDoc, name: string, ids: readonly string[], rows: readonly BodyRow[], rolledBack: boolean): FolderPlan {
  const no = (reason: FolderRefusal, params: Record<string, string | number> = {}): FolderPlan => ({ ok: false, reason, params: { name, ...params } });
  if (rolledBack) return no('rolledBack');
  const idSet = new Set(ids);
  const feats = doc.features.filter((f) => idSet.has(f.id)) as Feat[];
  if (!feats.length) return no('empty');
  const solids = feats.filter((f) => !NO_SOLID.has(String(f.type)));
  if (!solids.length) return no('onlySketches', { count: feats.length });
  if (solids.every((f) => f.suppressed === true)) return no('allSuppressed', { count: solids.length });
  const bodies = folderBodyRows(idSet, rows);
  if (!bodies.length) return no('noBodies', { count: solids.length });
  const shared = bodies.filter((b) => b.faces.some((f) => !faceFeatures(f).some((id) => idSet.has(id)))).length;
  const whole = bodies.length === rows.length;
  return { ok: true, bodies, whole, shared, doc: whole ? doc : keepOnlyDoc(doc, bodies) };
}

/** A kernel request function (the controller's transport). */
export interface KernelLike { request(msg: Record<string, unknown>): Promise<{ ok?: boolean; trap?: string; error?: unknown; result?: unknown }> }

export interface FolderBuild { step: string; volume: number; solids: number; mesh: { positions: ArrayLike<number> } | null }
export type FolderBuildResult = { ok: true; build: FolderBuild } | { ok: false; message: string };

export const FOLDER_TAG = 'folder-export';
const TAG = FOLDER_TAG;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Build the (already cut down) document on the scratch tag and ask the kernel for its STEP text, volume and lump count. `mesh` is the
 *  display mesh, handed in by the caller that built it (`scratchBuild`), so the same triangles feed the STL as the screen shows. */
export async function buildFolder(k: KernelLike, name: string, mesh: FolderBuild['mesh']): Promise<FolderBuildResult> {
  const mass = await k.request({ type: 'massProps', tag: TAG, bodies: true });
  const res = mass.ok ? (mass.result as { volume?: unknown; bodies?: unknown[] } | undefined) : undefined;
  const volume = num(res?.volume);
  if (volume === null || volume <= 0) return { ok: false, message: 'the folder\'s bodies have no volume' };
  const out = await k.request({ type: 'step', tag: TAG, name });
  if (!out.ok || typeof out.result !== 'string' || !out.result.includes('ISO-10303-21')) return { ok: false, message: 'the kernel could not write the bodies as STEP' };
  return { ok: true, build: { step: out.result, volume, solids: Array.isArray(res?.bodies) ? res!.bodies!.length : 1, mesh } };
}

/** The frozen part: a document whose one feature is the imported STEP of the folder's bodies. Built again on the kernel and measured; a part
 *  that does not give the same volume (to the import tolerance) is refused, never written. */
export async function frozenPart(k: KernelLike, source: PartDoc, name: string, build: FolderBuild): Promise<{ ok: true; part: PartDoc } | { ok: false; message: string }> {
  const part = { ...(await partOfStep(build.step, name, name)), material: source.material } as PartDoc;
  const regen = await k.request({ type: 'regen', tag: `${TAG}-part`, part, opts: { noView: true } });
  const errors = (regen.result as { errors?: unknown[] } | undefined)?.errors ?? [];
  if (!regen.ok || errors.length) return { ok: false, message: 'the frozen part does not rebuild from the exported solid' };
  const mass = await k.request({ type: 'massProps', tag: `${TAG}-part` });
  const v = num((mass.result as { volume?: unknown } | undefined)?.volume);
  if (v === null || Math.abs(v - build.volume) > VOLUME_TOLERANCE * build.volume) return { ok: false, message: `the frozen part has volume ${v ?? 'none'} where the folder's bodies have ${build.volume}` };
  return { ok: true, part };
}


// ---- Extract as part: the folder's features as a document of their own ----

/** Why a folder cannot be extracted; `outside` lists what it uses that lives outside it. */
export type ExtractRefusal = 'rolledBack' | 'empty' | 'outsideFeatures' | 'outsideFaces' | 'outsideBodies' | 'differs' | 'failed';
export const EXTRACT_KEYS: Record<ExtractRefusal, { message: string; hint: string }> = {
  rolledBack: { message: 'io.folder.rolledBack', hint: 'io.folder.hint.rolledBack' },
  empty: { message: 'io.folder.empty', hint: 'io.folder.hint.empty' },
  outsideFeatures: { message: 'io.extract.outsideFeatures', hint: 'io.extract.hint.outsideFeatures' },
  outsideFaces: { message: 'io.extract.outsideFaces', hint: 'io.extract.hint.outsideFaces' },
  outsideBodies: { message: 'io.extract.outsideBodies', hint: 'io.extract.hint.outsideBodies' },
  differs: { message: 'io.extract.differs', hint: 'io.extract.hint.differs' },
  failed: { message: 'io.extract.failed', hint: 'io.extract.hint.failed' },
};
export type ExtractPlan =
  | { ok: true; part: PartDoc; /** the variables that travel with it */ variables: string[]; /** bodies of the folder that other features also changed: the part builds without those changes */ shared: number }
  | { ok: false; reason: ExtractRefusal; outside: string[]; params: Record<string, string | number> };

/** Every string leaf of a feature that can refer to something else: all but its own id, name, type and folder. */
function refLeaves(f: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const [k, v] of Object.entries(f)) if (k !== 'id' && k !== 'name' && k !== 'type' && k !== 'group') walk(v);
  return out;
}

const WORD = /[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * The folder `ids` as a part of its own: its features in document order (ids kept, so face names inside it stay valid), the variables they
 * use (with their values), the material. Refused with the list when a feature of the folder refers to a feature, a face or a body that
 * lives outside it (those names are not stable in a new document). `sharedBodies` is how many of the folder's bodies other features
 * also changed (the part is built without those changes).
 */
export function planExtract(doc: PartDoc, name: string, ids: readonly string[], rolledBack: boolean, sharedBodies = 0): ExtractPlan {
  const no = (reason: ExtractRefusal, outside: string[] = []): ExtractPlan => ({ ok: false, reason, outside, params: { name, list: outside.join(', '), count: outside.length } });
  if (rolledBack) return no('rolledBack');
  const idSet = new Set(ids);
  const feats = doc.features.filter((f) => idSet.has(f.id)) as unknown as Array<Record<string, unknown> & { id: string }>;
  if (!feats.length) return no('empty');
  const outsideIds = new Set(doc.features.filter((f) => !idSet.has(f.id)).map((f) => f.id));
  const outsideBodies = new Set(doc.features.filter((f) => !idSet.has(f.id)).map((f) => (f as { body?: unknown }).body).filter((b): b is string => typeof b === 'string' && b !== ''));
  for (const f of feats) { const b = f.body; if (typeof b === 'string') outsideBodies.delete(b); }
  const byKind = { features: new Set<string>(), faces: new Set<string>(), bodies: new Set<string>() };
  for (const f of feats) {
    for (const s of refLeaves(f)) {
      if (outsideIds.has(s)) byKind.features.add(s);
      else { const owner = /^(F\d+)[.:@#|]/.exec(s)?.[1]; if (owner && outsideIds.has(owner)) byKind.faces.add(s); else if (outsideBodies.has(s)) byKind.bodies.add(s); }
    }
  }
  if (byKind.features.size) return no('outsideFeatures', [...byKind.features]);
  if (byKind.faces.size) return no('outsideFaces', [...byKind.faces]);
  if (byKind.bodies.size) return no('outsideBodies', [...byKind.bodies]);
  // variables: the ones a feature names, and the ones those use
  const all = ((doc as unknown as { variables?: Array<{ name?: string; expr?: unknown }> }).variables ?? []).filter((v) => typeof v?.name === 'string');
  const byName = new Map(all.map((v) => [v.name!, v] as const));
  const used = new Set<string>(), queue = feats.flatMap(refLeaves);
  while (queue.length) for (const w of String(queue.pop()).match(WORD) ?? []) if (byName.has(w) && !used.has(w)) { used.add(w); const e = byName.get(w)!.expr; if (typeof e === 'string') queue.push(e); }
  const variables = all.filter((v) => used.has(v.name!));
  const part = { ...doc, name, features: feats.map(({ group: _grp, ...rest }) => rest), seq: doc.seq } as unknown as Record<string, unknown>;
  // what belongs to the whole document, not to the folder: looks, names, configurations, the stored view
  for (const k of ['variables', 'configurations', 'activeConfig', 'appearance', 'faceAppearance', 'bodyNames', 'view', 'viewCache', 'thumbnail', 'cosmeticKnurls', 'meshes', 'expect']) delete part[k];
  if (variables.length) part.variables = variables;
  return { ok: true, part: part as unknown as PartDoc, variables: variables.map((v) => v.name!), shared: sharedBodies };
}
