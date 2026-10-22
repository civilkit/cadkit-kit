// Turbo-impeller geometry: parameters, validation, readout and the feature list for an open-type
// radial compressor wheel -- a contoured hub (revolve of a meridional profile), N back-swept main
// blades plus N shorter splitter blades (lofts of closed band sections through planes that contain
// the shaft axis), patterned about z, bored. Pure functions, no framework. The build route is the
// one the kernel probe proved (see the brief): blade thickness is tangential (perpendicular to
// each section plane), so a section is the thin band where its plane cuts the blade: the
// hub-to-shroud line shifted +-dm ALONG THE MERIDIONAL DIRECTION, dm = (t/2) / (r dtheta/dm) in
// m-parameter units -- the physical shift multiplies by the meridional speed |dH/dm| (the probe
// lesson: shifting along the span line itself, or by the bare parameter-space amount, yields
// zero-area sections the kernel refuses as loftProfile).
//
// Parameters stay neutral for the radial-inflow-turbine variant the brief flags for later: the
// meridional contour is a hub profile, wrapDeg is just total wrap (backsweep for a compressor).
// Frame: shaft axis Z; the hub sketch lives on an angle plane (u = world Z, v = radial at 0).
import type { EditOp } from '@ck/session';

export interface ImpellerParams {
  mainBlades: number;
  splitterBlades: number;
  splitterStart: number; // fraction of the meridional span where splitters begin
  exducerDiameter: number; // hub dia at the back face
  inducerDiameter: number; // hub dia at the nose plane
  hubLength: number; // axial nose -> back face
  boreDiameter: number;
  wrapDeg: number; // total blade wrap about the axis
  bladeThickness: number; // tangential thickness at the hub end of a section line
  tipThickness: number; // tangential thickness at the shroud end
  spanZ: number; // axial reach of a hub->shroud section line
  spanR: number; // radial reach of a hub->shroud section line
  rootEmbed: number; // radial embed below the hub surface, for the fuse
  stations: number; // section count (brief: 10-16)
}

export const DEFAULT_IMPELLER: ImpellerParams = {
  mainBlades: 7,
  splitterBlades: 7,
  splitterStart: 0.45,
  exducerDiameter: 45,
  inducerDiameter: 20,
  hubLength: 16,
  boreDiameter: 8,
  wrapDeg: 75,
  bladeThickness: 2.5,
  tipThickness: 0.8,
  spanZ: 0.6,
  spanR: 2.2,
  rootEmbed: 1.0,
  stations: 12,
};

const round = (v: number, d = 6): number => { const k = 10 ** d; return Math.round(v * k) / k; };
const rad = (d: number): number => (d * Math.PI) / 180;

// ---- meridional hub contour ----

/** The hub profile in the meridional sketch (z, r): nose face, cone to a knee at 75% length, tip
 *  edge to the rim, back face to the axis. The closing edge sits on v = 0 and doubles as the
 *  revolve axis. */
export function hubContour(p: ImpellerParams): Array<[number, number]> {
  const rN = p.inducerDiameter / 2;
  const rX = p.exducerDiameter / 2;
  const rKnee = rN + ((rX - rN) * 2) / 3;
  const zKnee = p.hubLength * 0.75;
  return [[0, 0], [0, rN], [zKnee, rKnee], [p.hubLength, rX], [p.hubLength, 0]];
}

export const hubSurface = (z: number, p: ImpellerParams): number => {
  const rN = p.inducerDiameter / 2;
  const rX = p.exducerDiameter / 2;
  const rKnee = rN + ((rX - rN) * 2) / 3;
  const zKnee = p.hubLength * 0.75;
  return z <= zKnee ? rN + ((rKnee - rN) / zKnee) * z : rKnee + ((rX - rKnee) / (p.hubLength - zKnee)) * (z - zKnee);
};

export const hubSlope = (z: number, p: ImpellerParams): number => {
  const rN = p.inducerDiameter / 2;
  const rX = p.exducerDiameter / 2;
  const rKnee = rN + ((rX - rN) * 2) / 3;
  const zKnee = p.hubLength * 0.75;
  return z <= zKnee ? (rKnee - rN) / zKnee : (rX - rKnee) / (p.hubLength - zKnee);
};

