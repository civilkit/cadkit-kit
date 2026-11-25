// The mate kinds the editor offers, as ONE table. A row says which references the kind takes (a, b, a2, b2, c; some optional), which numeric
// fields (stored on the feature under `key`), whether it has a Flip switch (and what the switch means), and whether the kernel solves it yet
// (`pending`, with a reason string `asm.mate.pending.<id>`). The editor, the list, the feature builder and the validation all read the row.
//
// A mate feature is `{type:'mate', kind, a, b, [a2, b2, c], flip?, <numeric fields>, [of], [dir]}`; every reference is a face name. Angles are
// degrees. See docs/spec-agent-interface.md "Assembly mates and the degrees-of-freedom report" in the kernel repo for the field meanings.

export type RefAccept = 'face' | 'edge' | 'connector';
export type RefKey = 'a' | 'b' | 'a2' | 'b2' | 'c';
export const REF_KEYS: RefKey[] = ['a', 'b', 'a2', 'b2', 'c'];
export interface MateConnectorRef { kind: 'connector'; id: string; component?: string }
export const isConnectorRef = (v: unknown): v is MateConnectorRef =>
  !!v && typeof v === 'object' && (v as { kind?: unknown }).kind === 'connector' && typeof (v as { id?: unknown }).id === 'string';
export const encodeConnectorRef = (r: MateConnectorRef): string => `${r.component ?? ''}:${r.id}`;
export function decodeConnectorRef(s: string): MateConnectorRef {
  const i = s.indexOf(':');
  if (i < 0) return { kind: 'connector', id: s };
  const component = s.slice(0, i), id = s.slice(i + 1);
  return component ? { kind: 'connector', id, component } : { kind: 'connector', id };
}
export interface MateRef { key: RefKey; /** string key of the label: asm.mate.ref.<label> */ label: string; accept: RefAccept[]; optional?: boolean }
export interface MateParam {
  key: string; type: 'length' | 'angle' | 'number'; default: number; label: string;
  /** the value is not required (left out of the feature when empty) */
  optional?: boolean;
  /** this number is the drive of a coupling: the editor adds a test slider that previews the motion */
  drive?: boolean;
  /** one component of a vector field (`dir` = [x, y, z] or `offset` = [dx, dy, dz]); written as one array when set */
  vec?: { key: string; i: 0 | 1 | 2; allowZero?: boolean };
}
export interface MateChoice { key: string; values: string[]; default: string }
export interface MateKindDef {
  id: string;
  group: 'connector' | 'standard' | 'advanced' | 'mechanical';
  /** a one-glyph icon for the list and the kind menu */
  icon: string;
  refs: MateRef[];
  params: MateParam[];
  /** a text choice stored under its key (limits: of = distance | angle) */
  choice?: MateChoice;
  /** the kind has a Flip switch; its label is asm.mate.flip.<id> when `flipLabel`, else asm.mate.flip */
  flip: boolean;
  flipLabel?: boolean;
  /** the kernel does not solve this kind yet: shown, not offered (reason: asm.mate.pending.<id>) */
  pending: boolean;
}

const AB = (label = 'face'): MateRef[] => [{ key: 'a', label, accept: ['face'] }, { key: 'b', label, accept: ['face'] }];
const CONN_AB = (): MateRef[] => [{ key: 'a', label: 'connector', accept: ['connector'] }, { key: 'b', label: 'connector', accept: ['connector'] }];
const row = (id: string, group: MateKindDef['group'], icon: string, o: Partial<MateKindDef> = {}): MateKindDef => ({ id, group, icon, refs: AB(), params: [], flip: true, pending: false, ...o });
const P = (key: string, type: MateParam['type'], def: number, o: Partial<MateParam> = {}): MateParam => ({ key, type, default: def, label: key, ...o });
const DRIVE: MateParam = P('angle', 'angle', NaN, { drive: true, optional: true });
const CONN_MODS: MateParam[] = [
  P('offx', 'length', NaN, { optional: true, vec: { key: 'offset', i: 0, allowZero: true } }),
  P('offy', 'length', NaN, { optional: true, vec: { key: 'offset', i: 1, allowZero: true } }),
  P('offz', 'length', NaN, { optional: true, vec: { key: 'offset', i: 2, allowZero: true } }),
  P('rotateZ', 'angle', NaN, { optional: true }),
];
const pend = (id: string, group: MateKindDef['group'], icon: string, o: Partial<MateKindDef> = {}): MateKindDef => row(id, group, icon, { pending: true, ...o });

