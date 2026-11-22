// What a plugin that edits the open document may read: its bodies with their boxes and what is picked (the context of plugin.generate, see
// GenerateContext.doc in packages/plugin). Built from the bodies list and the display mesh; nothing here touches the kernel.
import { faceMoments, matchLumps, type BodyRow, type LumpInfo } from './bodies';
import { BODY_PREFIX, type SelMesh } from './select/model';
import type { SelItem } from '@kit/plugin';

export interface PluginDoc {
  bodies: Array<{ name: string; bbox: { min: number[]; max: number[] } | null; volume: number | null; feature?: string }>;
  selection: Array<{ type: 'body' | 'face' | 'edge'; name?: string; body?: string; /** a face's place in its body's list */ index?: number; normal?: number[] }>;
  parameters: Array<{ name: string; expression: string; value: number }>;
  /** what generators stored for the components they made, from the runs recorded in the document */
  components: Record<string, Record<string, unknown>>;
  /** the display mesh and each body's faces (in the order of a face selection's `index`): what a plugin's `model.mesh` reads. The arrays are shared, not copied. */
  meshes?: { mesh: { positions: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] }; faces: Record<string, string[]> };
}

const nameOf = (r: BodyRow): string => r.docName ?? r.name;

/** The outward normal of a face when every triangle of it agrees (a plane), else undefined. */
function planeNormal(mesh: SelMesh, face: string): number[] | undefined {
  let n: number[] | undefined;
  for (let t = 0; t < mesh.triFace.length; t++) {
    if (mesh.faceIds[mesh.triFace[t]] !== face) continue;
    const o = t * 9, c = [0, 1, 2].map((k) => (mesh.normals[o + k] + mesh.normals[o + 3 + k] + mesh.normals[o + 6 + k]) / 3), l = Math.hypot(c[0], c[1], c[2]);
    if (!(l > 1e-9)) return undefined;
    const u = c.map((v) => v / l);
    if (n && u.some((v, k) => Math.abs(v - n![k]) > 1e-4)) return undefined;
    n ??= u;
  }
  return n;
}

export function pluginDocContext(rows: readonly BodyRow[], mesh: SelMesh | null, selection: readonly string[], variables: ReadonlyArray<{ name?: unknown; expr?: unknown }> = [], runs: Record<string, { meta?: Record<string, unknown> }> = {}, opts: { /** picked edges too (a selection field that takes edges); the plugin's own `selection.get` keeps to bodies and faces, as before */ edges?: boolean } = {}): PluginDoc {
  const owner = new Map<string, number>(), edgeOwner = new Map<string, number>();
  rows.forEach((r, i) => { for (const f of r.faces) owner.set(f, i); for (const e of r.edges ?? []) edgeOwner.set(e, i); });
  const lo = rows.map(() => [Infinity, Infinity, Infinity]), hi = rows.map(() => [-Infinity, -Infinity, -Infinity]);
  if (mesh) for (let t = 0; t < mesh.triFace.length; t++) {
    const i = owner.get(mesh.faceIds[mesh.triFace[t]]);
    if (i === undefined) continue;
    for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) { const x = mesh.positions[t * 9 + v * 3 + k]; if (x < lo[i][k]) lo[i][k] = x; if (x > hi[i][k]) hi[i][k] = x; }
  }
  const featureOf = (key: string): string | undefined => { const k = key.startsWith(BODY_PREFIX) ? key.slice(BODY_PREFIX.length) : undefined; const f = k?.split('.')[0]; return f && /^F\d+$/.test(f) ? f : undefined; };
  const bodies = rows.map((r, i) => ({ name: nameOf(r), bbox: Number.isFinite(lo[i][0]) ? { min: lo[i], max: hi[i] } : null, volume: r.volume, ...(featureOf(r.key) ? { feature: featureOf(r.key) } : {}) }));
  const sel: PluginDoc['selection'] = [];
  for (const s of selection) {
    if (s.startsWith(BODY_PREFIX)) { const r = rows.find((x) => x.key === s); if (r) sel.push({ type: 'body', name: nameOf(r) }); continue; }
    const ei = owner.has(s) ? undefined : edgeOwner.get(s);
    if (ei !== undefined && opts.edges) { sel.push({ type: 'edge', body: nameOf(rows[ei]), index: rows[ei].edges.indexOf(s) }); continue; }
    const i = owner.get(s);
    if (i === undefined) continue;   // a name that is not a face or edge of a body (a vertex, a sketch entity): not offered
    const normal = mesh ? planeNormal(mesh, s) : undefined;
    sel.push({ type: 'face', body: nameOf(rows[i]), index: rows[i].faces.indexOf(s), ...(normal ? { normal } : {}) });
  }
  const parameters = variables.filter((v) => typeof v?.name === 'string').map((v) => ({ name: String(v.name), expression: String(v.expr ?? ''), value: Number.isFinite(Number(v.expr)) ? Number(v.expr) : 0 }));
  const components: PluginDoc['components'] = {};
  for (const r of Object.values(runs)) { const c = r?.meta?.components; if (c && typeof c === 'object') Object.assign(components, c as PluginDoc['components']); }
  return { bodies, selection: sel, parameters, components, ...(mesh ? { meshes: { mesh, faces: Object.fromEntries(rows.map((r) => [nameOf(r), r.faces])) } } : {}) };
}

