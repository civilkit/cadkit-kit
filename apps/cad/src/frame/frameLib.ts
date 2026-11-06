// The Frame tool's rules, without the DOM or the kernel: the profile library (profiles.json), the `frame` feature a choice of
// skeleton + profile makes, and the cut list and bill of materials from the kernel's per-member report (the regen reply's
// `frames`: stock length, cut angles, what each end meets, volume). CSV export of both.
import lib from './profiles.json';

export type Corner = 'mitre' | 'butt';
export interface FrameSection { kind: string; [dim: string]: number | string }
export interface FittingUse { id: string; per: 'joint' | 'freeEnd' | 'member'; qty: number }
export interface ProfileDef {
  id: string; label: string; family: string; material: string; corner?: Corner;
  section: FrameSection; fittings: FittingUse[];
  connectors?: Array<{ type: string; on: string; [k: string]: unknown }>;
}
export interface FittingDef { label: string; kind: string }
export interface MaterialDef { label: string; density: number }

export const PROFILES: ProfileDef[] = lib.profiles as unknown as ProfileDef[];
export const FITTINGS: Record<string, FittingDef> = lib.fittings;
export const MATERIALS: Record<string, MaterialDef> = lib.materials;
export const FAMILIES = [...new Set(PROFILES.map((p) => p.family))];

export const profileById = (id: string | undefined): ProfileDef | undefined => PROFILES.find((p) => p.id === id);

/** What the user chose in the Frame panel. */
export interface FrameParams {
  /** the skeleton sketch (its lines become members) */
  sketch: string | null;
  /** line entity ids to use; null: every line of the sketch */
  segments: string[] | null;
  profile: string;
  corner: Corner;
  /** turn of the section about each member, deg */
  rotate: number;
}
export const DEFAULT_FRAME: FrameParams = { sketch: null, segments: null, profile: 'tslot-2020', corner: 'butt', rotate: 0 };

interface DocLike { features: Array<{ id: string; type: string; name?: string; entities?: Array<{ type: string; id: string; construction?: boolean }> } & Record<string, unknown>> }

/** Sketches (planar or 3D) of the document holding at least one line: the skeletons a frame can follow. */
export function skeletons(doc: DocLike): Array<{ id: string; label: string; lines: string[] }> {
  const out = [];
  for (const f of doc.features) {
    if (f.type !== 'sketch' && f.type !== 'sketch3d') continue;
    const ents = (f.entities ?? (f as { sketch?: { entities?: DocLike['features'][0]['entities'] } }).sketch?.entities ?? []);
    const lines = ents.filter((e) => e.type === 'line' && !e.construction).map((e) => e.id);
    if (lines.length) out.push({ id: f.id, label: f.name ? `${f.name} (${f.id})` : f.id, lines });
  }
  return out;
}

/** The section the kernel builds for a library profile, with the id and label the cut list shows. */
export function sectionOf(p: ProfileDef): Record<string, unknown> {
  return { ...p.section, id: p.id, label: p.label };
}

/** A free feature id (F<n>) for the document. */
export function freeId(doc: DocLike): string {
  let n = doc.features.length + 1;
  const ids = new Set(doc.features.map((f) => f.id));
  while (ids.has('F' + n)) n++;
  return 'F' + n;
}

/** The `frame` feature for these choices; null while no skeleton is chosen or the profile is unknown. */
export function frameFeature(id: string, p: FrameParams): Record<string, unknown> | null {
  const prof = profileById(p.profile);
  if (!p.sketch || !prof) return null;
  return {
    type: 'frame', id, sketch: p.sketch, profile: sectionOf(prof), corner: p.corner,
    ...(p.rotate ? { rotate: p.rotate } : {}),
    ...(p.segments ? { segments: p.segments } : {}),
  };
}

/** The panel's choices read back from a `frame` feature (Edit), or null when it is not one the panel can describe. */
export function paramsFromFeature(f: Record<string, unknown> | undefined): FrameParams | null {
  if (!f || f.type !== 'frame' || typeof f.sketch !== 'string') return null;
  const prof = f.profile as { id?: string } | undefined;
  if (!profileById(prof?.id)) return null;
  return {
    sketch: f.sketch, segments: Array.isArray(f.segments) ? (f.segments as string[]) : null, profile: prof!.id!,
    corner: f.corner === 'butt' ? 'butt' : 'mitre', rotate: typeof f.rotate === 'number' ? f.rotate : 0,
  };
}

/** Add or (edit) replace ops for the session. */
export function frameOps(feature: Record<string, unknown>, replace: boolean): Array<Record<string, unknown>> {
  return replace ? [{ op: 'replace', id: feature.id, feature }] : [{ op: 'add', feature }];
}

/** One member of the kernel's report (`frames[i].members[j]`). */
export interface MemberReport {
  segment: string; body: string; profile: string; label: string;
  length: number; angles: [number, number]; ends: [string, string]; volume: number;
}
export interface FrameReport { id: string; members: MemberReport[] }