export const thicknessAt = (r: number, p: ImpellerParams): number => {
  const rN = p.inducerDiameter / 2;
  const rX = p.exducerDiameter / 2;
  const x = Math.min(1, Math.max(0, (r - rN) / (rX - rN)));
  return p.bladeThickness + (p.tipThickness - p.bladeThickness) * x;
};

// ---- validation, readout ----

export interface ImpellerIssue { level: 'error' | 'warning'; code: string; message: string }

/** Station parameters m in [0, 1] where a section exists; the splitters take the tail of the list. */
export const mainStationMs = (p: ImpellerParams): number[] => Array.from({ length: p.stations }, (_, i) => (i + 0.5) / p.stations);
export const splitterStationMs = (p: ImpellerParams): number[] => mainStationMs(p).filter((m) => m >= p.splitterStart);

export function validateImpeller(p: ImpellerParams): ImpellerIssue[] {
  const out: ImpellerIssue[] = [];
  const err = (code: string, message: string): void => { out.push({ level: 'error', code, message }); };
  const warn = (code: string, message: string): void => { out.push({ level: 'warning', code, message }); };
  const nums: Array<keyof ImpellerParams> = ['mainBlades', 'splitterBlades', 'splitterStart', 'exducerDiameter', 'inducerDiameter', 'hubLength', 'boreDiameter', 'wrapDeg', 'bladeThickness', 'tipThickness', 'spanZ', 'spanR', 'rootEmbed', 'stations'];
  for (const k of nums) if (!Number.isFinite(p[k] as number)) err('notNumber', `${k} is not a number`);
  if (out.length) return out;
  if (p.exducerDiameter <= 0) err('exducer', 'The exducer diameter must be above 0');
  if (p.inducerDiameter <= 0 || p.inducerDiameter >= p.exducerDiameter) err('inducer', 'The inducer diameter must be above 0 and below the exducer diameter');
  if (p.hubLength <= 0) err('hubLength', 'The hub length must be above 0');
  if (p.boreDiameter < 0 || (p.boreDiameter > 0 && p.boreDiameter >= p.inducerDiameter * 0.9)) err('bore', 'The bore must leave a wall in the hub');
  if (!(Number.isInteger(p.mainBlades) && p.mainBlades >= 3 && p.mainBlades <= 12)) err('mainBlades', 'The main blade count must be a whole number from 3 to 12');
  if (!(Number.isInteger(p.splitterBlades) && p.splitterBlades >= 0 && p.splitterBlades <= p.mainBlades)) err('splitters', 'The splitter count must be a whole number from 0 up to the main blade count');
  if (p.splitterBlades > 0 && (p.splitterStart < 0.15 || p.splitterStart > 0.85)) err('splitterStart', 'The splitter start must be between 0.15 and 0.85 of the meridional span');
  if (p.splitterBlades > 0 && splitterStationMs(p).length < 2) err('splitterStart', 'The splitter start leaves fewer than two sections: lower it or raise the station count');
  if (p.wrapDeg < 20 || p.wrapDeg > 160) err('wrap', 'The total wrap must be between 20 and 160 degrees');
  if (p.bladeThickness <= 0) err('thick', 'The blade thickness must be above 0');
  if (p.tipThickness < 0.2) err('tipThick', 'The tip thickness must be at least 0.2 mm');
  if (p.tipThickness > p.bladeThickness) warn('tipThicker', 'The tip is thicker than the hub end');
  if (p.spanZ <= 0 || p.spanR <= 0) err('span', 'The section line reach must be above 0 in both directions');
  if (p.rootEmbed < 0.3 || p.rootEmbed > 3) err('rootEmbed', 'The root embed must be between 0.3 and 3 mm below the hub surface');
  if (!(Number.isInteger(p.stations) && p.stations >= 8 && p.stations <= 24)) err('stations', 'The station count must be a whole number from 8 to 24');
  if (out.length) return out;
  if (!(p.stations >= 10 && p.stations <= 16)) warn('stationsLoose', 'The brief suggests 10 to 16 sections');
  if (p.tipThickness < 0.5) warn('thinTip', 'The tip is thinner than 0.5 mm');
  // the tip ring is crowded when the blades' tangential thicknesses fill much of the circumference
  const tipCircumference = 2 * Math.PI * (p.exducerDiameter / 2);
  if ((p.mainBlades + p.splitterBlades) * p.tipThickness > 0.6 * tipCircumference) warn('tight', 'The blades are tight at the tip: lower the tip thickness or the blade counts');
  if (p.wrapDeg > 120) warn('wrapHigh', 'A wrap above 120 degrees is unusual');
  return out;
}
export const impellerErrors = (p: ImpellerParams): ImpellerIssue[] => validateImpeller(p).filter((i) => i.level === 'error');
/** Station counts to try when a preview fails: the draft's own first, then fallbacks (the marine family's spacing retry, in stations). */
export const impellerStationsTried = (sp: number): number[] => [sp, ...[12, 10, 14].filter((x) => x !== sp)];
export class ImpellerError extends Error {
  constructor(public issues: ImpellerIssue[]) { super(issues.map((i) => i.message).join('; ')); }
}