/** The bodies of a scratch build for a plugin's measure: the kernel's mass properties give each body's name and volume (no box), the display mesh gives the boxes.
 *  A mesh lump (a body of the view) and a mass body are the same body when their volumes and centres agree, as in the Bodies list. */
export function scratchRows(mesh: SelMesh | null, faceLumps: Record<string, number> | undefined, mass: ReadonlyArray<{ name?: string; volume: number; com?: readonly number[] }>): Array<{ name: string; volume: number | null; bbox: { min: number[]; max: number[] } | null }> {
  const boxes = new Map<number, { min: number[]; max: number[] }>();
  const moments = faceMoments(mesh), vol = new Map<number, { v: number; m: number[] }>();
  if (mesh) {
    for (let t = 0; t < mesh.triFace.length; t++) {
      const face = mesh.faceIds[mesh.triFace[t]], l = faceLumps?.[face] ?? 0;
      const b = boxes.get(l) ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) { const x = mesh.positions[t * 9 + v * 3 + k]; if (x < b.min[k]) b.min[k] = x; if (x > b.max[k]) b.max[k] = x; }
      boxes.set(l, b);
    }
    for (const [face, e] of moments) { const l = faceLumps?.[face] ?? 0, a = vol.get(l) ?? { v: 0, m: [0, 0, 0] }; a.v += e.v; for (let k = 0; k < 3; k++) a.m[k] += e.m[k]; vol.set(l, a); }
  }
  const shapes = [...vol].map(([l, a]) => ({ key: String(l), volume: Math.abs(a.v) > 1e-12 ? Math.abs(a.v) : null, com: Math.abs(a.v) > 1e-12 ? a.m.map((x) => x / a.v) : null }));
  const named = mass.filter((m) => m.name && m.com).map((m) => ({ name: m.name, volume: m.volume, com: m.com! })) as LumpInfo[];
  const match = matchLumps(shapes, named);
  const byName = new Map([...match].map(([key, name]) => [name, boxes.get(Number(key)) ?? null]));
  return mass.filter((m) => m.name).map((m) => ({ name: m.name!, volume: m.volume, bbox: byName.get(m.name!) ?? (mass.length === 1 && boxes.size === 1 ? [...boxes.values()][0] : null) }));
}

/** What a selection field takes from the document's selection: the bodies, faces and edges it accepts, as the references a plugin receives (`{type:'body', name}`,
 *  `{type:'face', body, index, normal?}`, `{type:'edge', body, index}`), or the bodies' names for a field that takes names. With a maximum, the last picks win. */
export function selectionItems(sel: PluginDoc['selection'], d: { accept?: readonly string[]; asNames?: boolean; maxItems?: number }): SelItem[] {
  const out: SelItem[] = [];
  const bodyOnlyFallback = !!d.accept?.includes('body') && !d.accept?.includes('face');
  const seenBodies = new Set<string>();
  const pushBody = (name: string) => {
    if (seenBodies.has(name)) return;
    seenBodies.add(name);
    out.push(d.asNames ? name : { type: 'body', name });
  };
  for (const s of sel) {
    if (s.type === 'body' && s.name && d.accept?.includes('body')) pushBody(s.name);
    else if (s.type === 'face' && s.body && d.accept?.includes('face') && !d.asNames) out.push({ type: 'face', body: s.body, ...(s.index !== undefined && s.index >= 0 ? { index: s.index } : {}), ...(s.normal ? { normal: s.normal } : {}) });
    else if (s.type === 'face' && s.body && bodyOnlyFallback) pushBody(s.body);
    else if (s.type === 'edge' && s.body && d.accept?.includes('edge') && !d.asNames) out.push({ type: 'edge', body: s.body, ...(s.index !== undefined && s.index >= 0 ? { index: s.index } : {}) });
  }
  return d.maxItems !== undefined && out.length > d.maxItems ? out.slice(out.length - d.maxItems) : out;
}
