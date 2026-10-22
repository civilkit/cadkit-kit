// Turbo-impeller geometry: a pure data module (no side effects, no kernel types) in the marine
// family's shape. The build route is the one the kernel probe proved: a revolved hub from a
// meridional contour, then one closed "band" section per station in planes through the shaft
// axis, lofted (add) into the blade, patterned about z, and a bore cut.
//
// Blade thickness is tangential (perpendicular to each section plane), so a section is the thin
// band where its plane cuts the blade: the hub-to-shroud line shifted +-dm ALONG THE MERIDIONAL
// DIRECTION, dm = (t/2) / (r dtheta/dm) in m-parameter units -- the physical shift multiplies by
// the meridional speed |dH/dm| (probe lesson: shifting along the span line itself, or by the bare
// parameter-space amount, yields zero-area sections the kernel refuses as loftProfile).
//
// Parameters stay neutral for the radial-inflow-turbine variant the brief flags for later: the
// meridional contour is a hub profile, wrapDeg is just total wrap (backsweep for a compressor).

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

const round = (v: number, d = 5): number => { const k = 10 ** d; return Math.round(v * k) / k; };
const rad = (d: number): number => (d * Math.PI) / 180;

// Meridional hub contour (z, r): nose face, cone out to a knee at 75% length, tip edge to the
// rim, back face to the axis. The closing edge sits on v = 0 and doubles as the revolve axis.
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
  return p.bladeThickness + ((p.tipThickness - p.bladeThickness) * (r - rN)) / (rX - rN);
};

// One band section: the hub->shroud line at meridional parameter m, shifted +-dm along the
// meridional tangent into a closed quadrilateral (front, tip, back, root). Returns the section
// sketch data plus the plane angle (psi + 90, the marine family's convention: u = world Z,
// v = radial at psi).
export interface ImpellerSection {
  m: number;
  psiDeg: number;
  planeAngleDeg: number;
  quad: Array<[number, number]>; // [Hf, Sf, Sb, Hb] in (z, r)
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
  return { m, psiDeg, planeAngleDeg: psiDeg + 90, quad: [[round(Hf[0]), round(Hf[1])], [round(Sf[0]), round(Sf[1])], [round(Sb[0]), round(Sb[1])], [round(Hb[0]), round(Hb[1])]] };
}

export function impellerDocument(p: ImpellerParams = DEFAULT_IMPELLER): Record<string, unknown> {
  const feats: Array<Record<string, unknown>> = [];
  let n = 1;
  const id = (): string => `F${n++}`;
  // hub: sketch on an angle plane (u = world Z, v = radial at 0), revolved about its v=0 edge
  const hubPlane = id();
  feats.push({ type: 'plane', id: hubPlane, name: 'Hub meridian plane', mode: 'angle', base: { kind: 'std', id: 'right' }, axis: { kind: 'axis', axis: 'z' }, angle: 90, visible: false });
  const hubSketch = id();
  const HUB = hubContour(p);
  feats.push({
    type: 'sketch', id: hubSketch, name: 'Hub sketch', plane: { kind: 'feature', id: hubPlane },
    points: HUB.map(([z, r], i) => ({ id: 'h' + i, x: round(z), y: round(r) })),
    entities: HUB.map((_, i) => ({ type: 'line', id: 'e' + i, p1: 'h' + i, p2: 'h' + ((i + 1) % HUB.length) })),
    constraints: [], visible: false,
  });
  feats.push({ type: 'revolve', id: id(), name: 'Hub', op: 'add', sketch: hubSketch, axis: 'e4', end: 'blind', angle: 360 });

  const loftPattern = (name: string, secMs: number[], phaseDeg: number, count: number): void => {
    if (count < 1 || secMs.length < 2) return;
    const secIds: string[] = [];
    for (const m of secMs) {
      const s = impellerSection(m, p, phaseDeg);
      const pid = id();
      feats.push({ type: 'plane', id: pid, name: `${name} plane ${round(m, 3)}`, mode: 'angle', base: { kind: 'std', id: 'right' }, axis: { kind: 'axis', axis: 'z' }, angle: round(s.planeAngleDeg), visible: false });
      const sid = id();
      secIds.push(sid);
      feats.push({
        type: 'sketch', id: sid, name: `${name} section ${round(m, 3)}`, plane: { kind: 'feature', id: pid },
        points: s.quad.map(([z, r], i) => ({ id: 'q' + i, x: z, y: r })),
        entities: [
          { type: 'line', id: 'front', p1: 'q0', p2: 'q1' }, { type: 'line', id: 'tip', p1: 'q1', p2: 'q2' },
          { type: 'line', id: 'back', p1: 'q2', p2: 'q3' }, { type: 'line', id: 'root', p1: 'q3', p2: 'q0' },
        ],
        constraints: [],
      });
    }
    const loftId = id();
    feats.push({ type: 'loft', id: loftId, name, op: 'add', sketches: secIds });
    if (count > 1) feats.push({ type: 'cpattern', id: id(), name: `${name} pattern`, seeds: [loftId], axis: { kind: 'axis', axis: 'z' }, count, angle: 360, equal: true });
  };

  const mainMs = Array.from({ length: p.stations }, (_, i) => (i + 0.5) / p.stations);
  loftPattern('Blade', mainMs, 0, p.mainBlades);
  if (p.splitterBlades > 0) {
    const splitMs = mainMs.filter((m) => m >= p.splitterStart);
    if (splitMs.length >= 2) loftPattern('Splitter', splitMs, 180 / p.splitterBlades, p.splitterBlades);
  }

  const boreSketch = id();
  feats.push({ type: 'sketch', id: boreSketch, name: 'Bore sketch', plane: { kind: 'std', id: 'front' }, points: [{ id: 'p', x: 0, y: 0 }], entities: [{ type: 'circle', id: 'c', c: 'p', r: p.boreDiameter / 2 }], constraints: [] });
  feats.push({ type: 'extrude', id: id(), name: 'Bore', op: 'cut', sketch: boreSketch, end: 'throughBoth', depth: p.hubLength });
  return { format: 'ck-part', version: 1, name: 'Turbo impeller', features: feats, seq: n, rollback: null, material: 'aluminium', counters: {} };
}
