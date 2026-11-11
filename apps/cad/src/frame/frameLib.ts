// The Frame tool's rules, without the DOM or the kernel: the profile library (profiles.json), the `frame` feature a choice of
// skeleton + profile makes, and the cut list and bill of materials from the kernel's per-member report (the regen reply's
// `frames`: stock length, cut angles, what each end meets, volume, and the hardware the kernel placed). CSV export of both.
import { alignedText, csvText } from '../tableText';
import lib from './profiles.json';
import { findMaterial, type MaterialDef as CatalogueMaterial } from '../materials';

export type Corner = 'mitre' | 'butt';
export interface FrameSection { kind: string; [dim: string]: number | string }
export interface FittingUse { id: string; per: 'joint' | 'freeEnd' | 'member'; qty: number }
/** Where a catalogue profile's figures come from: the document, the table and whether the row was checked against the published text. */
export interface ProfileSource { document: string; table?: string; verified: boolean; note?: string }
export type Region = 'AU' | 'US' | 'EU';
export interface ProfileDef {
  id: string; label: string; family: string; material: string; corner?: Corner;
  /** where the stock is made to: `AU`, `US`; none for generic stock, T-slot and the user's own */
  region?: Region;
  /** the product standard (AS/NZS 1163, AS/NZS 3679.1, ASTM A500, EN 10210) and steel grade, shown in the bill of materials */
  standard?: string; grade?: string;
  /** the catalogue designation (150UB14.0, HSS2X2X1/4, IPE 300); US sections also carry the metric designation (W360X44) */
  designation?: string; designation_metric?: string;
  /** the grade in the Material editor's catalogue (materials.ts) this stock is made of by default, and whether that choice is a default to confirm rather than a published fact */
  material_ref?: string; material_default?: boolean;
  /** EU hollow sections: `hot-finished` (EN 10210) or `cold-formed` (EN 10219); `check_availability`: the catalogue marks the size as to be checked with the mill */
  manufacturing?: string; check_availability?: boolean;
  /** published mass per metre of stock (kg/m); the cut list and bill of materials use it for the mass when present */
  mass_per_m_kg?: number;
  source?: ProfileSource;
  section: FrameSection; fittings: FittingUse[];
  connectors?: Array<{ type: string; on: string; [k: string]: unknown }>;
  /** fitting ids offered for each place, the first is the default: `joint` (brackets, gussets), `cap` (free ends), `foot` (free lower ends of legs) */
  hardware?: Partial<Record<HwPlace, string[]>>;
}
export type HwPlace = 'joint' | 'corner3' | 'cap' | 'foot';
export const HW_PLACES: HwPlace[] = ['joint', 'corner3', 'cap', 'foot'];
/** `part` is what the kernel builds the fitting from (see `partSpec`); a fitting without one is counted in the BOM only. */
export interface FittingDef { label: string; kind: string; spec?: string; part?: Record<string, unknown> }
export interface MaterialDef { label: string; density: number }

/** A regional catalogue file (profiles.au.json, profiles.us.json, profiles.eu.json) is stored compactly: material and weld fittings are defaults, a source is a short reference. */
interface CatalogueFile { defaults: { material: string; fittings: FittingUse[] }; sources: Record<string, { document: string; note?: string }>; fittings: Record<string, FittingDef>; profiles: Array<Record<string, unknown>> }
function expandCatalogue(f: CatalogueFile): { profiles: ProfileDef[]; fittings: Record<string, FittingDef> } {
  const profiles = f.profiles.map((raw) => {
    const src = raw.source as { ref: string; table?: string; verified: boolean };
    const cite = f.sources[src.ref];
    return { material: f.defaults.material, fittings: f.defaults.fittings, ...raw, source: { document: cite.document, table: src.table, verified: src.verified, ...(cite.note ? { note: cite.note } : {}) } } as unknown as ProfileDef;
  });
  return { profiles, fittings: f.fittings };
}

