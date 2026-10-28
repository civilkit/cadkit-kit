// Knurling: grooves cut around a cylinder. Mixed into PartBuilder by features/index.ts.
// Built only from features the kernel already has: one multi-profile extrude cut (straight), one multi-profile revolve cut (rings),
// and a twisted sweep cut along the cylinder axis (helical). No circular pattern: it only rotates about a world axis through the origin,
// and one cut with N profiles is also several times faster than N patterned cuts.
import type { Num, OffsetPlane, PartBuilder, Plane, SketchBuilder } from '../recorder';
import { H } from './h';
import type { CosmeticKnurl } from '../cosmeticKnurl';
import { facetedKnurl, facetedRefusal } from './knurlFaceted';

type Axis = 'x' | 'y' | 'z';
type Pt = [number, number];

export interface KnurlOpts {
  /** the cylinder axis: a world axis, default 'z' */
  axis?: Axis;
  /** the two world coordinates of the axis line in the plane across it: [x, y] for axis z, [x, z] for y, [y, z] for x. Default [0, 0] */
  center?: [Num, Num];
  /** radius of the cylinder surface being knurled */
  radius: Num;
  /** axial extent in world coordinates along the axis */
  from: Num;
  to: Num;
  /** 'straight' (axial grooves), 'diamond' (two crossed helical sets) or 'pyramid' (axial grooves crossed by ring grooves, leaves raised square pyramids) */
  pattern?: 'straight' | 'diamond' | 'pyramid';
  /** grooves around the circumference (per hand for a diamond); or pitch instead */
  count?: number;
  /** distance between groove centres along the surface; sets count = round(2 pi radius / pitch) */
  pitch?: Num;
  /** groove depth, default a quarter of the pitch */
  depth?: Num;
  /** 'v' (default) or 'round' */
  profile?: 'v' | 'round';
  /** included angle of a V groove in degrees, default 90 */
  angle?: number;
  /** width of a round groove at the surface, default 2 * depth (a half circle) */
  width?: Num;
  /** diamond: helix angle from the axis in degrees (0 = straight, 45 = one turn over a length equal to the circumference), default 30 */
  helixAngle?: number;
  /** pyramid: distance between rings, default equal to the groove pitch (square pyramids) */
  ringPitch?: Num;
  /** 'cut' (default): cut the grooves, so mass and exports include them. 'cosmetic': only record the knurl for display; the solid stays a plain cylinder, instant at any density */
  mode?: 'cut' | 'cosmetic';
  /** 'faceted' (default for a V diamond or pyramid): the kernel builds the knurled surface as faces and cuts it once, seconds for any count. 'boolean': cut the grooves one set against the other (slow when dense; needed for round grooves) */
  method?: 'faceted' | 'boolean';
}

const sketchPlane: Record<Axis, Plane> = { z: 'front', y: 'top', x: 'right' };

/** The geometry of a knurl: per axis, how world axial/radial positions map to the sketch planes used. */
function frame(axis: Axis, c: Pt, line: number) {
  const off = (base: Plane, offset: number): Plane | OffsetPlane => (offset === 0 ? base : ({ kind: 'offset', plane: base, offset, opts: {}, line } as OffsetPlane));
  // cross: the plane across the axis (profiles of axial grooves). cu, cv: sketch coordinates of the axis point there.
  // side: a plane containing the axis (ring profiles and the sweep path). a(): axial -> sketch point on the axis line, r(): radial offset added.
  if (axis === 'z') return {
    cross: (a: number) => off('front', a), cu: c[0], cv: c[1],
    side: off('right', c[0]), axisPt: (a: number): Pt => [-a, c[1]], ringPt: (a: number, r: number): Pt => [-a, c[1] + r],
  };
  if (axis === 'y') return {
    cross: (a: number) => off('top', a), cu: c[0], cv: -c[1],
    side: off('front', c[1]), axisPt: (a: number): Pt => [c[0], a], ringPt: (a: number, r: number): Pt => [c[0] + r, a],
  };
  return {
    cross: (a: number) => off('right', a), cu: -c[1], cv: c[0],
    side: off('front', c[1]), axisPt: (a: number): Pt => [a, c[0]], ringPt: (a: number, r: number): Pt => [a, c[0] + r],
  };
}

