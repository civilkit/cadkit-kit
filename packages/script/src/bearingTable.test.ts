import { describe, expect, it } from 'vitest';
import {
  BEARING_PRESETS, bearingModel, bearingPreset, bearingProblem, defaultBallCount, defaultChamfer, findBearings, housingSeat, innerRingPath, innerRingProfile, it7, maxBalls, outerRingPath, outerRingProfile,
  type BearingSpec,
} from './bearingTable';

type Pt = [number, number];
const area = (pts: Pt[]): number => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + (p[0] * q[1] - q[0] * p[1]); }, 0)) / 2;
/** Whether any two non-neighbouring sides of the polygon cross. */
function selfIntersects(pts: Pt[]): boolean {
  const n = pts.length;
  const ccw = (a: Pt, b: Pt, c: Pt): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    const [a, b, c, d] = [pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n]];
    if (ccw(a, b, c) * ccw(a, b, d) < 0 && ccw(c, d, a) * ccw(c, d, b) < 0) return true;
  }
  return false;
}

describe('bearing preset table (nominal ISO 15 sizes)', () => {
  it('has no duplicate designations', () => {
    const names = BEARING_PRESETS.map((p) => p.designation);
    expect(new Set(names).size).toBe(names.length);
    expect(BEARING_PRESETS.length).toBeGreaterThan(60);
  });
  it('every row has a bore smaller than the outer diameter and a plausible width', () => {
    for (const p of BEARING_PRESETS) {
      expect(p.bore, p.designation).toBeGreaterThan(0);
      expect(p.bore, p.designation).toBeLessThan(p.od);
      expect(p.width, p.designation).toBeGreaterThan(0.1 * p.od);       // a ring is never a sliver
      expect(p.width, p.designation).toBeLessThanOrEqual(p.od - p.bore); // and never wider than the radial section is deep, twice over
    }
  });
  it('every row can be built (default model passes the checks) in every seal type', () => {
    for (const p of BEARING_PRESETS) for (const seal of ['open', '2Z', '2RS'] as const) {
      expect(bearingProblem({ bore: p.bore, od: p.od, width: p.width, seal }), `${p.designation} ${seal}`).toBeNull();
    }
  });
  it('the 60xx, 62xx and 63xx rows follow the bore code: the last two digits give bore / 5, 00 to 03 are 10, 12, 15, 17', () => {
    const code: Record<string, number> = { '00': 10, '01': 12, '02': 15, '03': 17 };
    for (const p of BEARING_PRESETS.filter((x) => ['60', '62', '63'].includes(x.series))) {
      const nn = p.designation.slice(2);
      expect(p.bore, p.designation).toBe(code[nn] ?? Number(nn) * 5);
    }
  });
  it('each of those series grows with the bore: outer diameter and width never shrink', () => {
    for (const s of ['60', '62', '63'] as const) {
      const rows = BEARING_PRESETS.filter((p) => p.series === s);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].bore).toBeGreaterThan(rows[i - 1].bore);
        expect(rows[i].od).toBeGreaterThan(rows[i - 1].od);
        expect(rows[i].width).toBeGreaterThanOrEqual(rows[i - 1].width);
      }
    }
  });
  it('the diameter series step up at one bore: 60xx < 62xx < 63xx in outer diameter and width', () => {
    for (const nn of ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']) {
      const [a, b, c] = ['60', '62', '63'].map((s) => BEARING_PRESETS.find((p) => p.designation === s + nn)!);
      expect(a.bore).toBe(b.bore); expect(b.bore).toBe(c.bore);
      expect(a.od).toBeLessThan(b.od); expect(b.od).toBeLessThan(c.od);
      expect(a.width).toBeLessThanOrEqual(b.width); expect(b.width).toBeLessThanOrEqual(c.width);
    }
  });
  it('MR designations read outer diameter then bore (MR63 is 3 x 6)', () => {
    for (const p of BEARING_PRESETS.filter((x) => x.series === 'mr')) expect(p.designation, p.designation).toBe(`MR${p.od}${p.bore}`);
  });
  it('miniature 6xx designations end in the bore in mm', () => {
    for (const p of BEARING_PRESETS.filter((x) => x.series === 'miniature')) expect(p.bore, p.designation).toBe(Number(p.designation.slice(-1)));
  });
  it('well-known sizes', () => {
    const at = (d: string) => BEARING_PRESETS.find((p) => p.designation === d)!;
    expect([at('608').bore, at('608').od, at('608').width]).toEqual([8, 22, 7]);
    expect([at('625').bore, at('625').od, at('625').width]).toEqual([5, 16, 5]);
    expect([at('6204').bore, at('6204').od, at('6204').width]).toEqual([20, 47, 14]);
    expect([at('6305').bore, at('6305').od, at('6305').width]).toEqual([25, 62, 17]);
    expect([at('MR63').bore, at('MR63').od, at('MR63').width]).toEqual([3, 6, 2.5]);
  });
  it('the inch sizes include the 1/8 inch (3.175 mm) bore', () => {
    const inch = BEARING_PRESETS.filter((p) => p.series === 'inch');
    expect(inch.length).toBeGreaterThanOrEqual(5);
    expect(inch.some((p) => p.bore === 3.175)).toBe(true);
    expect(BEARING_PRESETS.find((p) => p.designation === 'R2')).toMatchObject({ bore: 3.175, od: 9.525 });
  });
});