export const MATE_KINDS: MateKindDef[] = [
  row('fastened', 'connector', '\u229E', { refs: CONN_AB(), params: [...CONN_MODS] }),
  row('revolute', 'connector', '\u21BA', { refs: CONN_AB(), params: [...CONN_MODS, P('min', 'angle', NaN, { optional: true }), P('max', 'angle', NaN, { optional: true })] }),
  row('slider', 'connector', '\u21C5', { refs: CONN_AB(), params: [...CONN_MODS, P('min', 'length', NaN, { optional: true }), P('max', 'length', NaN, { optional: true })] }),
  row('cylindrical', 'connector', '\u27F3', { refs: CONN_AB(), params: [...CONN_MODS] }),
  row('planar', 'connector', '\u25A1', { refs: CONN_AB(), params: [...CONN_MODS] }),
  row('coincident', 'standard', '\u2550'),
  row('parallel', 'standard', '\u2225'),
  row('concentric', 'standard', '\u25CE', { refs: AB('axis') }),
  row('distance', 'standard', '\u2194', { params: [P('distance', 'length', 0)] }),
  row('angle', 'standard', '\u2220', { params: [P('angle', 'angle', 90)], flipLabel: true }),
  row('perpendicular', 'standard', '\u27C2', { flip: false }),
  row('tangent', 'standard', '\u25D2', { flipLabel: true }),
  row('lock', 'standard', '\u{1F512}', { flip: false }),
  row('symmetric', 'advanced', '\u2AFD', { flip: false, refs: [...AB(), { key: 'c', label: 'plane', accept: ['face'] }] }),
  row('width', 'advanced', '\u21E5', {
    flip: false,
    refs: [{ key: 'a', label: 'tab1', accept: ['face'] }, { key: 'a2', label: 'tab2', accept: ['face'] }, { key: 'b', label: 'slot1', accept: ['face'] }, { key: 'b2', label: 'slot2', accept: ['face'] }],
  }),
  row('limits', 'advanced', '\u21A6', { flip: false, choice: { key: 'of', values: ['distance', 'angle'], default: 'distance' }, params: [P('min', 'number', 0), P('max', 'number', 10)] }),
  row('hinge', 'mechanical', '\u21BB', {
    flip: false, refs: [...AB('axis'), { key: 'a2', label: 'stop', accept: ['face'], optional: true }, { key: 'b2', label: 'stop', accept: ['face'], optional: true }],
    params: [P('distance', 'length', NaN, { optional: true })],
  }),
  row('slot', 'mechanical', '\u2554', { refs: [{ key: 'a', label: 'pin', accept: ['face'] }, { key: 'b', label: 'wall', accept: ['face'] }, { key: 'b2', label: 'wall', accept: ['face'], optional: true }] }),
  row('screw', 'mechanical', '\u{1F529}', { refs: AB('axis'), flipLabel: true, params: [P('pitch', 'length', 1.5), DRIVE] }),
  row('gear', 'mechanical', '\u2699', { refs: AB('axis'), flipLabel: true, params: [P('ratio', 'number', 1), DRIVE] }),
  row('rackPinion', 'mechanical', '\u21C4', {
    refs: [{ key: 'a', label: 'pinion', accept: ['face'] }, { key: 'b', label: 'rack', accept: ['face'] }],
    params: [P('radius', 'length', 10), DRIVE, P('dirx', 'number', NaN, { optional: true, vec: { key: 'dir', i: 0 } }), P('diry', 'number', NaN, { optional: true, vec: { key: 'dir', i: 1 } }), P('dirz', 'number', NaN, { optional: true, vec: { key: 'dir', i: 2 } })],
  }),
  // announced, not solved by the kernel yet
  pend('profileCenter', 'standard', '\u2295'),
  pend('path', 'advanced', '\u3030'),
  pend('linearCoupler', 'advanced', '\u2921'),
  pend('cam', 'mechanical', '\u25D1'),
  pend('universalJoint', 'mechanical', '\u2715'),
];

export const mateKind = (id: string): MateKindDef | undefined => MATE_KINDS.find((k) => k.id === id);
export const isConnectorMateKind = (id: string): boolean => mateKind(id)?.group === 'connector';
export const offeredKinds = (): MateKindDef[] => MATE_KINDS.filter((k) => !k.pending);
export const KIND_GROUPS: MateKindDef['group'][] = ['connector', 'standard', 'advanced', 'mechanical'];

/** What the editor holds while a mate is made or edited. */
export interface MateDraft { kind: string; refs: Partial<Record<RefKey, string>>; flip: boolean; params: Record<string, number>; choice: string; name: string }

export function newDraft(kind = 'coincident'): MateDraft {
  const k = mateKind(kind) ?? MATE_KINDS[0];
  return { kind: k.id, refs: {}, flip: false, params: Object.fromEntries(k.params.map((p) => [p.key, p.default])), choice: k.choice?.default ?? '', name: '' };
}

/** The draft of an existing mate feature. Unknown kinds keep their references and no parameters. */
export function draftOf(f: Record<string, unknown>): MateDraft {
  const k = mateKind(String(f.kind ?? 'coincident'));
  const d = newDraft(k?.id ?? 'coincident');
  for (const r of REF_KEYS) {
    if (typeof f[r] === 'string') d.refs[r] = f[r] as string;
    else if (isConnectorRef(f[r])) d.refs[r] = encodeConnectorRef(f[r] as MateConnectorRef);
  }
  d.flip = f.flip === true;
  for (const p of k?.params ?? []) {
    if (p.vec) {
      const v = f[p.vec.key];
      if (Array.isArray(v) && typeof v[p.vec.i] === 'number') d.params[p.key] = v[p.vec.i] as number;
      else if (p.vec.allowZero && typeof v === 'number' && Number.isFinite(v)) d.params[p.key] = p.vec.i === 2 ? v : 0;
    } else if (typeof f[p.key] === 'number') d.params[p.key] = f[p.key] as number;
  }
  if (k?.choice && typeof f[k.choice.key] === 'string') d.choice = f[k.choice.key] as string;
  d.name = typeof f.name === 'string' ? f.name : '';
  return d;
}

