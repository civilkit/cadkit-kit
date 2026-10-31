// The axis of a revolve, in words. The kernel takes ANY straight line of the sketch as the axis (construction or not: a profile
// edge that lies on the axis stays in the profile), so the GUI never asks the user to turn an edge into a construction line.
// With no axis chosen it uses the sketch's own vertical axis: a profile edge on it if there is one, else a construction line
// along it that is added to the sketch in the same edit (what `revolve(360)` of the script layer does).
import type { EditOp } from '@ck/session';
import { t } from './i18n';

type Feat = { id: string; type: string; [k: string]: unknown };
interface Pt { id: string; x: unknown; y: unknown }
interface Ent { id: string; type: string; p1?: string; p2?: string; construction?: boolean }
const EPS = 1e-6;

const ents = (sk: Feat): Ent[] => (sk.entities as Ent[] | undefined) ?? [];
const pts = (sk: Feat): Pt[] => (sk.points as Pt[] | undefined) ?? [];

/** A straight line of the sketch with its end points in sketch coordinates, or null when a point is not a plain number. */
function lineEnds(sk: Feat, e: Ent): { a: [number, number]; b: [number, number] } | null {
  if (e.type !== 'line') return null;
  const pa = pts(sk).find((p) => p.id === e.p1), pb = pts(sk).find((p) => p.id === e.p2);
  if (!pa || !pb || [pa.x, pa.y, pb.x, pb.y].some((v) => typeof v !== 'number')) return null;
  return { a: [pa.x as number, pa.y as number], b: [pb.x as number, pb.y as number] };
}
const onSketchY = (g: { a: number[]; b: number[] }): boolean => Math.abs(g.a[0]) < EPS && Math.abs(g.b[0]) < EPS && Math.abs(g.a[1] - g.b[1]) > EPS;
const onSketchX = (g: { a: number[]; b: number[] }): boolean => Math.abs(g.a[1]) < EPS && Math.abs(g.b[1]) < EPS && Math.abs(g.a[0] - g.b[0]) > EPS;
const num = (n: number): string => String(+n.toFixed(3));

/** How a line is named in the Axis list. */
export function axisLabel(sk: Feat, id: string): string {
  const e = ents(sk).find((x) => x.id === id);
  const g = e ? lineEnds(sk, e) : null;
  if (!e || !g) return id;
  const how = e.construction ? '' : ' ' + t('opt.axis.profileEdge');
  if (onSketchY(g)) return t('opt.axis.sketchY') + how;
  if (onSketchX(g)) return t('opt.axis.sketchX') + how;
  return t('opt.axis.line', { x1: num(g.a[0]), y1: num(g.a[1]), x2: num(g.b[0]), y2: num(g.b[1]) }) + how;
}

/** Every straight line of the sketch that can serve as the axis, as [id, words]. */
export function axisChoices(sk: Feat): Array<[string, string]> {
  return ents(sk).filter((e) => lineEnds(sk, e)).map((e): [string, string] => [e.id, axisLabel(sk, e.id)]);
}

/** The construction line of a sketch that serves as the revolve axis (the first one), or null. */
export function axisLine(sk: Feat): string | null {
  return ents(sk).find((x) => x.type === 'line' && x.construction)?.id ?? null;
}

const free = (taken: Set<string>, base: string): string => { let i = 0, id = base; while (taken.has(id)) id = base + ++i; taken.add(id); return id; };

/**
 * The axis a new revolve of this sketch gets, and the sketch edit that makes it exist (when it must be added).
 * Order: the sketch's construction line; a profile edge on the sketch's vertical axis; a new construction line along that axis.
 * Null when the sketch has nothing to revolve.
 */
export function defaultAxis(sk: Feat): { axis: string; sketch?: Feat } | null {
  const c = axisLine(sk);
  if (c) return { axis: c };
  const edge = ents(sk).find((e) => { const g = lineEnds(sk, e); return !!g && onSketchY(g); });
  if (edge) return { axis: edge.id };
  if (!ents(sk).some((e) => !e.construction)) return null;
  const taken = new Set([...pts(sk).map((p) => p.id), ...ents(sk).map((e) => e.id)]);
  const a = free(taken, 'axA'), b = free(taken, 'axB'), id = free(taken, 'axis');
  const next = { ...sk, points: [...pts(sk), { id: a, x: 0, y: 0 }, { id: b, x: 0, y: 10 }], entities: [...ents(sk), { id, type: 'line', p1: a, p2: b, construction: true }] };
  return { axis: id, sketch: next };
}

/** The edit for a new full revolve of the sketch: add the vertical axis line first when it has none. Null when there is nothing to revolve. */
export function revolveEdit(sk: Feat): EditOp[] | null {
  const d = defaultAxis(sk);
  if (!d) return null;
  const rev = { op: 'add' as const, feature: { type: 'revolve', op: 'add', sketch: sk.id, axis: d.axis, end: 'blind', angle: 360 } };
  return d.sketch ? [{ op: 'replace', id: sk.id, feature: d.sketch }, rev] : [rev];
}