export interface ImpellerReadout {
  exducerRadius: number; inducerRadius: number; wrapDeg: number; mainBlades: number; splitterBlades: number;
  /** Section count of one main blade loft. */
  stations: number;
  /** Length of one hub->shroud section line, mm. */
  span: number;
  /** Tip pitch (mm per blade revolution at the exducer radius). */
  tipPitch: number;
  issues: ImpellerIssue[];
}
export function impellerReadout(p: ImpellerParams): ImpellerReadout {
  return {
    exducerRadius: p.exducerDiameter / 2, inducerRadius: p.inducerDiameter / 2, wrapDeg: p.wrapDeg,
    mainBlades: p.mainBlades, splitterBlades: p.splitterBlades, stations: p.stations,
    span: Math.hypot(p.spanZ, p.spanR), tipPitch: (2 * Math.PI * (p.exducerDiameter / 2)) / Math.max(1, p.mainBlades),
    issues: validateImpeller(p),
  };
}

// ---- one band section ----

/** One band section: the hub->shroud line at meridional parameter m, shifted +-dm along the
 *  meridional tangent into a closed quadrilateral (front, tip, back, root) in (z, r) sketch
 *  coords. The plane is the marine family's convention: angle psi + 90 about z from the right
 *  plane (u = world Z, v = radial at psi). */
export interface ImpellerSection {
  m: number;
  psiDeg: number;
  planeAngleDeg: number;
  quad: Array<[number, number]>; // [Hf, Sf, Sb, Hb]
}

export function impellerSection(m: number, p: ImpellerParams, phaseDeg = 0): ImpellerSection {
  const z0 = p.hubLength * 0.0625;
  const z1 = p.hubLength * 0.9375;
  const zh = z0 + (z1 - z0) * m;
  const H: [number, number] = [zh, hubSurface(zh, p) - p.rootEmbed];
  const S: [number, number] = [H[0] + p.spanZ, H[1] + p.spanR];
  const th = rad(p.wrapDeg); // dtheta/dm, rad per unit m
  const dzdm = z1 - z0;
  const slope = hubSlope(zh, p);
  const speed = dzdm * Math.hypot(1, slope); // |dH/dm|, physical mm per unit m
  const tl = Math.hypot(1, slope);
  const tv: [number, number] = [1 / tl, slope / tl];
  const dmH = (thicknessAt(H[1], p) / 2 / (H[1] * th)) * speed;
  const dmS = (thicknessAt(S[1], p) / 2 / (S[1] * th)) * speed;
  const Hf: [number, number] = [H[0] + dmH * tv[0], H[1] + dmH * tv[1]];
  const Hb: [number, number] = [H[0] - dmH * tv[0], H[1] - dmH * tv[1]];
  const Sf: [number, number] = [S[0] + dmS * tv[0], S[1] + dmS * tv[1]];
  const Sb: [number, number] = [S[0] - dmS * tv[0], S[1] - dmS * tv[1]];
  const psiDeg = p.wrapDeg * m + phaseDeg;
  return { m, psiDeg, planeAngleDeg: psiDeg + 90, quad: [[Hf[0], Hf[1]], [Sf[0], Sf[1]], [Sb[0], Sb[1]], [Hb[0], Hb[1]]] };
}