const vecSet = (d: MateDraft, key: string): number[] | null => {
  const k = mateKind(d.kind);
  const ps = (k?.params ?? []).filter((p) => p.vec?.key === key).sort((p, q) => p.vec!.i - q.vec!.i);
  if (ps.length !== 3) return null;
  if (ps[0].vec?.allowZero) {
    const vals = ps.map((p) => (Number.isFinite(d.params[p.key]) ? d.params[p.key] : 0));
    return vals.some((x) => x !== 0) ? vals : null;
  }
  const comps = ps.map((p) => d.params[p.key]);
  return comps.every((x) => Number.isFinite(x)) ? comps : null;
};

/** Why the draft cannot be applied yet (an i18n key), or null. */
export function draftProblem(d: MateDraft): string | null {
  const k = mateKind(d.kind);
  if (!k) return 'asm.mate.err.kind';
  if (k.pending) return 'asm.mate.err.pending';
  for (const r of k.refs) if (!r.optional && !d.refs[r.key]) return 'asm.mate.err.refs';
  const vals = k.refs.map((r) => d.refs[r.key]).filter((x): x is string => !!x);
  if (new Set(vals).size !== vals.length) return 'asm.mate.err.same';
  for (const p of k.params) if (!p.optional && !Number.isFinite(d.params[p.key])) return 'asm.mate.err.value';
  const vecs = (k.params.filter((p) => p.vec && !p.vec.allowZero).map((p) => p.vec!.key));
  for (const key of new Set(vecs)) {
    const given = k.params.filter((p) => p.vec?.key === key && Number.isFinite(d.params[p.key])).length;
    if (given !== 0 && given !== 3) return 'asm.mate.err.vec';
    if (given === 3 && !vecSet(d, key)!.some((x) => x !== 0)) return 'asm.mate.err.vec';
  }
  const v = d.params;
  if (k.id === 'gear' && v.ratio === 0) return 'asm.mate.err.ratio';
  if (k.id === 'screw' && v.pitch === 0) return 'asm.mate.err.pitch';
  if (k.id === 'rackPinion' && !(v.radius > 0)) return 'asm.mate.err.radius';
  if ((k.id === 'limits' || k.id === 'revolute' || k.id === 'slider') && Number.isFinite(v.min) && Number.isFinite(v.max) && v.min > v.max) return 'asm.mate.err.range';
  return null;
}

/** The `mate` feature of a draft (without id: the session numbers it). */
export function mateFeature(d: MateDraft): Record<string, unknown> {
  const k = mateKind(d.kind)!;
  const f: Record<string, unknown> = { type: 'mate', kind: d.kind };
  if (d.name.trim()) f.name = d.name.trim();
  for (const r of k.refs) {
    const val = d.refs[r.key];
    if (!val) continue;
    f[r.key] = r.accept.includes('connector') ? decodeConnectorRef(val) : val;
  }
  if (k.flip) f.flip = d.flip;
  if (k.choice) f[k.choice.key] = d.choice;
  for (const p of k.params) {
    if (p.vec) continue;
    if (p.optional && !Number.isFinite(d.params[p.key])) continue;
    f[p.key] = d.params[p.key];
  }
  for (const key of new Set(k.params.filter((p) => p.vec).map((p) => p.vec!.key))) { const v = vecSet(d, key); if (v) f[key] = v; }
  return f;
}

/** `set` paths and values that turn feature `old` into the draft (only what differs), as `{path, value}`. */
export function mateChanges(old: Record<string, unknown>, d: MateDraft): Array<{ path: string; value: unknown }> {
  const next = mateFeature(d);
  const out: Array<{ path: string; value: unknown }> = [];
  for (const [path, value] of Object.entries(next)) if (path !== 'type' && JSON.stringify(old[path]) !== JSON.stringify(value)) out.push({ path, value });
  return out;
}

/** True when turning `old` into the draft drops a field (an optional reference or number was cleared): a `set` cannot do that, the feature is replaced. */
export function mateDropsField(old: Record<string, unknown>, d: MateDraft): boolean {
  const next = mateFeature(d);
  const k = mateKind(d.kind);
  const keys = [...(k?.refs.map((r) => r.key as string) ?? []), ...(k?.params.map((p) => p.vec?.key ?? p.key) ?? [])];
  return keys.some((key) => old[key] !== undefined && next[key] === undefined);
}

/** Does `of: "angle"` apply (limits) or is the kind `revolute`: its min / max are degrees. */
export const limitsAreAngles = (d: MateDraft): boolean => (d.kind === 'limits' && d.choice === 'angle') || d.kind === 'revolute';