describe('bearing designations and search', () => {
  it('reads seal suffixes', () => {
    expect(bearingPreset('608')).toMatchObject({ preset: { designation: '608' }, seal: null });
    expect(bearingPreset('608-2RS')?.seal).toBe('2RS');
    expect(bearingPreset('608 2rs')?.seal).toBe('2RS');
    expect(bearingPreset('608RS')?.seal).toBe('2RS');
    expect(bearingPreset('6204ZZ')?.seal).toBe('2Z');
    expect(bearingPreset('6204-2Z')?.seal).toBe('2Z');
    expect(bearingPreset('mr63zz')).toMatchObject({ preset: { designation: 'MR63' }, seal: '2Z' });
    expect(bearingPreset('r2')?.preset.bore).toBe(3.175);
    expect(bearingPreset('6204 open')?.seal).toBe('open');
  });
  it('refuses what is not in the table', () => {
    expect(bearingPreset('6999')).toBeNull();
    expect(bearingPreset('banana')).toBeNull();
    expect(bearingPreset('')).toBeNull();
  });
  it('searches by prefix, exact name and size', () => {
    expect(findBearings('620').map((p) => p.designation)).toEqual(['6200', '6201', '6202', '6203', '6204', '6205', '6206', '6207', '6208', '6209']);
    expect(findBearings('608')[0].designation).toBe('608');
    expect(findBearings('mr6').map((p) => p.designation)).toEqual(['MR62', 'MR63']);
    expect(findBearings('8x22').map((p) => p.designation)).toEqual(['608']);
    expect(findBearings('8 x 22 x 7').map((p) => p.designation)).toEqual(['608']);
    expect(findBearings('6204-2RS')[0].designation).toBe('6204');
    expect(findBearings('zzz')).toEqual([]);
    expect(findBearings('').length).toBe(BEARING_PRESETS.length);
  });
});

