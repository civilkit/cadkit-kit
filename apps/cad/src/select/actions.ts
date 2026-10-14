// The selection commands as pure functions: current selection and pick mode in, new selection (and the mode it lives in) out.
import { BODY, vertexName, type SelectionMode } from '@kit/store';
import { isBodyName, type SelModel } from './model';

export interface Result { names: string[]; mode: SelectionMode; /** what was found, for the toast */ added: number }

const isEdgeName = (m: SelModel, n: string) => m.isEdge(n);
const split = (m: SelModel, sel: string[]) => ({
  faces: sel.filter((n) => m.isFace(n)),
  edges: sel.filter((n) => isEdgeName(m, n)),
  corners: sel.filter((n) => n.startsWith('v:')),
  bodies: sel.filter((n) => isBodyName(n) || n === BODY),
});

/** Every name of one pick kind on screen. */
export function pickable(m: SelModel, mode: SelectionMode): string[] {
  if (mode === 'face') return m.faces;
  if (mode === 'edge') return m.edgeNames;
  if (mode === 'body') return m.bodies().map((b) => b.name);
  const out = new Set<string>();
  for (const e of m.data.edges) for (const p of [e.pts?.[0], e.pts?.[(e.pts?.length ?? 1) - 1]]) if (p) out.add(vertexName(p));
  return [...out];
}

const result = (before: string[], names: string[], mode: SelectionMode): Result => ({ names, mode, added: names.filter((n) => !before.includes(n)).length });

/** Names of the bodies that hold the selected faces, edges and bodies. */
export function bodiesOfSelection(m: SelModel, sel: string[]): string[] {
  const s = split(m, sel);
  if (s.bodies.includes(BODY)) return m.bodies().map((b) => b.name);
  const out = new Set(s.bodies);
  for (const f of s.faces) { const b = m.bodyOfFace(f); if (b) out.add(b.name); }
  for (const e of s.edges) { const b = m.bodies().find((x) => x.edges.includes(e)); if (b) out.add(b.name); }
  return [...out];
}

export function selectTangent(m: SelModel, sel: string[], mode: SelectionMode): Result | null {
  if (mode === 'edge') { const s = split(m, sel).edges; return s.length ? result(sel, m.tangentEdges(s), mode) : null; }
  if (mode === 'face') { const s = split(m, sel).faces; return s.length ? result(sel, m.tangentFaces(s), mode) : null; }
  return null;
}
export function selectParallel(m: SelModel, sel: string[], mode: SelectionMode): Result | null {
  if (mode !== 'edge' && mode !== 'face') return null;
  const s = mode === 'edge' ? split(m, sel).edges : split(m, sel).faces;
  return s.length ? result(sel, m.parallel(s, mode), mode) : null;
}
export function selectSimilar(m: SelModel, sel: string[], mode: SelectionMode): Result | null {
  if (mode !== 'edge' && mode !== 'face') return null;
  const s = mode === 'edge' ? split(m, sel).edges : split(m, sel).faces;
  return s.length ? result(sel, m.similar(s, mode), mode) : null;
}
/** Faces: the edges that bound them (the mode becomes Edge). Edges: the loop of the smaller face the edge borders. */
export function selectLoop(m: SelModel, sel: string[], mode: SelectionMode): Result | null {
  const s = split(m, sel);
  if (mode === 'face' && s.faces.length) return result([], m.loopsOfFaces(s.faces), 'edge');
  if (mode === 'edge' && s.edges.length) return result(sel, [...new Set(s.edges.flatMap((e) => m.loopOfEdge(e)))], 'edge');
  return null;
}
export function selectConnected(m: SelModel, sel: string[], mode: SelectionMode): Result | null {
  const s = split(m, sel);
  if (mode === 'edge' && s.edges.length) return result(sel, m.connectedEdges(s.edges), mode);
  if (mode === 'face' && s.faces.length) return result(sel, m.connectedFaces(s.faces), mode);
  if (mode === 'body' && s.bodies.length) return result(sel, bodiesOfSelection(m, sel), mode);
  return null;
}
export function invertSelection(m: SelModel, sel: string[], mode: SelectionMode): Result {
  const have = new Set(sel.includes(BODY) && mode === 'body' ? pickable(m, 'body') : sel);
  const names = pickable(m, mode).filter((n) => !have.has(n));
  return { names, mode, added: names.length };
}
/** The selection a switch to Body mode keeps: the bodies that hold what was selected. */
export function toBodyMode(m: SelModel, sel: string[]): string[] {
  return sel.length ? bodiesOfSelection(m, sel).filter(Boolean) : [];
}

export interface Summary { faces: number; edges: number; corners: number; bodies: number; /** mm2 of the selected faces (and the faces of selected bodies) */ area: number; /** mm of the selected edges */ length: number }
export function summarize(m: SelModel, sel: string[]): Summary {
  const s = split(m, sel);
  const faceSet = new Set(s.faces);
  const bodyNames = s.bodies.includes(BODY) ? m.bodies().map((b) => b.name) : s.bodies.filter(isBodyName);
  for (const b of bodyNames) for (const f of m.facesOfBody(b)) faceSet.add(f);
  let area = 0;
  for (const f of faceSet) area += m.area(f);
  let length = 0;
  for (const e of s.edges) length += m.edgeLength(e);
  return { faces: s.faces.length, edges: s.edges.length, corners: s.corners.length, bodies: bodyNames.length, area, length };
}

const num = (v: number, d = 1): string => { const f = v.toFixed(d); return f.includes('.') ? f.replace(/0+$/, '').replace(/\.$/, '') : f; };
export const areaText = (mm2: number): string => (mm2 >= 100 ? `${num(mm2 / 100)} cm²` : `${num(mm2, 2)} mm²`);
export const lengthText = (mm: number): string => (mm >= 1000 ? `${num(mm / 1000, 3)} m` : `${num(mm, 2)} mm`);