// ---- features ----

type Feat = { id: string; type: string; [k: string]: unknown };
/** Roles in feature order: the hub plane, sketch and revolve, the main sections (plane_i, sec_i),
 *  the blade loft and its pattern, the splitter sections and their loft and pattern, the bore. */
export function impellerRoles(p: ImpellerParams): string[] {
  const roles = ['hubPlane', 'hubSketch', 'hub'];
  mainStationMs(p).forEach((_m, i) => roles.push('plane' + i, 'sec' + i));
  roles.push('blade', 'pattern');
  if (p.splitterBlades >= 2 && splitterStationMs(p).length >= 2) {
    splitterStationMs(p).forEach((_m, i) => roles.push('splane' + i, 'ssec' + i));
    roles.push('splitter', 'splitterPattern');
  }
  if (p.boreDiameter > 0) roles.push('boreSketch', 'bore');
  return roles;
}

const circleSketch = (id: string, name: string, dia: number): Feat => ({
  type: 'sketch', id, name, plane: { kind: 'std', id: 'front' }, points: [{ id: 'p1', x: 0, y: 0, fixed: true }], entities: [{ type: 'circle', id: 'e1', c: 'p1', r: round(dia / 2) }],
  constraints: [{ id: 'k1', type: 'diameter', refs: ['e1'], value: round(dia) }],
});

export function impellerFeatures(p: ImpellerParams, ids: Record<string, string>): Feat[] {
  const record = { ...p, family: 'impeller', roles: Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, Number(v.slice(1))])) };
  const out: Feat[] = [];
  out.push({ type: 'plane', id: ids.hubPlane, name: 'Hub meridian plane', mode: 'angle', base: { kind: 'std', id: 'right' }, axis: { kind: 'axis', axis: 'z' }, angle: 90, visible: false });
  const hubSketch: Feat = {
    type: 'sketch', id: ids.hubSketch, name: 'Impeller hub sketch', plane: { kind: 'feature', id: ids.hubPlane },
    points: hubContour(p).map(([z, r], i) => ({ id: 'h' + i, x: round(z), y: round(r) })),
    entities: hubContour(p).map((_, i) => ({ type: 'line', id: 'e' + i, p1: 'h' + i, p2: 'h' + ((i + 1) % 5) })),
    constraints: [], visible: false,
  };
  hubSketch.prop = record;
  out.push(hubSketch);
  out.push({ type: 'revolve', id: ids.hub, name: 'Impeller hub', op: 'add', sketch: ids.hubSketch, axis: 'e4', end: 'blind', angle: 360 });

  const sections = (ms: number[], phaseDeg: number, name: string, planeKey: string, secKey: string): Feat[] => {
    const feats: Feat[] = [];
    ms.forEach((m, i) => {
      const s = impellerSection(m, p, phaseDeg);
      feats.push({ type: 'plane', id: ids[planeKey + i], name: `${name} plane ${i + 1}`, mode: 'angle', base: { kind: 'std', id: 'right' }, axis: { kind: 'axis', axis: 'z' }, angle: round(s.planeAngleDeg, 5), visible: false });
      feats.push({
        type: 'sketch', id: ids[secKey + i], name: `${name} section ${i + 1}`, plane: { kind: 'feature', id: ids[planeKey + i] },
        points: s.quad.map(([z, r], k) => ({ id: 'q' + k, x: round(z), y: round(r) })),
        entities: [
          { type: 'line', id: 'front', p1: 'q0', p2: 'q1' }, { type: 'line', id: 'tip', p1: 'q1', p2: 'q2' },
          { type: 'line', id: 'back', p1: 'q2', p2: 'q3' }, { type: 'line', id: 'root', p1: 'q3', p2: 'q0' },
        ], constraints: [],
      });
    });
    return feats;
  };

  const mainMs = mainStationMs(p);
  out.push(...sections(mainMs, 0, 'Blade', 'plane', 'sec'));
  out.push({ type: 'loft', id: ids.blade, name: 'Impeller blade', op: 'add', sketches: mainMs.map((_m, i) => ids['sec' + i]) });
  out.push({ type: 'cpattern', id: ids.pattern, name: 'Impeller blades', seeds: [ids.blade], axis: { kind: 'axis', axis: 'z' }, count: p.mainBlades, angle: 360, equal: true });
  if (ids.splitter) {
    const splitMs = splitterStationMs(p);
    out.push(...sections(splitMs, 180 / p.splitterBlades, 'Splitter', 'splane', 'ssec'));
    out.push({ type: 'loft', id: ids.splitter, name: 'Impeller splitter', op: 'add', sketches: splitMs.map((_m, i) => ids['ssec' + i]) });
    out.push({ type: 'cpattern', id: ids.splitterPattern, name: 'Impeller splitters', seeds: [ids.splitter], axis: { kind: 'axis', axis: 'z' }, count: p.splitterBlades, angle: 360, equal: true });
  }
  if (p.boreDiameter > 0) {
    out.push(circleSketch(ids.boreSketch, 'Impeller bore sketch', p.boreDiameter));
    out.push({ type: 'extrude', id: ids.bore, name: 'Impeller bore', op: 'cut', sketch: ids.boreSketch, end: 'throughBoth', depth: round(p.hubLength) });
  }
  return out;
}