describe('bearing model', () => {
  const S = (o: Partial<BearingSpec> = {}): BearingSpec => ({ bore: 8, od: 22, width: 7, ...o });
  it('has rings thinner than half the section, a race gap and a chamfer that fits', () => {
    for (const p of BEARING_PRESETS) {
      const m = bearingModel({ bore: p.bore, od: p.od, width: p.width, seal: 'open' });
      expect(m.r1 < m.r2 && m.r2 < m.r3 && m.r3 < m.R, p.designation).toBe(true);
      expect(m.gap, p.designation).toBeGreaterThan(0);
      expect(2 * m.chamfer, p.designation).toBeLessThan(m.ring);
      expect(m.ballDiameter, p.designation).toBeLessThanOrEqual(m.gap);
      expect(m.balls, p.designation).toBeGreaterThanOrEqual(3);
      expect(m.ballDiameter, p.designation).toBeLessThanOrEqual(2 * m.pitchRadius * Math.sin(Math.PI / m.balls) + 1e-9);   // neighbouring balls do not touch
    }
  });
  it('picks the ball count by rule: 7 balls for a 608 and a 625', () => {
    expect(bearingModel(S({ seal: 'open' })).balls).toBe(7);
    expect(bearingModel({ bore: 5, od: 16, width: 5, seal: 'open' }).balls).toBe(7);
    expect(defaultBallCount(16.75, 7.2)).toBeGreaterThanOrEqual(8);
    expect(defaultBallCount(0.5, 5)).toBe(3);
  });
  it('the ball is just under the race gap, and the user can override count and diameter', () => {
    const m = bearingModel(S({ seal: 'open' }));
    expect(m.ballDiameter).toBeCloseTo(0.95 * m.gap, 6);
    expect(bearingModel(S({ seal: 'open', balls: 5, ballDiameter: 3 }))).toMatchObject({ balls: 5, ballDiameter: 3 });
  });
  it('sealed types have no balls', () => {
    expect(bearingModel(S({ seal: '2Z' })).balls).toBe(0);
    expect(bearingModel(S({ seal: '2RS' })).ballDiameter).toBe(0);
  });
  it('the chamfer follows the section height, sharp corners are allowed', () => {
    expect(defaultChamfer(2)).toBe(0.1);
    expect(defaultChamfer(7)).toBe(0.3);
    expect(defaultChamfer(10)).toBe(0.6);
    expect(defaultChamfer(13.5)).toBe(1);
    expect(bearingModel(S({ chamfer: 0 })).chamfer).toBe(0);
  });
  it('says why a bearing cannot be made', () => {
    expect(bearingProblem(S({ bore: 22 }))).toMatch(/smaller than the outer diameter/);
    expect(bearingProblem(S({ bore: 0 }))).toMatch(/positive/);
    expect(bearingProblem(S({ width: Number.NaN }))).toMatch(/positive/);
    expect(bearingProblem(S({ chamfer: 2 }))).toMatch(/half the ring thickness/);
    expect(bearingProblem(S({ chamfer: -1 }))).toMatch(/negative/);
    expect(bearingProblem(S({ seal: 'open', ballDiameter: 9 }))).toMatch(/larger than the gap/);
    expect(bearingProblem(S({ seal: 'open', balls: 13 }))).toMatch(/do not fit/);
    expect(bearingProblem(S({ seal: 'open', balls: 2 }))).toMatch(/3 or more/);
    expect(bearingProblem(S({ seal: '2Z', balls: 7 }))).toMatch(/open bearing only/);
    expect(bearingProblem({ bore: 8, od: 22, width: 0.9, seal: '2Z' })).toMatch(/too small/);
    expect(() => bearingModel(S({ bore: 30 }))).toThrow(/smaller than the outer diameter/);
    expect(bearingProblem(S())).toBeNull();
  });
  it('maxBalls is how many touching balls fit', () => {
    expect(maxBalls(7.5, 3.724)).toBe(12);
  });
});