export const PROFILES: ProfileDef[] = [...(lib.profiles as unknown as ProfileDef[])];
export const FITTINGS: Record<string, FittingDef> = { ...lib.fittings } as Record<string, FittingDef>;
export const MATERIALS: Record<string, MaterialDef> = lib.materials;
export const FAMILIES = [...new Set(PROFILES.map((p) => p.family))];

/** Add your own stock and fittings to the library (same shapes as profiles.json); an existing id is replaced. */
export function extendLibrary(more: { profiles?: ProfileDef[]; fittings?: Record<string, FittingDef>; materials?: Record<string, MaterialDef> }): void {
  for (const p of more.profiles ?? []) { const i = PROFILES.findIndex((x) => x.id === p.id); if (i >= 0) PROFILES[i] = p; else PROFILES.push(p); if (!FAMILIES.includes(p.family)) FAMILIES.push(p.family); }
  Object.assign(FITTINGS, more.fittings ?? {});
  Object.assign(MATERIALS, more.materials ?? {});
}

export const BUILTIN_PROFILES = new Set<string>(PROFILES.map((p) => p.id));
export const BUILTIN_FITTINGS = new Set<string>(Object.keys(FITTINGS));
export const BUILTIN_MATERIALS = new Set<string>(Object.keys(MATERIALS));