/** One cut list line: identical pieces (same stock, length and cut angles to 0.1 mm / 0.1 deg) counted together. */
export interface CutLine { profile: string; label: string; length: number; angles: [number, number]; qty: number; members: string[]; massKg: number }
export interface BomLine { kind: 'stock' | 'fitting'; id: string; label: string; qty: number; unit: string; detail: string }

const r1 = (v: number): number => Math.round(v * 10) / 10;

/** Group equal pieces. Angles are stored small-first so a piece cut 45/0 and one cut 0/45 are the same piece (it turns over). */
export function cutList(frames: FrameReport[]): CutLine[] {
  const lines = new Map<string, CutLine>();
  for (const fr of frames) for (const m of fr.members) {
    const prof = profileById(m.profile);
    const ang = [r1(m.angles[0]), r1(m.angles[1])].sort((a, b) => a - b) as [number, number];
    const key = [m.profile, r1(m.length), ang[0], ang[1]].join('|');
    const density = MATERIALS[prof?.material ?? '']?.density ?? 0;
    const at = lines.get(key) ?? { profile: m.profile, label: m.label || prof?.label || m.profile, length: r1(m.length), angles: ang, qty: 0, members: [], massKg: 0 };
    at.qty++;
    at.members.push(m.body);
    at.massKg += m.volume * density;
    lines.set(key, at);
  }
  return [...lines.values()].sort((a, b) => a.label.localeCompare(b.label) || b.length - a.length);
}

/** How many joints of a member's own profile each end stands for: a butt or tee end is one joint, a mitre or in-line end half of one (the other half is the member it meets), the end that runs through none. */
const jointShare = (end: string): number => (end === 'butt' || end === 'tee' ? 1 : end === 'mitre' || end === 'inline' ? 0.5 : 0);

/** The bill of materials: stock per profile (pieces, total length, mass) and the fittings its library entry calls for. */
export function bom(frames: FrameReport[]): BomLine[] {
  const stock = new Map<string, { label: string; pieces: number; length: number; mass: number }>();
  const fit = new Map<string, number>();
  for (const fr of frames) for (const m of fr.members) {
    const prof = profileById(m.profile);
    const density = MATERIALS[prof?.material ?? '']?.density ?? 0;
    const s = stock.get(m.profile) ?? { label: m.label || prof?.label || m.profile, pieces: 0, length: 0, mass: 0 };
    s.pieces++; s.length += m.length; s.mass += m.volume * density;
    stock.set(m.profile, s);
    if (!prof) continue;
    const joints = jointShare(m.ends[0]) + jointShare(m.ends[1]);
    const free = m.ends.filter((e) => e === 'free').length;
    for (const u of prof.fittings) {
      const n = u.per === 'joint' ? joints : u.per === 'freeEnd' ? free : 1;
      if (n) fit.set(u.id, (fit.get(u.id) ?? 0) + n * u.qty);
    }
  }
  const out: BomLine[] = [];
  for (const [id, s] of stock) {
    const prof = profileById(id);
    const mat = MATERIALS[prof?.material ?? '']?.label ?? '';
    out.push({ kind: 'stock', id, label: s.label, qty: s.pieces, unit: 'pcs', detail: `${r1(s.length)} mm total${mat ? ', ' + mat : ''}${s.mass ? `, ${Math.round(s.mass * 1000) / 1000} kg` : ''}` });
  }
  for (const [id, n] of fit) out.push({ kind: 'fitting', id, label: FITTINGS[id]?.label ?? id, qty: Math.ceil(n - 1e-9), unit: FITTINGS[id]?.kind === 'process' ? 'joints' : 'pcs', detail: FITTINGS[id]?.kind ?? '' });
  return out;
}

const csvCell = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells: Array<string | number>): string => cells.map(csvCell).join(',');

/** Cut list then bill of materials, one CSV text (a blank line between the two tables). */
export function toCsv(frames: FrameReport[]): string {
  const rows = [csvRow(['Item', 'Profile', 'Length (mm)', 'Angle 1 (deg)', 'Angle 2 (deg)', 'Qty', 'Mass each (kg)', 'Members'])];
  cutList(frames).forEach((l, i) => rows.push(csvRow([i + 1, l.label, l.length, l.angles[0], l.angles[1], l.qty, Math.round((l.massKg / l.qty) * 1000) / 1000, l.members.join(' ')])));
  rows.push('');
  rows.push(csvRow(['Item', 'Part', 'Qty', 'Unit', 'Detail']));
  bom(frames).forEach((b, i) => rows.push(csvRow([i + 1, b.label, b.qty, b.unit, b.detail])));
  return rows.join('\n') + '\n';
}

/** The `frames` list of a regen reply, typed (anything malformed is left out). */
export function readFrames(raw: unknown): FrameReport[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is FrameReport => !!f && typeof (f as FrameReport).id === 'string' && Array.isArray((f as FrameReport).members));
}
