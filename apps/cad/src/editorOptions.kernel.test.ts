// The Fillet full round, Extrude twist, Loft centre line / connectors and variable Thicken options against the real
// kernel: each option, set with the patches the forms make (optionRules.ts, surfaceRules.ts), changes the result.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { patchFilletFullRound, patchTwist, patchTwistCentre } from './optionRules';
import { centreLinePatch, connectorPatch, patchThickenAxis, patchThickenVariable, patchStop } from './surfaceRules';

type Wire = Record<string, unknown>;
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const poly = (id: string, pts: Array<[number, number]>, plane: Wire = { kind: 'std', id: 'front' }, open = false): Wire => ({
  type: 'sketch', id, plane,
  points: pts.map(([x, y], i) => ({ id: 'p' + i, x, y })),
  entities: pts.map((_, i) => ({ id: 'e' + i, type: 'line', p1: 'p' + i, p2: 'p' + ((i + 1) % pts.length) })).slice(0, open ? pts.length - 1 : pts.length),
  constraints: [],
});
const rect = (id: string, x0: number, y0: number, x1: number, y1: number, plane?: Wire) => poly(id, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], plane);

async function measure(features: Wire[]) {
  const s = await Session.open({ ...emptyPart('T'), features, seq: 20 } as unknown as PartDoc);
  sessions.push(s);
  const report = await s.verify();
  const mass = (await s.massProps()) as { volume?: number; com?: number[] };
  return { errors: report.regen.errors.map(([id, e]) => `${id}:${e.code}`), volume: mass.volume ?? 0, com: mass.com ?? [] };
}
const near = (a: number, b: number, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('editor options against the kernel', { skip: !process.env.CK_WASM }, () => {
  it('full round: the ball between two sides removes the centre face (10 high box, sides 20 apart)', async () => {
    const box = [rect('F1', 0, 0, 20, 30), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }];
    const base = await measure(box);
    near(base.volume, 20 * 30 * 10);
    // the 20 wide top (F2.C1) rounded between the two long sides
    const sides = await measure([...box, { type: 'fillet', id: 'F3', ...patchFilletFullRound({}, true), side1: 'F2.S.e3', center: 'F2.C1', side2: 'F2.S.e1' }]);
    expect(sides.errors).toEqual([]);
    expect(sides.volume).toBeLessThan(base.volume - 1);
    // the same removal as two r = 10 fillets: the top is gone, so two quarter rounds of area (1 - pi/4) r^2 each along 30
    near(sides.volume, base.volume - 2 * (1 - Math.PI / 4) * 100 * 30 - 0, 1);
  });
  it('extrude twist: the volume is area x depth, the shape turns about the chosen axis', async () => {
    const make = (patch: Wire) => measure([rect('F1', 5, 0, 15, 10), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 20, ...patch }]);
    const plain = await make({});
    const turned = await make(patchTwist({}, 90));
    expect(plain.errors).toEqual([]);
    expect(turned.errors).toEqual([]);
    near(turned.volume, plain.volume, 0.5);   // twisting keeps the area of every slice
    expect(Math.abs(turned.com[0] - plain.com[0]) + Math.abs(turned.com[1] - plain.com[1])).toBeGreaterThan(0.5);   // but the body is not the prism
    const about = await make({ ...patchTwist({}, 90), ...patchTwistCentre({}, 0, 10) });
    expect(about.errors).toEqual([]);
    expect(Math.abs(about.com[0] - turned.com[0]) + Math.abs(about.com[1] - turned.com[1])).toBeGreaterThan(0.5);   // another axis, another body
  });
  const arcSketch = (id: string, bow: number): Wire => {
    const r = (bow * bow + 225) / (2 * bow);   // an arc through (0, 0) and (0, 30) bulging by `bow`
    return {
      type: 'sketch', id, plane: { kind: 'std', id: 'front' },
      points: [{ id: 'g0', x: bow - r, y: 15 }, { id: 'g1', x: 0, y: 0 }, { id: 'g2', x: 0, y: 30 }],
      entities: [{ id: 'e1', type: 'arc', c: 'g0', p1: 'g1', p2: 'g2' }], constraints: [],
    };
  };
  const loftBase = (half2: number, hy = 10): Wire[] => [
    rect('S1', -10, -hy, 10, hy, { kind: 'std', id: 'top' }),
    { type: 'plane', id: 'P', mode: 'offset', base: { kind: 'std', id: 'top' }, offset: 30 },
    rect('S2', -half2, -(hy === 10 ? half2 : hy), half2, hy === 10 ? half2 : hy, { kind: 'feature', id: 'P' }),
  ];
  it('loft centre line: a curved one bends the loft, choosing None gives the straight loft back', async () => {
    const loft = (patch: Wire) => measure([...loftBase(5), arcSketch('CL', 5), { type: 'loft', id: 'L', op: 'add', sketches: ['S1', 'S2'], ...patch }]);
    const plain = await loft(centreLinePatch(''));
    expect(plain.errors).toEqual([]);
    const bent = await loft(centreLinePatch('CL'));
    expect(bent.errors).toEqual([]);
    expect(bent.volume).toBeLessThan(plain.volume - 100);   // 6006 against 7000
    near(bent.volume, 6006.0109, 6);
  });
  it('loft connectors: starting the second profile a corner round turns the loft', async () => {
    const loft = (patch: Wire) => measure([...loftBase(10, 5), { type: 'loft', id: 'L', op: 'add', sketches: ['S1', 'S2'], ...patch }]);   // two 20 x 10 rectangles, 30 apart
    const plain = await loft({});
    expect(plain.errors).toEqual([]);
    near(plain.volume, 20 * 10 * 30, 0.5);
    const turned = await loft(connectorPatch({}, 2, 1, 0.25));
    expect(turned.errors).toEqual([]);
    expect(Math.abs(turned.volume - plain.volume)).toBeGreaterThan(1);
  });
  it('variable thicken: a ramp gives the integral of the thickness, not the constant one', async () => {
    const sheet = [rect('S1', 0, 0, 100, 50), { type: 'surfacePlanar', id: 'F2', sketch: 'S1' }];
    const thick = (patch: Wire) => measure([...sheet, { type: 'thicken', id: 'F3', surface: 'F2', side: 'front', ...patch }]);
    const constant = await thick({ thickness: 2 });
    near(constant.volume, 100 * 50 * 2, 0.5);
    // the form's steps: Variable on (2 -> 1 over 10 along Z), axis X, then the end stop moved to 100 mm and 3 mm thick
    let eff: Wire = patchThickenVariable({ thickness: 2 }, true);
    eff = { ...eff, ...patchThickenAxis(eff, 'x') };
    eff = { ...eff, ...patchStop(eff, 1, 0, 100) };
    eff = { ...eff, ...patchStop(eff, 1, 1, 3) };
    const ramp = await thick(eff);
    expect(ramp.errors).toEqual([]);
    near(ramp.volume, 100 * 50 * 2.5, 100 * 50 * 2.5 * 1e-3);   // the mean of the stops 2 and 3 over the sheet
    expect(Math.abs(ramp.volume - constant.volume)).toBeGreaterThan(100);
  });
});