/** The whole part document of an impeller (for tests, samples and the script panel). */
export function impellerDocument(p: ImpellerParams = DEFAULT_IMPELLER, name = 'Turbo impeller'): Record<string, unknown> {
  const errs = impellerErrors(p);
  if (errs.length) throw new ImpellerError(errs);
  const ids: Record<string, string> = {};
  let n = 1;
  for (const r of impellerRoles(p)) ids[r] = `F${n++}`;
  return { format: 'ck-part', version: 1, name, features: impellerFeatures(p, ids), seq: n, rollback: null, material: 'aluminium', counters: {} };
}

// ---- the wizard's edit path: record, owner, ops (live preview), plan (commit) ----

/** Presets (illustrative sizes, not tied to any product). */
export const IMPELLER_PRESETS: Record<string, Partial<ImpellerParams>> = {
  comp7: {},
  comp5: { mainBlades: 5, splitterBlades: 5, exducerDiameter: 32, inducerDiameter: 14, hubLength: 12, boreDiameter: 6 },
  wide9: { mainBlades: 9, splitterBlades: 9, exducerDiameter: 63, inducerDiameter: 28, hubLength: 22, boreDiameter: 12, wrapDeg: 100, stations: 16, splitterStart: 0.5 },
};

/** Reads an impeller record off a feature (the parameters with defaults filled in, and the role
 *  map), or null. The record lives on the hub sketch, like the marine family's. */
export function readImpeller(f: unknown): { params: ImpellerParams; roles: Record<string, string> } | null {
  const rec = (f as { prop?: Record<string, unknown> } | null)?.prop;
  if (!rec || typeof rec !== 'object' || rec.family !== 'impeller') return null;
  const { roles, family: _family, ...rest } = rec as { roles?: Record<string, number | string>; family?: string } & Partial<ImpellerParams>;
  void _family;
  return { params: { ...DEFAULT_IMPELLER, ...rest }, roles: Object.fromEntries(Object.entries((roles ?? {}) as Record<string, number | string>).map(([k, x]) => [k, typeof x === 'number' ? `F${x}` : x])) };
}
/** The impeller that owns this feature id (its hub sketch id and roles), or null. */
export function impellerOwner(features: unknown[], id: string): { hubId: string; params: ImpellerParams; roles: Record<string, string> } | null {
  for (const f of features as Array<{ id: string }>) {
    const g = readImpeller(f);
    if (g && Object.values(g.roles).includes(id)) return { hubId: f.id, params: g.params, roles: g.roles };
  }
  return null;
}