describe('bearing ring profiles', () => {
  const spec = (seal: BearingSpec['seal'], o: Partial<BearingSpec> = {}): BearingSpec => ({ bore: 8, od: 22, width: 7, seal, ...o });
  /** Area of the disc beyond a chord at distance h from the centre (the groove cut out of the ring at its shoulder). */
  const segment = (r: number, h: number): number => r * r * Math.acos(h / r) - h * Math.sqrt(r * r - h * h);
  const smallBall = { ballDiameter: 1 };   // balls much smaller than the gap: no groove, plain races

  it('without a groove the inner ring is a rectangle with four chamfered corners', () => {
    const m = bearingModel(spec('open', smallBall));
    expect(m.groove).toBeNull();
    expect(m.r2s).toBe(m.r2);
    const pts = innerRingProfile(m);
    expect(pts.length).toBe(8);
    expect(area(pts)).toBeCloseTo(m.ring * m.width - 4 * (m.chamfer * m.chamfer) / 2, 9);
    expect(selfIntersects(pts)).toBe(false);
    for (const [x, y] of pts) { expect(x).toBeGreaterThanOrEqual(m.r1 - 1e-12); expect(x).toBeLessThanOrEqual(m.r2 + 1e-12); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(m.width); }
  });
  it('without a groove the open outer ring is the same with its own radii; sharp corners give a plain rectangle', () => {
    const m = bearingModel(spec('open', smallBall));
    expect(area(outerRingProfile(m))).toBeCloseTo(m.ring * m.width - 4 * (m.chamfer * m.chamfer) / 2, 9);
    const sharp = bearingModel(spec('open', { ...smallBall, chamfer: 0 }));
    expect(innerRingProfile(sharp).length).toBe(4);
    expect(outerRingProfile(sharp).length).toBe(4);
    expect(area(outerRingProfile(sharp))).toBeCloseTo(sharp.ring * sharp.width, 9);
  });

  describe('the ball groove', () => {
    it('608: an arc of 0.52 ball diameters about the ball centre circle at mid-width, 0.27 ball diameters deep', () => {
      const m = bearingModel(spec('open'));
      const g = m.groove!;
      expect(g).not.toBeNull();
      expect(g.radius).toBeCloseTo(0.52 * m.ballDiameter, 12);
      expect(g.depth).toBeCloseTo(0.27 * m.ballDiameter, 12);
      expect(g.centre[0]).toBeCloseTo(m.pitchRadius, 12);
      expect(g.centre[1]).toBeCloseTo(m.width / 2, 12);
      // the numbers of a 608 (ball 3.724): radius 1.936, depth 1.005, centre circle 7.5, shoulders 6.569 and 8.431
      expect(g.radius).toBeCloseTo(1.9365, 3); expect(g.depth).toBeCloseTo(1.0055, 3); expect(m.pitchRadius).toBeCloseTo(7.5, 9);
      expect(m.r2s).toBeCloseTo(6.569, 3); expect(m.r3s).toBeCloseTo(8.431, 3);
      // the shoulders are mirror images about the ball circle
      expect(m.r2s + m.r3s).toBeCloseTo(2 * m.pitchRadius, 12);
      expect(m.pitchRadius - g.radius).toBeCloseTo(m.r2, 1);   // for the default ball the groove bottom is the old race radius
    });
    it('6204: scales with its ball (7.182): radius 3.735, depth 1.939, centre circle 16.75', () => {
      const m = bearingModel({ bore: 20, od: 47, width: 14, seal: 'open' });
      expect(m.groove!.radius).toBeCloseTo(3.7346, 3); expect(m.groove!.depth).toBeCloseTo(1.9391, 3); expect(m.pitchRadius).toBeCloseTo(16.75, 9);
    });
    it('the ball sits in the groove: centre on the groove centre, ball radius <= groove radius, depth < ball radius, no ring point inside the ball', () => {
      for (const p of BEARING_PRESETS) {
        const m = bearingModel({ bore: p.bore, od: p.od, width: p.width, seal: 'open' });
        const g = m.groove;
        if (!g) continue;
        const rb = m.ballDiameter / 2;
        expect(g.centre, p.designation).toEqual([m.pitchRadius, m.width / 2]);
        expect(rb, p.designation).toBeLessThanOrEqual(g.radius);
        expect(g.depth, p.designation).toBeLessThan(rb);
        expect(g.radius - rb, p.designation).toBeGreaterThanOrEqual(0);   // surface clearance of the ball in the groove at its bottom
        for (const pts of [innerRingProfile(m, 200), outerRingProfile(m, 200)]) {
          for (const q of pts) expect(Math.hypot(q[0] - g.centre[0], q[1] - g.centre[1]), p.designation).toBeGreaterThanOrEqual(rb - 1e-9);
        }
        // the shoulders stand on the ball's side of the pitch circle
        expect(m.r2s, p.designation).toBeLessThan(m.pitchRadius); expect(m.r3s, p.designation).toBeGreaterThan(m.pitchRadius);
      }
    });
    it('the ring area is the plain rectangle minus the chamfers and the exact circular segment of the groove', () => {
      const m = bearingModel(spec('open'));
      const g = m.groove!;
      const plain = (m.r2s - m.r1) * m.width - 2 * (m.chamfer * m.chamfer);
      const cut = segment(g.radius, g.radius - g.depth);
      // 4000 chords per arc put the polygon within a few parts in 10^9 of the true area
      expect(area(innerRingProfile(m, 4000))).toBeCloseTo(plain - cut, 5);
      expect(area(outerRingProfile(m, 4000))).toBeCloseTo((m.R - m.r3s) * m.width - 2 * (m.chamfer * m.chamfer) - cut, 5);
    });
    it('the path has one true arc per ring about the ball centre, the profile is simple and symmetric about mid-width', () => {
      const m = bearingModel(spec('open'));
      for (const path of [innerRingPath(m), outerRingPath(m)]) {
        const arcs = path.filter((n) => n.arc);
        expect(arcs.length).toBe(1);
        expect(arcs[0].arc!.c).toEqual(m.groove!.centre);
        const i = path.indexOf(arcs[0]); const a = arcs[0].p, b = path[(i + 1) % path.length].p;
        expect(Math.hypot(a[0] - m.pitchRadius, a[1] - m.width / 2)).toBeCloseTo(m.groove!.radius, 12);
        expect(Math.hypot(b[0] - m.pitchRadius, b[1] - m.width / 2)).toBeCloseTo(m.groove!.radius, 12);
        expect(a[1] + b[1]).toBeCloseTo(m.width, 12);
      }
      for (const pts of [innerRingProfile(m), outerRingProfile(m)]) {
        expect(selfIntersects(pts)).toBe(false);
        for (const [x, y] of pts) expect(pts.some(([a, b]) => Math.abs(a - x) < 1e-9 && Math.abs(b - (m.width - y)) < 1e-9)).toBe(true);
      }
    });
    it('the groove stays clear of the chamfers and the covers, and the wall under it is at least 0.4 mm', () => {
      for (const p of BEARING_PRESETS) for (const seal of ['open', '2Z', '2RS'] as const) {
        const m = bearingModel({ bore: p.bore, od: p.od, width: p.width, seal });
        const g = m.groove;
        if (!g) continue;
        const edge = seal === 'open' ? m.chamfer : Math.max(m.chamfer, m.recess + m.shieldThickness);
        expect(m.width / 2 - g.halfWidth, `${p.designation} ${seal}`).toBeGreaterThanOrEqual(edge + 0.15 - 1e-9);
        expect(g.centre[0] - g.radius - m.r1, `${p.designation} ${seal}`).toBeGreaterThanOrEqual(0.4);
        expect(m.R - (g.centre[0] + g.radius), `${p.designation} ${seal}`).toBeGreaterThanOrEqual(0.4);
        expect(m.shieldTip, `${p.designation} ${seal}`).toBeGreaterThan(m.r2s);
        expect(m.shieldTip, `${p.designation} ${seal}`).toBeLessThan(m.r3s);
      }
    });
    it('a sealed bearing is grooved for the default ball; the only presets left plain are the tiniest MR sizes (a ring under 0.4 mm)', () => {
      const plain = new Set<string>();
      for (const p of BEARING_PRESETS) for (const seal of ['open', '2Z', '2RS'] as const) {
        const m = bearingModel({ bore: p.bore, od: p.od, width: p.width, seal });
        if (!m.groove) { plain.add(p.designation); expect(m.r2s).toBe(m.r2); expect(m.r3s).toBe(m.r3); }
        if (seal !== 'open') expect(m.ballDiameter).toBe(0);
      }
      expect([...plain].sort()).toEqual(['MR52', 'MR63', 'MR74', 'MR85']);
      const sealed = bearingModel(spec('2RS'));
      expect(sealed.groove!.radius).toBeCloseTo(0.52 * sealed.grooveBall, 12);
    });
    it('a custom ball sets the groove; balls much smaller than the gap, or a ring too thin, keep the plain race', () => {
      const big = bearingModel(spec('open', { ballDiameter: 3.9 }));
      expect(big.groove!.radius).toBeCloseTo(0.52 * 3.9, 12);
      expect(bearingModel(spec('open', { ballDiameter: 2 })).groove).toBeNull();
      expect(bearingModel({ bore: 3, od: 6, width: 2.5, seal: 'open' }).groove).toBeNull();
      expect(bearingProblem(spec('open', { ballDiameter: 2 }))).toBeNull();
    });
  });

  for (const seal of ['2Z', '2RS'] as const) {
    it(`${seal}: the outer ring carries a cover at each face, mirror-symmetric, simple, and clear of the inner ring`, () => {
      const m = bearingModel(spec(seal));
      const pts = outerRingProfile(m);
      expect(selfIntersects(pts)).toBe(false);
      expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(m.shieldTip, 9);
      expect(m.shieldTip).toBeGreaterThan(m.r2s);
      expect(m.shieldTip).toBeLessThan(m.r3s);
      // mirror symmetry about the mid plane: every point has a partner at B - y
      for (const [x, y] of pts) expect(pts.some(([a, b]) => Math.abs(a - x) < 1e-9 && Math.abs(b - (m.width - y)) < 1e-9)).toBe(true);
      // the cover adds material to the open ring's area, but not more than the two discs (the plain outer ring, without a groove, is the yardstick)
      const open = bearingModel(spec('open'));
      const extra = area(pts) - area(outerRingProfile(open, 4000));
      expect(extra).toBeGreaterThan(0);
      expect(extra).toBeLessThan(2 * (m.r3s - m.shieldTip) * m.shieldThickness + 1e-9 + 2 * m.chamfer * m.recess);
      // the two covers leave an open cavity between them, with the groove on its wall
      const ys = pts.filter(([x]) => Math.abs(x - m.r3s) < 1e-9).map(([, y]) => y);
      expect(ys.some((y) => y > m.recess + m.shieldThickness - 1e-9 && y < m.width / 2)).toBe(true);
      expect(outerRingPath(m).filter((n) => n.arc).length).toBe(1);
    });
  }
  it('2RS is thicker than 2Z and its lip slopes', () => {
    const z = bearingModel(spec('2Z')), rs = bearingModel(spec('2RS'));
    expect(rs.shieldThickness).toBeGreaterThan(z.shieldThickness);
    expect(rs.shieldTip).toBeLessThan(z.shieldTip);
    expect(outerRingProfile(rs).length).toBeGreaterThan(outerRingProfile(z).length);
  });
  it('every preset gives simple profiles for every seal type', () => {
    for (const p of BEARING_PRESETS) for (const seal of ['open', '2Z', '2RS'] as const) {
      const m = bearingModel({ bore: p.bore, od: p.od, width: p.width, seal });
      expect(selfIntersects(innerRingProfile(m)), `${p.designation} inner`).toBe(false);
      expect(selfIntersects(outerRingProfile(m)), `${p.designation} ${seal} outer`).toBe(false);
    }
  });
});