// ---- the regional stock is loaded on demand: one chunk per region (thousands of entries), fetched when the picker opens a region or a document names one of its profiles
const LOADERS: Record<Region, () => Promise<{ default: unknown }>> = {
  AU: () => import('./profiles.au.json'),
  US: () => import('./profiles.us.json'),
  EU: () => import('./profiles.eu.json'),
};
/** The regional libraries, in the order the picker lists them. */
export const CATALOGUE_REGIONS: Region[] = ['AU', 'US', 'EU'];
const loaded = new Set<Region>();
const pending = new Map<Region, Promise<void>>();
const listeners = new Set<() => void>();
/** True for `generic` and for a region whose stock has been read in. */
export const regionLoaded = (r: Region | 'generic'): boolean => r === 'generic' || loaded.has(r);
/** True while the region's chunk is being fetched. */
export const regionLoading = (r: Region): boolean => pending.has(r);
/** Call `fn` whenever a region finishes loading; returns the unsubscribe. */
export function onRegionLoaded(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Read a region's stock into the library (once; concurrent calls share one fetch). A failed fetch rejects and can be tried again. */
export function loadRegion(region: Region): Promise<void> {
  if (loaded.has(region)) return Promise.resolve();
  const at = pending.get(region);
  if (at) return at;
  const p = LOADERS[region]().then((m) => {
    const file = expandCatalogue((m.default ?? m) as unknown as CatalogueFile);
    const have = new Set(PROFILES.map((x) => x.id));
    for (const x of file.profiles) if (!have.has(x.id)) { PROFILES.push(x); BUILTIN_PROFILES.add(x.id); if (!FAMILIES.includes(x.family)) FAMILIES.push(x.family); }
    for (const [id, f] of Object.entries(file.fittings)) if (!(id in FITTINGS)) { FITTINGS[id] = f; BUILTIN_FITTINGS.add(id); }
    loaded.add(region);
    pending.delete(region);
    for (const fn of [...listeners]) fn();
  }, (e) => { pending.delete(region); throw e; });
  pending.set(region, p);
  return p;
}
/** Every regional library (headless use, tests, the MCP tools). */
export const loadAllRegions = (): Promise<void> => Promise.all(CATALOGUE_REGIONS.map(loadRegion)).then(() => undefined);
/** The region a catalogue profile id belongs to (`au-`, `us-`, `eu-` prefix), or null for generic and the user's own stock. */
export const regionOfId = (id: string | undefined): Region | null => { const m = /^(au|us|eu)-/.exec(id ?? ''); return m ? (m[1].toUpperCase() as Region) : null; };
/** Load the regions the given profile ids live in (unknown and generic ids need nothing). */
export function ensureProfiles(ids: Iterable<string | undefined>): Promise<void> {
  const need = new Set<Region>();
  for (const id of ids) { const r = regionOfId(id); if (r) need.add(r); }
  return Promise.all([...need].map(loadRegion)).then(() => undefined);
}
/** The profile ids a document's `frame` features name. */
export const frameProfileIds = (features: Array<Record<string, unknown>> | undefined): string[] =>
  (features ?? []).flatMap((f) => (f.type === 'frame' && typeof (f.profile as { id?: unknown } | undefined)?.id === 'string' ? [(f.profile as { id: string }).id] : []));
/** Load what a document's frames need (a document that names a regional profile loads that region when it opens). */
export const ensureForDocument = (features: Array<Record<string, unknown>> | undefined): Promise<void> => ensureProfiles(frameProfileIds(features));

/** The pieces of the live library a profile needs, when the profile is the user's own: written into the frame feature so the file travels. */
export function libraryFor(profileId: string): { profiles: ProfileDef[]; fittings: Record<string, FittingDef>; materials: Record<string, MaterialDef> } | null {
  const p = PROFILES.find((x) => x.id === profileId);
  if (!p || BUILTIN_PROFILES.has(profileId)) return null;
  const need = new Set<string>();
  const addFit = (id: string): void => {
    if (need.has(id) || !FITTINGS[id]) return;
    need.add(id);
    for (const k of ['tnut', 'bolt', 'nut']) { const r = FITTINGS[id].part?.[k]; if (typeof r === 'string') addFit(r); }
  };
  for (const u of p.fittings) addFit(u.id);
  for (const list of Object.values(p.hardware ?? {})) for (const id of list ?? []) addFit(id);
  const fits: Record<string, FittingDef> = {};
  for (const id of need) if (!BUILTIN_FITTINGS.has(id)) fits[id] = FITTINGS[id];
  const mats: Record<string, MaterialDef> = {};
  if (!BUILTIN_MATERIALS.has(p.material) && MATERIALS[p.material]) mats[p.material] = MATERIALS[p.material];
  return { profiles: [p], fittings: fits, materials: mats };
}

export const profileById = (id: string | undefined): ProfileDef | undefined => PROFILES.find((p) => p.id === id);

/** The picker's region of a profile: `AU`, `US`, or `generic` for the generic steel, T-slot and the user's own stock. */
export const regionOf = (p: ProfileDef): Region | 'generic' => p.region ?? 'generic';
export const REGIONS: Array<Region | 'generic'> = ['generic', 'AU', 'US', 'EU'];

/** One group of the profile picker: a region, a standard and a family of stock. */
export interface ProfileGroup { key: string; region: Region | 'generic'; standard: string; family: string; profiles: ProfileDef[] }

/** The profiles that match a search text (every word must be found in the label, id, designation, standard, grade or region; empty: all), grouped by region, standard and family
 * in library order; `only` restricts the list to one region (`generic` for the generic and T-slot stock). Only regions already loaded (loadRegion) are listed. `keep` (the profile in use) is listed even when it does not match, so the picker never loses its value. */
export function profileGroups(query: string, keep?: string, only: Region | 'generic' | 'all' = 'all'): ProfileGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const groups = new Map<string, ProfileGroup>();
  for (const p of PROFILES) {
    const hay = [p.label, p.id, p.designation, p.designation_metric, p.standard, p.grade, p.region, p.family, p.manufacturing].filter(Boolean).join(' ').toLowerCase();
    if (p.id !== keep && (!words.every((w) => hay.includes(w)) || (only !== 'all' && regionOf(p) !== only))) continue;
    const region = regionOf(p), standard = p.standard ?? '', key = [region, standard, p.family].join('|');
    const g = groups.get(key) ?? { key, region, standard, family: p.family, profiles: [] };
    g.profiles.push(p);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region));
}

/** The fitting chosen for each place (null: none there). */
export type HardwareChoice = Record<HwPlace, string | null>;
/** One joint's own choice: `default`, `none` or a fitting id, and for a tee a bracket on both sides. Joints are named by the two segment ids. */
export interface JointChoice { segments: [string, string]; connector: string; both?: boolean }

