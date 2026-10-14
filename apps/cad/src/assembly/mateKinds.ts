// The mate kinds the editor offers, as ONE table. Adding a kind the kernel learns (hinge, slot, screw, gear, rackPinion, lock, tangent,
// symmetric, width, limits, ...) is adding a row here and its strings in locales/assembly.ts; the editor, the list, the feature builder
// and the validation all read the row. Set `pending: false` once the kernel solves the kind.
//
// A mate feature is `{type:'mate', kind, a, b, [c], flip?, <param keys>}`. Today's kernel (ck-model MateKind) reads `kind`, `a`, `b`,
// `distance` and `flip`; every reference is a face name. A kind that is not in its list parses as `Unknown` and the feature fails.

export type RefAccept = 'face' | 'edge';
export interface MateRef { key: 'a' | 'b' | 'c'; /** string key of the label: asm.mate.ref.<label> */ label: string; accept: RefAccept[] }
export interface MateParam { key: string; type: 'length' | 'angle' | 'number'; default: number; label: string }
export interface MateKindDef {
  id: string;
  group: 'standard' | 'advanced' | 'mechanical';
  refs: MateRef[];
  params: MateParam[];
  /** the kind has a Flip (aligned / opposed) switch */
  flip: boolean;
  /** the kernel does not solve this kind yet: shown, not offered */
  pending: boolean;
}

const AB = (label = 'face'): MateRef[] => [{ key: 'a', label, accept: ['face'] }, { key: 'b', label, accept: ['face'] }];
const row = (id: string, group: MateKindDef['group'], o: Partial<MateKindDef> = {}): MateKindDef => ({ id, group, refs: AB(), params: [], flip: true, pending: true, ...o });
const DISTANCE: MateParam = { key: 'distance', type: 'length', default: 0, label: 'distance' };
const ANGLE: MateParam = { key: 'angle', type: 'angle', default: 90, label: 'angle' };

export const MATE_KINDS: MateKindDef[] = [
  // what the kernel solves today
  row('coincident', 'standard', { pending: false }),
  row('parallel', 'standard', { pending: false }),
  row('concentric', 'standard', { pending: false, refs: AB('axis') }),
  row('distance', 'standard', { pending: false, params: [DISTANCE] }),
  row('angle', 'standard', { params: [ANGLE] }),   // kernel parses it, its solver answers mateGeometry today
  // announced kernel kinds
  row('perpendicular', 'standard'),
  row('tangent', 'standard'),
  row('lock', 'standard', { flip: false }),
  row('symmetric', 'advanced', { refs: [...AB(), { key: 'c', label: 'plane', accept: ['face'] }] }),
  row('width', 'advanced', { refs: [...AB(), { key: 'c', label: 'face', accept: ['face'] }] }),
  row('limits', 'advanced', { params: [{ key: 'min', type: 'length', default: 0, label: 'min' }, { key: 'max', type: 'length', default: 10, label: 'max' }] }),
  row('hinge', 'mechanical', { refs: AB('axis') }),
  row('slot', 'mechanical', { refs: AB('axis') }),
  row('screw', 'mechanical', { refs: AB('axis'), params: [{ key: 'pitch', type: 'length', default: 1.5, label: 'pitch' }] }),
  row('gear', 'mechanical', { refs: AB('axis'), params: [{ key: 'ratio', type: 'number', default: 1, label: 'ratio' }] }),
  row('rackPinion', 'mechanical', { refs: AB('axis'), params: [{ key: 'ratio', type: 'number', default: 1, label: 'ratio' }] }),
];

export const mateKind = (id: string): MateKindDef | undefined => MATE_KINDS.find((k) => k.id === id);
export const offeredKinds = (): MateKindDef[] => MATE_KINDS.filter((k) => !k.pending);
export const KIND_GROUPS: MateKindDef['group'][] = ['standard', 'advanced', 'mechanical'];

/** What the editor holds while a mate is made or edited. */
export interface MateDraft { kind: string; refs: Partial<Record<'a' | 'b' | 'c', string>>; flip: boolean; params: Record<string, number>; name: string }

export function newDraft(kind = 'coincident'): MateDraft {
  const k = mateKind(kind) ?? MATE_KINDS[0];
  return { kind: k.id, refs: {}, flip: false, params: Object.fromEntries(k.params.map((p) => [p.key, p.default])), name: '' };
}

/** The draft of an existing mate feature. Unknown kinds keep their references and no parameters. */
export function draftOf(f: Record<string, unknown>): MateDraft {
  const k = mateKind(String(f.kind ?? 'coincident'));
  const d = newDraft(k?.id ?? 'coincident');
  for (const r of ['a', 'b', 'c'] as const) if (typeof f[r] === 'string') d.refs[r] = f[r] as string;
  d.flip = f.flip === true;
  for (const p of k?.params ?? []) if (typeof f[p.key] === 'number') d.params[p.key] = f[p.key] as number;
  d.name = typeof f.name === 'string' ? f.name : '';
  return d;
}

/** Why the draft cannot be applied yet (an i18n key), or null. */
export function draftProblem(d: MateDraft): string | null {
  const k = mateKind(d.kind);
  if (!k) return 'asm.mate.err.kind';
  if (k.pending) return 'asm.mate.err.pending';
  for (const r of k.refs) if (!d.refs[r.key]) return 'asm.mate.err.refs';
  const vals = k.refs.map((r) => d.refs[r.key]);
  if (new Set(vals).size !== vals.length) return 'asm.mate.err.same';
  for (const p of k.params) if (!Number.isFinite(d.params[p.key])) return 'asm.mate.err.value';
  return null;
}

/** The `mate` feature of a draft (without id: the session numbers it). */
export function mateFeature(d: MateDraft): Record<string, unknown> {
  const k = mateKind(d.kind)!;
  const f: Record<string, unknown> = { type: 'mate', kind: d.kind };
  if (d.name.trim()) f.name = d.name.trim();
  for (const r of k.refs) f[r.key] = d.refs[r.key];
  if (k.flip) f.flip = d.flip;
  for (const p of k.params) f[p.key] = d.params[p.key];
  return f;
}

/** `set` paths and values that turn feature `old` into the draft (only what differs), as `{path, value}`. */
export function mateChanges(old: Record<string, unknown>, d: MateDraft): Array<{ path: string; value: unknown }> {
  const next = mateFeature(d);
  const out: Array<{ path: string; value: unknown }> = [];
  for (const [path, value] of Object.entries(next)) if (path !== 'type' && JSON.stringify(old[path]) !== JSON.stringify(value)) out.push({ path, value });
  return out;
}
