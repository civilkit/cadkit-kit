// The colours a SolidCraft file keeps per body (`appearances.bodies[name]`: colour 0-255, opacity, and in newer files `pbr`: metallic / roughness / ior)
// and which bodies it hides (`visibility.hidden_bodies`), as the part's `appearance` and `view` fields. Both are keyed by the feature that made the body
// (the app's rule: a feature id covers every body that feature made), because the face names of a body are not known until the part is built.
type Rec = Record<string, unknown>;

export interface ScLook { color?: string; opacity?: number; metallic?: number; roughness?: number }
export interface ScLooks { appearance?: Record<string, ScLook>; view?: { hiddenBodies: string[] } }

const hex = (c: unknown): string | undefined => {
  if (!Array.isArray(c) || c.length < 3 || !c.slice(0, 3).every((v) => typeof v === 'number' && isFinite(v))) return undefined;
  return '#' + c.slice(0, 3).map((v) => Math.round(Math.min(255, Math.max(0, v as number))).toString(16).padStart(2, '0')).join('');
};
const unit = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined);

/** `features` are the converted features (a body is made by the first one that carries its name in `body`); `live` are the bodies still alive at the end. */
export function bodyLooks(doc: Rec, features: readonly Rec[], live: readonly string[]): ScLooks {
  const bodies = ((doc.appearances as Rec | undefined)?.bodies ?? {}) as Record<string, Rec>;
  const names = Object.keys(bodies);
  const madeBy = new Map<string, string>();
  for (const f of features) if (typeof f.body === 'string' && typeof f.id === 'string' && !madeBy.has(f.body)) madeBy.set(f.body, f.id);
  // a file of one body keeps the plain output (nothing is named): its one entry belongs to the first feature that adds material
  if (!madeBy.size && names.length === 1) {
    const first = features.find((f) => f.op === 'add' && typeof f.id === 'string');
    if (first) madeBy.set(names[0], first.id as string);
  }
  const out: ScLooks = {};
  const appearance: Record<string, ScLook> = {};
  for (const name of names) {
    const id = madeBy.get(name);
    if (!id) continue;
    const b = bodies[name] ?? {};
    const look: ScLook = {};
    const c = hex(b.color); if (c) look.color = c;
    if (typeof b.opacity === 'number' && b.opacity < 1) look.opacity = Math.max(0.05, b.opacity);
    const pbr = (b.pbr && typeof b.pbr === 'object' ? b.pbr : null) as Rec | null;
    const m = unit(pbr?.metallic), r = unit(pbr?.roughness);
    if (m !== undefined) look.metallic = m;
    if (r !== undefined) look.roughness = r;
    if (Object.keys(look).length) appearance[id] = look;
  }
  if (Object.keys(appearance).length) out.appearance = appearance;
  const hidden = ((doc.visibility as Rec | undefined)?.hidden_bodies ?? []) as unknown[];
  const ids = [...new Set(hidden.filter((n): n is string => typeof n === 'string' && live.includes(n)).map((n) => madeBy.get(n)).filter((i): i is string => !!i))];
  if (ids.length) out.view = { hiddenBodies: ids };
  return out;
}