describe('housing seat', () => {
  it('H7 cuts at the middle of the +IT7 / 0 zone over the outer diameter', () => {
    expect(it7(22)).toBe(21);
    const s = housingSeat({ od: 22, width: 7 });
    expect(s.fit).toBe('h7');
    expect(s.diameter).toBeCloseTo(22.0105, 2);
    expect(s.depth).toBe(7);
    expect(s.note).toMatch(/H7/);
    expect(housingSeat({ od: 47, width: 14 }).diameter).toBeCloseTo(47.0125, 2);   // IT7 of 30 to 50 mm is 25 um
  });
  it('press fit keeps the nominal diameter, print adds a clearance, an allowance replaces both', () => {
    expect(housingSeat({ od: 22, width: 7, fit: 'press' }).diameter).toBe(22);
    expect(housingSeat({ od: 22, width: 7, fit: 'print' }).diameter).toBeCloseTo(22.2, 9);
    const custom = housingSeat({ od: 22, width: 7, fit: 'h7', allowance: 0.05 });
    expect(custom.diameter).toBeCloseTo(22.05, 9);
    expect(custom.allowance).toBe(0.05);
  });
  it('the IT7 grade rises with the size', () => {
    const grades = [2, 5, 8, 15, 25, 40, 70, 100, 150, 200].map(it7);
    for (let i = 1; i < grades.length; i++) expect(grades[i]).toBeGreaterThanOrEqual(grades[i - 1]);
    expect(it7(1000)).toBe(46);
  });
});