function nextSeq(doc: { features: Array<{ id?: string }>; seq?: number }): number {
  let n = doc.seq ?? 1;
  for (const f of doc.features) { const m = /^F(\d+)$/.exec(String(f.id ?? '')); if (m) n = Math.max(n, Number(m[1]) + 1); }
  return n;
}

/** Ops that create (no `existing`) or regenerate an impeller as ONE edit: the wizard's live
 *  preview and the tests use these. Same structure (same station count, splitter presence and
 *  bore): every feature is replaced in place and keeps its id. Different structure: the old
 *  features are removed, in reverse document order, and the new ones appended. Throws
 *  ImpellerError when the parameters have errors. */
export function impellerOps(doc: { features: Array<{ id?: string }>; seq?: number }, p: ImpellerParams, existing?: Record<string, string>): EditOp[] {
  const errs = impellerErrors(p);
  if (errs.length) throw new ImpellerError(errs);
  const wanted = impellerRoles(p);
  const same = !!existing && wanted.length === Object.keys(existing).length && wanted.every((r) => existing[r]);
  const ops: EditOp[] = [];
  const ids: Record<string, string> = {};
  if (existing && same) {
    for (const r of wanted) ids[r] = existing[r];
    impellerFeatures(p, ids).forEach((f) => ops.push({ op: 'replace', id: f.id, feature: f as unknown as Record<string, unknown> } as EditOp));
    const at = ops.findIndex((o) => (o as { id?: string }).id === ids.hubSketch);
    if (at > 0) ops.unshift(ops.splice(at, 1)[0]);
    return ops;
  }
  if (existing) {
    const gone = new Set(Object.values(existing));
    for (const id of [...doc.features.map((f) => f.id as string)].reverse()) if (gone.has(id)) ops.push({ op: 'remove', id, cascade: true });
  }
  let seq = nextSeq(doc);
  for (const r of wanted) ids[r] = `F${seq++}`;
  impellerFeatures(p, ids).forEach((f) => ops.push({ op: 'add', feature: f as unknown as Record<string, unknown> } as EditOp));
  return ops;
}

export interface ImpellerPlan {
  /** Removals to apply first (as one edit): only when a regeneration changes the structure. */
  before: EditOp[];
  /** The document patch that is ONE undo step. */
  patch: { variables: unknown[]; features?: Record<string, Record<string, unknown>>; append?: Array<Record<string, unknown>>; seq?: number };
}
/** What to commit: a new impeller appended, or the regeneration of `existing` (same structure:
 *  one patch replacing the features in place; a different structure: the old features are removed
 *  first, then the new ones appended, so two undo steps). Throws ImpellerError for parameters
 *  with errors. */
export function impellerPlan(doc: { features: Array<{ id?: string }>; seq?: number; variables?: unknown[] }, p: ImpellerParams, existing?: Record<string, string>): ImpellerPlan {
  const errs = impellerErrors(p);
  if (errs.length) throw new ImpellerError(errs);
  const wanted = impellerRoles(p);
  const vars = (doc.variables ?? []) as unknown[];
  const same = !!existing && wanted.length === Object.keys(existing).length && wanted.every((r) => existing[r]);
  if (existing && same) {
    const feats = impellerFeatures(p, existing);
    return { before: [], patch: { variables: vars, features: Object.fromEntries(feats.map((f) => [f.id, f as unknown as Record<string, unknown>])) } };
  }
  const before: EditOp[] = [];
  let features = doc.features;
  if (existing) {
    const gone = new Set(Object.values(existing));
    for (const id of [...doc.features.map((f) => f.id as string)].reverse()) if (gone.has(id)) before.push({ op: 'remove', id, cascade: true });
    features = doc.features.filter((f) => !gone.has(f.id as string));
  }
  const start = nextSeq({ features, seq: doc.seq });
  const ids: Record<string, string> = {};
  let n = start;
  for (const r of wanted) ids[r] = `F${n++}`;
  const feats = impellerFeatures(p, ids);
  return { before, patch: { variables: vars, append: feats as unknown as Array<Record<string, unknown>>, seq: start + feats.length } };
}
