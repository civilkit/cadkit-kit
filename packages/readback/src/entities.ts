// What a tool caller may name in `a` / `b`: a body (its name or 1-based number from `bodies`), a face name, an edge key, a vertex (V3) or a point [x, y, z].
// Bodies become the list of their faces for the kernel (`{faces: [...]}`), which accepts every entity as the distance query defines them.
import { ReadbackError } from './errors';

/** What the kernel's measurement queries take as an entity. */
export type MeasureEntity = string | number[] | Record<string, unknown> | Array<string | number[] | Record<string, unknown>>;

/** A body of the open document as the readback tools need it: the name `bodies` shows, its key and the faces it owns. */
export interface BodyRef { name: string; key: string; faces: string[]; volume?: number | null }

export interface Resolved { entity: MeasureEntity; label: string; body?: BodyRef; kind: 'body' | 'point' | 'name' }

export const bodyList = (bodies: readonly BodyRef[]): string => (bodies.length ? bodies.map((b, i) => `${i + 1}: ${b.name}`).join(', ') : '(no bodies)');

const isPoint = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** One entity spec to the kernel's entity; throws `no_such_body` for a body number out of range. */
export function resolveEntity(spec: unknown, bodies: readonly BodyRef[]): Resolved {
  if (isPoint(spec)) return { entity: spec, label: `[${spec.map((x) => Math.round(x * 1e4) / 1e4).join(', ')}]`, kind: 'point' };
  if (typeof spec === 'number') {
    const b = bodies[spec - 1];
    if (!b) throw new ReadbackError('no_such_body', `there is no body number ${spec}`, `bodies: ${bodyList(bodies)}`);
    return { entity: { faces: b.faces }, label: b.name, body: b, kind: 'body' };
  }
  if (typeof spec === 'string') {
    const s = spec.trim();
    const lower = s.toLowerCase();
    const b = bodies.find((x) => x.name === s) ?? bodies.find((x) => x.key === s) ?? bodies.find((x) => x.name.toLowerCase() === lower);
    if (b) return { entity: { faces: b.faces }, label: b.name, body: b, kind: 'body' };
    if (!s) throw new ReadbackError('bad_input', 'an empty entity name', 'name a body (see bodies), a face such as F2.C1, an edge key, a vertex V3 or a point [x, y, z]');
    return { entity: s, label: s, kind: 'name' };
  }
  if (Array.isArray(spec) && spec.length && spec.every((x) => typeof x === 'string')) {
    const parts = (spec as string[]).map((x) => resolveEntity(x, bodies));
    return { entity: parts.map((p) => p.entity) as MeasureEntity, label: parts.map((p) => p.label).join(' + '), kind: 'name' };
  }
  throw new ReadbackError('bad_input', 'an entity is a body name or number, a face / edge / vertex name or a point [x, y, z]', `bodies: ${bodyList(bodies)}`);
}

/** Which body owns each face name. */
export const faceOwners = (bodies: readonly BodyRef[]): Map<string, BodyRef> => {
  const m = new Map<string, BodyRef>();
  for (const b of bodies) for (const f of b.faces) m.set(f, b);
  return m;
};