describe('flanged F6xx bearings', () => {
  const f625 = bearingPreset('F625-2Z')!;
  it('F625 is a 625 with a flange of 18 x 1 mm, and the preset is found with its seal suffix', () => {
    expect(f625.preset).toMatchObject({ designation: 'F625', bore: 5, od: 16, width: 5, flange: { diameter: 18, thickness: 1 } });
    expect(f625.seal).toBe('2Z');
    const plain = BEARING_PRESETS.find((p) => p.designation === '625')!;
    expect([f625.preset.bore, f625.preset.od, f625.preset.width]).toEqual([plain.bore, plain.od, plain.width]);
  });
  it('every flanged row has a flange wider than the ring and thinner than the bearing, and builds in every seal', () => {
    const rows = BEARING_PRESETS.filter((p) => p.series === 'flanged');
    expect(rows.map((p) => p.designation)).toEqual(['F623', 'F624', 'F625', 'F626']);
    for (const p of rows) for (const seal of ['open', '2Z', '2RS'] as const) {
      expect(p.flange!.diameter, p.designation).toBeGreaterThan(p.od);
      expect(bearingProblem({ bore: p.bore, od: p.od, width: p.width, seal, flange: p.flange }), `${p.designation} ${seal}`).toBeNull();
    }
  });
  it('the flange sits on the first face of the outer ring: its profile reaches the flange radius there and only there', () => {
    for (const seal of ['open', '2Z', '2RS'] as const) {
      const p = f625.preset;
      const plain = outerRingProfile(bearingModel({ bore: p.bore, od: p.od, width: p.width, seal }));
      const fl = outerRingProfile(bearingModel({ bore: p.bore, od: p.od, width: p.width, seal, flange: p.flange }));
      expect(Math.max(...plain.map((q) => q[0])), seal).toBeCloseTo(8, 9);
      expect(Math.max(...fl.map((q) => q[0])), seal).toBeCloseTo(9, 9);
      expect(Math.min(...fl.filter((q) => q[0] > 8.5).map((q) => q[1])), seal).toBeCloseTo(0, 9);
      expect(Math.max(...fl.filter((q) => q[0] > 8.5).map((q) => q[1])), seal).toBeCloseTo(1, 9);   // the flange is 1 mm thick
      // the added section is the flange ring: pi-free check by area, (9^2 - 8^2) / 2 per unit of angle minus the chamfer corners, within a chamfer's worth
      expect(area(fl) - area(plain), seal).toBeGreaterThan(0.9 * 1 * 1);
      expect(area(fl) - area(plain), seal).toBeLessThan(1.0 * 1.0 + 0.01);
      expect(selfIntersects(fl), seal).toBe(false);
    }
  });
  it('refuses a flange that is not outside the ring or is as thick as the bearing', () => {
    expect(bearingProblem({ bore: 5, od: 16, width: 5, flange: { diameter: 16, thickness: 1 } })).toMatch(/flange diameter/);
    expect(bearingProblem({ bore: 5, od: 16, width: 5, flange: { diameter: 18, thickness: 5 } })).toMatch(/flange thickness/);
  });
});