/** The profile's default fitting for each place. */
export function defaultHardware(profile: string): HardwareChoice {
  const h = profileById(profile)?.hardware;
  // the corner block is the default only where it is a real choice over two brackets: T-slot (tubes offer it, weld gussets stay the default)
  return { joint: h?.joint?.[0] ?? null, corner3: profileById(profile)?.family === 'tslot' ? (h?.corner3?.[0] ?? null) : null, cap: h?.cap?.[0] ?? null, foot: h?.foot?.[0] ?? null };
}

/** The kernel's part object for a fitting id: id, label, kind, spec and dimensions; a T-nut or screw an L bracket names is inlined. Null for a fitting with no geometry. */
export function partSpec(id: string): Record<string, unknown> | null {
  const f = FITTINGS[id];
  if (!f?.part) return null;
  const out: Record<string, unknown> = { id, label: f.label, kind: f.part.kind ?? f.kind, spec: f.spec ?? '', ...f.part };
  for (const k of ['tnut', 'bolt', 'nut']) {
    if (typeof f.part[k] !== 'string') continue;
    const c = partSpec(f.part[k] as string);
    if (!c) return null;
    out[k] = c;
  }
  return out;
}

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
  /** brackets, caps and feet to place (the profile's defaults for a new frame) */
  hardware: HardwareChoice;
  /** joints that differ from `hardware.joint` */
  joints: JointChoice[];
  /** a bracket on each side of the through member at every tee */
  teeBoth: boolean;
  /** drill the tube members at the bracket holes and bolt through them */
  drill: boolean;
}
export const DEFAULT_FRAME: FrameParams = { sketch: null, segments: null, profile: 'tslot-2020', corner: 'butt', rotate: 0, hardware: defaultHardware('tslot-2020'), joints: [], teeBoth: false, drill: false };

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
  const userLib = libraryFor(prof.id);   // a profile of the user's own travels with the file
  const hw: Record<string, unknown> = {};
  for (const place of HW_PLACES) { const part = p.hardware[place] ? partSpec(p.hardware[place]!) : null; if (part) hw[place] = part; }
  const joints = p.joints.flatMap((j) => {
    const c = j.connector === 'default' ? undefined : j.connector === 'none' ? 'none' : partSpec(j.connector);
    if (c === null || (c === undefined && !j.both)) return [];
    return [{ segments: j.segments, ...(c !== undefined ? { connector: c } : {}), ...(j.both ? { both: true } : {}) }];
  });
  if (Object.keys(hw).length) { if (p.teeBoth) hw.teeBoth = true; if (p.drill) hw.drill = true; }
  return {
    type: 'frame', id, sketch: p.sketch, profile: sectionOf(prof), corner: p.corner,
    ...(p.rotate ? { rotate: p.rotate } : {}),
    ...(p.segments ? { segments: p.segments } : {}),
    ...(Object.keys(hw).length ? { hardware: hw } : {}),
    ...(joints.length ? { joints } : {}),
    ...(userLib ? { library: userLib } : {}),
  };
}

