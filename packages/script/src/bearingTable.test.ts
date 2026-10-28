import { describe, expect, it } from 'vitest';
import {
  BEARING_PRESETS, bearingModel, bearingPreset, bearingProblem, defaultBallCount, defaultChamfer, findBearings, housingSeat, innerRingProfile, it7, maxBalls, outerRingProfile,
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
  it('the inner ring is a rectangle with four chamfered corners', () => {
    const m = bearingModel(spec('open'));
    const pts = innerRingProfile(m);
    expect(pts.length).toBe(8);
    expect(area(pts)).toBeCloseTo(m.ring * m.width - 4 * (m.chamfer * m.chamfer) / 2, 9);
    expect(selfIntersects(pts)).toBe(false);
    for (const [x, y] of pts) { expect(x).toBeGreaterThanOrEqual(m.r1 - 1e-12); expect(x).toBeLessThanOrEqual(m.r2 + 1e-12); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(m.width); }
  });
  it('the open outer ring is the same with its own radii; sharp corners give a plain rectangle', () => {
    const m = bearingModel(spec('open'));
    expect(area(outerRingProfile(m))).toBeCloseTo(m.ring * m.width - 4 * (m.chamfer * m.chamfer) / 2, 9);
    const sharp = bearingModel(spec('open', { chamfer: 0 }));
    expect(innerRingProfile(sharp).length).toBe(4);
    expect(outerRingProfile(sharp).length).toBe(4);
    expect(area(outerRingProfile(sharp))).toBeCloseTo(sharp.ring * sharp.width, 9);
  });
  for (const seal of ['2Z', '2RS'] as const) {
    it(`${seal}: the outer ring carries a cover at each face, mirror-symmetric, simple, and clear of the inner ring`, () => {
      const m = bearingModel(spec(seal));
      const pts = outerRingProfile(m);
      expect(selfIntersects(pts)).toBe(false);
      expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(m.shieldTip, 9);
      expect(m.shieldTip).toBeGreaterThan(m.r2);
      expect(m.shieldTip).toBeLessThan(m.r3);
      // mirror symmetry about the mid plane: every point has a partner at B - y
      for (const [x, y] of pts) expect(pts.some(([a, b]) => Math.abs(a - x) < 1e-9 && Math.abs(b - (m.width - y)) < 1e-9)).toBe(true);
      // the cover adds material to the open ring's area, but not more than the two discs
      const open = bearingModel(spec('open'));
      const extra = area(pts) - area(outerRingProfile(open));
      expect(extra).toBeGreaterThan(0);
      expect(extra).toBeLessThan(2 * (m.r3 - m.shieldTip) * m.shieldThickness + 1e-9 + 2 * m.chamfer * m.recess);
      // the two covers leave an open cavity between them
      const ys = pts.filter(([x]) => Math.abs(x - m.r3) < 1e-9).map(([, y]) => y);
      expect(ys.some((y) => y > m.recess + m.shieldThickness - 1e-9 && y < m.width / 2)).toBe(true);
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