export const knurlFeatures = {
  /**
   * Knurl a cylinder: cut straight, diamond or pyramid grooves into it.
   *
   * Describe the cylinder (axis x, y or z, centre, radius, axial range from..to). 'straight' cuts axial grooves in one cut (fast). 'diamond' cuts two crossed helical sets, one per hand, each a twisted sweep (slow: the helper stops above 260 groove crossings, count squared times twice the turn fraction, because the kernel's boolean budget fails around 570). 'pyramid' crosses axial grooves with rings for raised square pyramids. Give count (per hand for a diamond) or pitch, and depth (default pitch / 4). profile 'v' (angle, default 90) or 'round' (width, default 2 * depth). mode 'cosmetic' skips the cutting: it records the knurl in the document for display only, instant at any count. Overlapping grooves are refused with the largest count that fits. On a 20 mm diameter, 12 mm band: straight 24 grooves under 1 s, pyramid 24 x 8 about 11 s, diamond 12 + 12 at 22 degrees about 4 s, 16 + 16 at 45 degrees about 23 s.
   * faceted (the default for a V diamond or pyramid) builds the surface as faces in the kernel: linear in the groove count, planar flanks (volume within about 3 percent); method 'boolean' cuts the grooves one set against the other (slow when dense; round grooves and straight always use the cuts).
   *
   * @domain features
   * @param o options object { radius, from, to, count | pitch, ... }, the fields below
   * @param o.axis 'x' | 'y' | 'z' (default 'z')
   * @param o.center [h, k] world coordinates of the axis: [x, y] for z, [x, z] for y, [y, z] for x (default [0, 0])
   * @param o.radius cylinder radius in mm
   * @param o.from axial start in world coordinates
   * @param o.to axial end in world coordinates
   * @param o.pattern 'straight' (default) | 'diamond' | 'pyramid'
   * @param o.count grooves round the circumference (per hand for a diamond)
   * @param o.pitch spacing along the surface instead of count
   * @param o.depth groove depth, default pitch / 4
   * @param o.profile 'v' (default) | 'round'
   * @param o.angle included angle of a V groove in degrees, default 90
   * @param o.width width of a round groove at the surface, default 2 * depth
   * @param o.helixAngle diamond: angle of the grooves from the axis in degrees, default 30
   * @param o.ringPitch pyramid: spacing of the ring grooves, default the groove pitch
   * @param o.mode 'cut' (default) cuts the grooves; 'cosmetic' only draws them (instant, solid unchanged, not in mass or exports)
   * @param o.method 'faceted' (default for V diamond and pyramid) | 'boolean'
   * @example
   * part('Knob').sketch('front', (s) => s.circle(15)).extrude(12)
   *   .knurl({ axis: 'z', radius: 15, from: 0, to: 12, pattern: 'straight', count: 36, depth: 0.5 });
   * @see part.sweep, part.cut, part.revolve
   */
  knurl(this: PartBuilder, o: KnurlOpts): PartBuilder {
    const line = H.callerLine();
    const fail = (m: string): never => { throw new H.SelectorError(`knurl(): ${m}`, line); };
    if (!o || typeof o !== 'object') fail('needs an options object { radius, from, to, count | pitch, depth }');
    const axis: Axis = o.axis ?? 'z';
    if (!(axis in sketchPlane)) fail(`axis must be 'x', 'y' or 'z'`);
    const R = H.num(o.radius), from = H.num(o.from), to = H.num(o.to);
    const c: Pt = [H.num(o.center?.[0] ?? 0), H.num(o.center?.[1] ?? 0)];
    if (!(R > 0)) fail('radius must be positive');
    if (!(to > from)) fail('to must be greater than from');
    const pattern = o.pattern ?? 'straight';
    if (!['straight', 'diamond', 'pyramid'].includes(pattern)) fail(`pattern must be 'straight', 'diamond' or 'pyramid'`);
    const mode = o.mode ?? 'cut';
    if (mode !== 'cut' && mode !== 'cosmetic') fail(`mode must be 'cut' or 'cosmetic'`);
    const profile = o.profile ?? 'v';
    if (profile !== 'v' && profile !== 'round') fail(`profile must be 'v' or 'round'`);
    const circ = 2 * Math.PI * R;
    let N: number;
    if (o.count !== undefined) N = Math.round(o.count);
    else if (o.pitch !== undefined) N = Math.round(circ / H.num(o.pitch));
    else return fail('give count (grooves round the circumference) or pitch');
    if (!(N >= 3)) fail('needs at least 3 grooves round the circumference');
    const pitch = circ / N;
    const d = o.depth !== undefined ? H.num(o.depth) : pitch / 4;
    if (!(d > 0) || d >= R) fail(`depth must be positive and smaller than the radius (${R})`);

    // groove profile: width across the surface (chord), the overshoot beyond the surface so the cut never ends on it
    const alpha = ((o.angle ?? 90) * Math.PI) / 180;
    if (!(alpha > 0 && alpha < Math.PI)) fail('angle must be between 0 and 180 degrees');
    const roundWidth = o.width !== undefined ? H.num(o.width) : 2 * d;
    const e = Math.max(0.25 * d, 0.1);
    let chord: number, rho = 0, hwOut = 0;
    if (profile === 'v') { chord = 2 * d * Math.tan(alpha / 2); hwOut = (d + e) * Math.tan(alpha / 2); }
    else {
      const w = roundWidth;
      if (!(w > 0)) fail('width must be positive');
      rho = (d * d + (w / 2) * (w / 2)) / (2 * d);
      chord = w;
    }
    const spacingChord = (n: number): number => 2 * R * Math.sin(Math.PI / n);   // straight distance between neighbouring groove centres
    const roomy = (n: number, ch: number): boolean => ch <= 0.9 * spacingChord(n);
    const maxCount = (ch: number): number => { let n = N; while (n > 3 && !roomy(n, ch)) n--; return n; };
    if (mode === 'cosmetic') {
      const ha = o.helixAngle ?? 30;
      if (pattern === 'diamond' && !(ha > 0 && ha < 80)) fail('helixAngle must be between 0 and 80 degrees (0 would be a straight knurl)');
      const rp = o.ringPitch !== undefined ? H.num(o.ringPitch) : pitch;
      if (!(rp > 0)) fail('ringPitch must be positive');
      const rec: CosmeticKnurl = { axis, center: c, radius: R, from, to, pattern, count: N, depth: d, profile, angle: o.angle ?? 90, width: roundWidth, helixAngle: ha, ringPitch: rp };
      this.cosmetic.push(rec);
      return this;
    }
    if (!roomy(N, chord)) fail(`${N} grooves of width ${chord.toFixed(2)} mm overlap on a radius ${R} cylinder (the kernel then silently removes too much); use at most ${maxCount(chord)} grooves or a smaller depth`);

    // faceted: the kernel builds the diamond or pyramid surface as faces (knurlFaceted.ts); the cut-based code below is the 'boolean' method
    const method = o.method ?? (pattern !== 'straight' && profile === 'v' ? 'faceted' : 'boolean');
    if (method !== 'faceted' && method !== 'boolean') fail(`method must be 'faceted' or 'boolean'`);
    if (method === 'faceted') {
      const why = facetedRefusal(pattern, profile);
      if (why) fail(why);
      const ha = o.helixAngle ?? 30;
      if (pattern === 'diamond' && !(ha > 0 && ha < 80)) fail('helixAngle must be between 0 and 80 degrees (0 would be a straight knurl)');
      const rp = o.ringPitch !== undefined ? H.num(o.ringPitch) : pitch;
      if (pattern === 'pyramid' && !(rp > chord / 0.9)) fail(`ringPitch ${rp.toFixed(2)} is too small for grooves ${chord.toFixed(2)} mm wide`);
      return facetedKnurl(this, line, { axis, center: c, radius: R, from, to, pattern: pattern as 'diamond' | 'pyramid', count: N, depth: d, angle: o.angle ?? 90, helixAngle: ha, ringPitch: rp });
    }

    const f = frame(axis, c, line);
    const len = to - from;
    const rad = (a: number): Pt => [Math.cos(a), Math.sin(a)];
    // all N groove profiles around the axis, drawn into one sketch on the cross plane
    const drawGrooves = (s: SketchBuilder): void => {
      for (let i = 0; i < N; i++) {
        const [ca, sa] = rad((2 * Math.PI * i) / N);
        const T = (r: number, t: number): Pt => [f.cu + r * ca - t * sa, f.cv + r * sa + t * ca];   // radial r, tangential t
        if (profile === 'v') s.polygon([T(R - d, 0), T(R + e, hwOut), T(R + e, -hwOut)]);
        else s.circle(rho, T(R - d + rho, 0));
      }
    };

    if (pattern === 'straight' || pattern === 'pyramid') {
      this.sketch(f.cross(from) as Plane, drawGrooves).cut(len, { direction: 'away' });
    }
    if (pattern === 'pyramid') {
      const rp = o.ringPitch !== undefined ? H.num(o.ringPitch) : pitch;
      if (!(rp > chord / 0.9)) fail(`ringPitch ${rp.toFixed(2)} is too small for grooves ${chord.toFixed(2)} mm wide`);
      const M = Math.max(1, Math.floor(len / rp));
      const step = len / M;
      this.sketch(f.side as Plane, (s) => {
        for (let k = 0; k < M; k++) {
          const a = from + step * (k + 0.5);
          if (profile === 'v') s.polygon([f.ringPt(a, R - d), f.ringPt(a + hwOut, R + e), f.ringPt(a - hwOut, R + e)]);
          else s.circle(rho, f.ringPt(a, R - d + rho));
        }
      }).revolve(360, { op: 'cut', axis: { from: f.axisPt(from), to: f.axisPt(to) } });
    }
    if (pattern === 'diamond') {
      const ha = o.helixAngle ?? 30;
      if (!(ha > 0 && ha < 80)) fail('helixAngle must be between 0 and 80 degrees (0 would be a straight knurl)');
      const twist = ((len * Math.tan((ha * Math.PI) / 180)) / R) * (180 / Math.PI);   // degrees turned over the band
      const crossings = N * N * ((2 * twist) / 360);
      if (crossings > 260) fail(`a diamond of ${N} + ${N} grooves turning ${twist.toFixed(0)} degrees over the band makes about ${Math.round(crossings)} crossings; the kernel's boolean budget gives out somewhere between 220 (tested, 30 s) and 570 (tested, fails after 2 minutes), so the helper stops at 260. Use a smaller count, a shorter band or a larger helixAngle`);
      for (const hand of [1, -1]) {
        this.sweep(
          { on: f.cross(from), draw: drawGrooves },
          { on: f.side, draw: (s) => { const a = f.axisPt(from), b = f.axisPt(to); s.line(a, b); } },
          { op: 'cut', twist: hand * twist },
        );
      }
    }
    return this;
  },
};