/** The panel's choices read back from a `frame` feature (Edit), or null when it is not one the panel can describe. */
export function paramsFromFeature(f: Record<string, unknown> | undefined): FrameParams | null {
  if (!f || f.type !== 'frame' || typeof f.sketch !== 'string') return null;
  const prof = f.profile as { id?: string } | undefined;
  if (!profileById(prof?.id)) return null;
  const hw = (f.hardware ?? {}) as Partial<Record<HwPlace, { id?: string }>> & { teeBoth?: boolean; drill?: boolean };
  const joints: JointChoice[] = [];
  for (const j of Array.isArray(f.joints) ? (f.joints as Array<{ segments?: unknown; connector?: unknown; both?: unknown }>) : []) {
    const c = j.connector === 'none' ? 'none' : (j.connector as { id?: string } | undefined)?.id ?? 'default';
    if (Array.isArray(j.segments) && j.segments.length === 2 && (c !== 'default' || j.both === true)) joints.push({ segments: [String(j.segments[0]), String(j.segments[1])], connector: c, ...(j.both === true ? { both: true } : {}) });
  }
  return {
    sketch: f.sketch, segments: Array.isArray(f.segments) ? (f.segments as string[]) : null, profile: prof!.id!,
    corner: f.corner === 'butt' ? 'butt' : 'mitre', rotate: typeof f.rotate === 'number' ? f.rotate : 0,
    hardware: { joint: hw.joint?.id ?? null, corner3: hw.corner3?.id ?? null, cap: hw.cap?.id ?? null, foot: hw.foot?.id ?? null }, joints, teeBoth: hw.teeBoth === true, drill: hw.drill === true,
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
  /** holes drilled for bolted hardware */
  holes?: number;
}
/** A placed part kind with its quantity (the kernel's `hardware.parts`): `bodies` are the model bodies, one per piece. */
export interface HwPart { id: string; label: string; kind: string; spec: string; qty: number; bodies: string[] }
/** A joint of the frame: what was placed there, or why nothing was (`reason`). */
export interface HwJoint { segments: [string, string]; node: number[]; angle: number; corner: string; connector: string | null; reason?: string; bodies?: string[]; sides?: number; block?: boolean }
export interface HardwareReport { parts: HwPart[]; joints: HwJoint[] }
export interface FrameReport { id: string; members: MemberReport[]; hardware?: HardwareReport }

/** One cut list line: identical pieces (same stock, length and cut angles to 0.1 mm / 0.1 deg) counted together. */
export interface CutLine { profile: string; label: string; length: number; angles: [number, number]; qty: number; members: string[]; massKg: number }
export type BomGroup = 'stock' | 'connector' | 'fastener' | 'end' | 'process';
/** `standard`, `grade` and `massKg` (all pieces of the line) are set on stock lines of catalogue profiles; `massKg` on any stock line with a known density.
 * `material` is the material's name (a catalogue grade for catalogue stock, with "(default, confirm)" where the grade is the family's default and not a published fact). */
export interface BomLine { kind: 'stock' | 'fitting'; group: BomGroup; id: string; label: string; qty: number; unit: string; detail: string; standard?: string; grade?: string; massKg?: number; material?: string }

/** The Material editor's catalogue entry a profile is made of by default (its `material_ref`), or null for generic stock. */
export const profileMaterial = (p: ProfileDef | undefined): CatalogueMaterial | null => (p?.material_ref ? findMaterial(p.material_ref) : null);
/** The material's name for the bill of materials: the catalogue grade (flagged when it is a default to confirm), else the frame library's material. */
export function profileMaterialLabel(p: ProfileDef | undefined): string {
  const m = profileMaterial(p);
  if (m) return m.name + (p?.material_default ? ' (default, confirm)' : '');
  return MATERIALS[p?.material ?? '']?.label ?? '';
}
/** The name to give the part's material when a frame of this profile is created: the profile's catalogue grade, unless the part already has a deliberate material
 * (anything but unset, "steel" or Mild steel); null when nothing should change. */
export function partMaterialFor(profileId: string, current: string | undefined): string | null {
  const m = profileMaterial(profileById(profileId));
  if (!m) return null;
  const cur = (current ?? '').trim();
  if (cur && findMaterial(cur)?.id !== 'steel-mild' && cur.toLowerCase() !== 'steel') return null;
  return cur === m.name ? null : m.name;
}

/** Mass of one member (kg): the published mass per metre times its stock length when the profile has one, else its volume times the material density
 * (the catalogue grade's density where the profile has one, else the frame library's). */
export function memberMassKg(m: { profile: string; length: number; volume: number }): number {
  const prof = profileById(m.profile);
  if (prof?.mass_per_m_kg) return (prof.mass_per_m_kg * m.length) / 1000;
  const cat = profileMaterial(prof);
  return m.volume * (cat ? cat.density * 1e-9 : MATERIALS[prof?.material ?? '']?.density ?? 0);
}

const GROUP_OF: Record<string, BomGroup> = { lbracket: 'connector', corner3: 'connector', bracket: 'connector', gusset: 'connector', nut: 'fastener', bolt: 'fastener', cap: 'end', foot: 'end' };
const GROUP_ORDER: BomGroup[] = ['stock', 'connector', 'fastener', 'end', 'process'];

const r1 = (v: number): number => Math.round(v * 10) / 10;

/** Group equal pieces. Angles are stored small-first so a piece cut 45/0 and one cut 0/45 are the same piece (it turns over). */
export function cutList(frames: FrameReport[]): CutLine[] {
  const lines = new Map<string, CutLine>();
  for (const fr of frames) for (const m of fr.members) {
    const prof = profileById(m.profile);
    const ang = [r1(m.angles[0]), r1(m.angles[1])].sort((a, b) => a - b) as [number, number];
    const key = [m.profile, r1(m.length), ang[0], ang[1]].join('|');
    const at = lines.get(key) ?? { profile: m.profile, label: m.label || prof?.label || m.profile, length: r1(m.length), angles: ang, qty: 0, members: [], massKg: 0 };
    at.qty++;
    at.members.push(m.body);
    at.massKg += memberMassKg(m);
    lines.set(key, at);
  }
  return [...lines.values()].sort((a, b) => a.label.localeCompare(b.label) || b.length - a.length);
}

/** How many joints of a member's own profile each end stands for: a butt or tee end is one joint, a mitre or in-line end half of one (the other half is the member it meets), the end that runs through none. */
const jointShare = (end: string): number => (end === 'butt' || end === 'tee' ? 1 : end === 'mitre' || end === 'inline' ? 0.5 : 0);

/** The bill of materials, grouped (stock, connectors, fasteners, caps and feet, other): stock per profile (pieces, total length, mass), the
 * hardware the kernel placed (one row per part, quantity = bodies in the model), and library fittings that have no geometry (welds), counted from the joints. */
export function bom(frames: FrameReport[]): BomLine[] {
  const stock = new Map<string, { label: string; pieces: number; length: number; mass: number }>();
  const fit = new Map<string, number>();
  const placed = new Map<string, HwPart>();
  for (const fr of frames) {
    for (const hp of fr.hardware?.parts ?? []) {
      const at = placed.get(hp.id);
      if (at) at.qty += hp.qty; else placed.set(hp.id, { ...hp });
    }
    for (const m of fr.members) {
      const prof = profileById(m.profile);
      const s = stock.get(m.profile) ?? { label: m.label || prof?.label || m.profile, pieces: 0, length: 0, mass: 0 };
      s.pieces++; s.length += m.length; s.mass += memberMassKg(m);
      stock.set(m.profile, s);
      if (!prof) continue;
      const joints = jointShare(m.ends[0]) + jointShare(m.ends[1]);
      const free = m.ends.filter((e) => e === 'free').length;
      for (const u of prof.fittings) {
        if (FITTINGS[u.id]?.part) continue;   // has geometry: counted from the placed bodies, not from the profile
        const n = u.per === 'joint' ? joints : u.per === 'freeEnd' ? free : 1;
        if (n) fit.set(u.id, (fit.get(u.id) ?? 0) + n * u.qty);
      }
    }
  }
  const out: BomLine[] = [];
  for (const [id, s] of stock) {
    const prof = profileById(id);
    const mat = profileMaterialLabel(prof);
    out.push({
      kind: 'stock', group: 'stock', id, label: s.label, qty: s.pieces, unit: 'pcs', detail: `${r1(s.length)} mm total${mat ? ', ' + mat : ''}`, ...(mat ? { material: mat } : {}),
      ...(prof?.standard ? { standard: prof.standard } : {}), ...(prof?.grade ? { grade: prof.grade } : {}), ...(s.mass ? { massKg: Math.round(s.mass * 1000) / 1000 } : {}),
    });
  }
  for (const p of placed.values()) out.push({ kind: 'fitting', group: GROUP_OF[p.kind] ?? 'process', id: p.id, label: p.label, qty: p.qty, unit: 'pcs', detail: p.spec || p.kind });
  for (const [id, n] of fit) out.push({ kind: 'fitting', group: 'process', id, label: FITTINGS[id]?.label ?? id, qty: Math.ceil(n - 1e-9), unit: FITTINGS[id]?.kind === 'process' ? 'joints' : 'pcs', detail: FITTINGS[id]?.spec ?? FITTINGS[id]?.kind ?? '' });
  return out.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}

/** The cut list as a table: head and rows. */
function cutRows(frames: FrameReport[]): { head: string[]; rows: Array<Array<string | number>> } {
  return {
    head: ['Item', 'Profile', 'Length (mm)', 'Angle 1 (deg)', 'Angle 2 (deg)', 'Qty', 'Mass each (kg)', 'Members'],
    rows: cutList(frames).map((l, i) => [i + 1, l.label, l.length, l.angles[0], l.angles[1], l.qty, Math.round((l.massKg / l.qty) * 1000) / 1000, l.members.join(' ')]),
  };
}
/** The bill of materials as a table: head and rows. */
function bomRows(frames: FrameReport[]): { head: string[]; rows: Array<Array<string | number>> } {
  return {
    head: ['Item', 'Part', 'Qty', 'Unit', 'Type', 'Standard', 'Grade', 'Material', 'Mass (kg)', 'Detail'],
    rows: bom(frames).map((b, i) => [i + 1, b.label, b.qty, b.unit, b.group, b.standard ?? '', b.grade ?? '', b.material ?? '', b.massKg ?? '', b.detail]),
  };
}

/** Cut list then bill of materials, one CSV text (CR LF line ends, a blank line between the two tables). */
export function toCsv(frames: FrameReport[]): string {
  const c = cutRows(frames), b = bomRows(frames);
  return csvText([c.head, ...c.rows, null, b.head, ...b.rows]);
}

/** Cut list then bill of materials as aligned plain text for an e-mail, a blank line between the two tables. */
export function toText(frames: FrameReport[]): string {
  const c = cutRows(frames), b = bomRows(frames);
  return `${alignedText(c.head, c.rows)}\n${alignedText(b.head, b.rows)}`;
}

/** The `frames` list of a regen reply, typed (anything malformed is left out). */
export function readFrames(raw: unknown): FrameReport[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is FrameReport => !!f && typeof (f as FrameReport).id === 'string' && Array.isArray((f as FrameReport).members));
}

/** Face-name prefix of a body (`F2 H7` owns the faces `F2.H7.*`). */
const prefixOf = (body: string): string => body.replace(/ /g, '.') + '.';
const jointKey = (j: HwJoint): string => j.segments.join('/');

/** The joint a clicked or hovered face belongs to: a hardware body belongs to its joint; a member face to the joint of that member nearest `point` (within 3 sections' reach of its node). */
export function jointOfFace(face: string | undefined, report: FrameReport | null | undefined, point?: readonly number[] | null): string | null {
  const joints = report?.hardware?.joints;
  const m = face && report ? /^(.+?)\.([HM])(\d+)\./.exec(face) : null;
  if (!m || !joints?.length || !report || m[1] !== report.id) return null;
  const body = `${report.id} ${m[2]}${m[3]}`;
  if (m[2] === 'H') { const j = joints.find((x) => x.bodies?.includes(body)); return j ? jointKey(j) : null; }
  const seg = report.members.find((x) => x.body === body)?.segment;
  const cand = joints.filter((j) => seg !== undefined && j.segments.includes(seg));
  if (!cand.length) return null;
  if (!point) return cand.length === 1 ? jointKey(cand[0]) : null;
  const dist = (j: HwJoint): number => Math.hypot(j.node[0] - point[0], j.node[1] - point[1], j.node[2] - point[2]);
  const best = cand.reduce((a, b) => (dist(b) < dist(a) ? b : a));
  return dist(best) <= 120 ? jointKey(best) : null;
}

/** The faces to light for a joint: the hardware placed there, else the two members it joins. */
export function jointFaces(key: string | null, report: FrameReport | null | undefined, faces: readonly string[]): string[] {
  const j = key ? report?.hardware?.joints.find((x) => jointKey(x) === key) : undefined;
  if (!j || !report) return [];
  const bodies = j.bodies?.length ? j.bodies : report.members.filter((x) => j.segments.includes(x.segment)).map((x) => x.body);
  const pre = bodies.map(prefixOf);
  return faces.filter((f) => pre.some((p) => f.startsWith(p)));
}
