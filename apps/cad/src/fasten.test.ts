// The rules of "Fasten this hole" (no kernel): diameter to size and fit, thickness to standard length, head type from the mouth, what each choice stacks, and the ops.
import { describe, expect, it } from 'vitest';
import './i18n';
import {
  autoLength, defaultBoltType, defaultParams, effectiveParams, fastenOps, freeName, groupsFor, holeKindOf, matchSize, nutAllowed, planHole, resolveTargets, roundDownLength, roundUpLength,
  type FastenParams,
} from './fasten';
import type { FastenHole } from './fastenHole';

const hole = (over: Partial<FastenHole> = {}): FastenHole => ({
  face: 'F4.S.h1', diameter: 5.5, kind: 'plain', out: [0, 0, 1], mouth: [20, 15, 12], seat: [20, 15, 12], exit: [20, 15, 0], through: true, thickness: 12, grip: 12, seatDepth: 0,
  recessDiameter: null, openFace: 'P.C1', exitFace: 'P.C0', bothOpen: true, farRecess: false, ...over,
});
const P = (over: Partial<FastenParams> = {}): FastenParams => ({ type: 'hex', size: 'M5', length: null, washer: 'none', nut: false, flip: false, ...over });

describe('matchSize: bore diameter to size and fit', () => {
  it('5.5 mm is M5 clearance, 4.2 mm is M5 tapped', () => {
    expect(matchSize(5.5)).toMatchObject({ size: 'M5', fit: 'clearance', exact: true });
    expect(matchSize(4.2)).toMatchObject({ size: 'M5', fit: 'tap', exact: true, reference: 4.2 });
  });
  it('the usual holes: 3.4 M3 clearance, 2.5 M3 tapped, 6.6 M6 clearance, 5.0 M6 tapped, 9 M8 clearance, 6.8 M8 tapped', () => {
    expect(matchSize(3.4)).toMatchObject({ size: 'M3', fit: 'clearance' });
    expect(matchSize(2.5)).toMatchObject({ size: 'M3', fit: 'tap' });
    expect(matchSize(3.3)).toMatchObject({ size: 'M4', fit: 'tap' });
    expect(matchSize(6.6)).toMatchObject({ size: 'M6', fit: 'clearance' });
    expect(matchSize(5)).toMatchObject({ size: 'M6', fit: 'tap' });
    expect(matchSize(9)).toMatchObject({ size: 'M8', fit: 'clearance' });
    expect(matchSize(6.8)).toMatchObject({ size: 'M8', fit: 'tap' });
  });
  it('a bore between two sizes gets the nearer one and says it is only nearest when it is more than 0.3 mm from the table', () => {
    const m = matchSize(7.7);
    expect(m.exact).toBe(false);
    expect(['M6', 'M8']).toContain(m.size);
  });
  it('a bore far above the largest size is M16 and not exact; far below the smallest is M2 and not exact', () => {
    expect(matchSize(30)).toMatchObject({ size: 'M16', exact: false });
    expect(matchSize(0.8)).toMatchObject({ size: 'M2', exact: false });
  });
});

describe('standard lengths', () => {
  it('rounds up to the next standard length', () => {
    expect(roundUpLength(12)).toBe(12);
    expect(roundUpLength(12.01)).toBe(16);
    expect(roundUpLength(17)).toBe(20);
    expect(roundUpLength(18.7)).toBe(20);
    expect(roundUpLength(21)).toBe(25);
    expect(roundUpLength(66)).toBe(70);
    expect(roundUpLength(1)).toBe(6);
    expect(roundUpLength(205)).toBe(220);
  });
  it('rounds down for a blind hole', () => {
    expect(roundDownLength(8)).toBe(8);
    expect(roundDownLength(9.9)).toBe(8);
    expect(roundDownLength(4)).toBe(6);
  });
  it('the auto length: the material from the bearing face plus what is stacked, rounded up; a blind hole the longest that fits', () => {
    expect(autoLength(hole(), P())).toBe(12);
    expect(autoLength(hole({ grip: 12.4 }), P())).toBe(16);
    expect(autoLength(hole(), P({ washer: 'head' }))).toBe(16);                      // 12 + 1
    expect(autoLength(hole(), P({ washer: 'both', nut: true }))).toBe(20);            // 12 + 1 + 1 + 4.7 = 18.7
    expect(autoLength(hole(), P({ nut: true }))).toBe(20);                            // 12 + 4.7 = 16.7
    expect(autoLength(hole({ through: false, exit: null, grip: 8, thickness: 8 }), P())).toBe(8);
    expect(autoLength(hole({ through: false, exit: null, grip: 9.5, thickness: 9.5 }), P({ washer: 'head' }))).toBe(10);   // 9.5 + 1 = 10.5
  });
});

describe('head type from the mouth of the hole', () => {
  it('plain hole: hex bolt, counterbore: socket cap screw, countersink: countersunk', () => {
    expect(defaultBoltType('plain')).toBe('hex');
    expect(defaultBoltType('cbore')).toBe('cap');
    expect(defaultBoltType('csink')).toBe('countersunk');
    expect(defaultParams(hole({ kind: 'cbore', recessDiameter: 10, seatDepth: 5 })).type).toBe('cap');
    expect(defaultParams(hole({ kind: 'csink', recessDiameter: 10, seatDepth: 2.2 })).type).toBe('countersunk');
  });
  it('reads the kind off a Hole feature: cbore, csink with a cskDiameter (the kernel cuts it without as a plain hole), countersink, simple', () => {
    expect(holeKindOf({ type: 'hole', kind: 'cbore', size: 'M5' })).toBe('cbore');
    expect(holeKindOf({ type: 'hole', kind: 'csink', size: 'M5', cskDiameter: 10.4 })).toBe('csink');
    expect(holeKindOf({ type: 'hole', kind: 'csink', size: 'M5' })).toBe('plain');
    expect(holeKindOf({ type: 'hole', kind: 'countersink', size: 'M5' })).toBe('csink');
    expect(holeKindOf({ type: 'hole', kind: 'simple', diameter: 5.5 })).toBe('plain');
    expect(holeKindOf({ type: 'hole' })).toBe('plain');
  });
  it('the defaults: the size from the bore, auto length, no washer, no nut', () => {
    expect(defaultParams(hole())).toEqual({ type: 'hex', size: 'M5', length: null, washer: 'none', nut: false, flip: false });
    expect(defaultParams(hole({ diameter: 4.2 })).size).toBe('M5');
  });
});

describe('planHole', () => {
  it('stacks washer, bolt, nut washer and nut on the hole axis: head outside, shank pointing in', () => {
    const plan = planHole(hole(), P({ washer: 'both', nut: true }));
    expect(plan.issues).toEqual([]);
    expect(plan.length).toBe(20);
    expect(plan.parts.map((p) => p.role)).toEqual(['washerHead', 'bolt', 'washerNut', 'nut']);
    const by = Object.fromEntries(plan.parts.map((p) => [p.role, p]));
    expect(by.washerHead).toMatchObject({ origin: [20, 15, 12], axis: [0, 0, 1], length: 1 });
    expect(by.bolt).toMatchObject({ origin: [20, 15, 13], axis: [0, 0, -1], length: 20 });
    expect(by.washerNut).toMatchObject({ origin: [20, 15, 0], axis: [0, 0, -1], length: 1 });
    expect(by.nut).toMatchObject({ origin: [20, 15, -1], axis: [0, 0, -1], length: 4.7 });
  });
  it('a plain bolt sits on the mouth; a bolt in a counterbore sits on the floor; a countersunk screw on the flat top', () => {
    expect(planHole(hole(), P()).parts[0]).toMatchObject({ role: 'bolt', origin: [20, 15, 12] });
    expect(planHole(hole({ kind: 'cbore', seat: [20, 15, 7], seatDepth: 5, recessDiameter: 10, grip: 7 }), P({ type: 'cap' })).parts[0]).toMatchObject({ origin: [20, 15, 7], length: 8 });
    const cs = planHole(hole({ kind: 'csink', recessDiameter: 9.9, seatDepth: 2.2 }), P({ type: 'countersunk' }));
    expect(cs.issues).toEqual([]);
    expect(cs.parts[0]).toMatchObject({ origin: [20, 15, 12], length: 12 });
  });
  it('works on the other axes: the head side follows the hole out direction', () => {
    const h = hole({ out: [1, 0, 0], mouth: [30, 5, 5], seat: [30, 5, 5], exit: [18, 5, 5] });
    const plan = planHole(h, P({ washer: 'head', nut: true }));
    expect(plan.parts.find((p) => p.role === 'bolt')).toMatchObject({ origin: [31, 5, 5], axis: [-1, 0, 0] });
    expect(plan.parts.find((p) => p.role === 'nut')).toMatchObject({ origin: [18, 5, 5], axis: [-1, 0, 0] });
  });
  it('a blind hole gets no nut, and says why', () => {
    const b = hole({ through: false, exit: null, grip: 8, thickness: 8 });
    expect(nutAllowed(b)).toBe('blind');
    expect(planHole(b, P({ nut: true })).issues.map((i) => i.code)).toEqual(['blindNut']);
    expect(effectiveParams(b, P({ nut: true, washer: 'both' }))).toMatchObject({ nut: false, washer: 'head' });
  });
  it('a tapped hole gets no nut', () => {
    const tap = hole({ diameter: 4.2 });
    expect(nutAllowed(tap)).toBe('tap');
    expect(planHole(tap, P({ nut: true })).issues.map((i) => i.code)).toEqual(['tapNut']);
  });
  it('no washer on a countersunk mouth; a washer that does not fit a counterbore; a head wider than the counterbore', () => {
    expect(planHole(hole({ kind: 'csink', recessDiameter: 9.9, seatDepth: 2.2 }), P({ type: 'countersunk', washer: 'head' })).issues.map((i) => i.code)).toEqual(['csinkWasher']);
    expect(effectiveParams(hole({ kind: 'csink', recessDiameter: 9.9, seatDepth: 2.2 }), P({ type: 'countersunk', washer: 'head' })).washer).toBe('none');
    const cb = hole({ kind: 'cbore', recessDiameter: 10, seatDepth: 5, seat: [20, 15, 7], grip: 7 });
    expect(planHole(cb, P({ type: 'cap', washer: 'head' })).issues.map((i) => i.code)).toEqual(['washerRecess']);
    expect(planHole({ ...cb, recessDiameter: 8 }, P({ type: 'cap' })).issues.map((i) => i.code)).toEqual(['headRecess']);
  });
  it('a size with no such head in the table is an issue (cap screw above M10)', () => {
    expect(planHole(hole({ diameter: 13.5 }), P({ type: 'cap', size: 'M12' })).issues.map((i) => i.code)).toEqual(['head']);
  });
});

describe('the holes in scope', () => {
  const at = (face: string, over: Partial<FastenHole> = {}): FastenHole => hole({ face, ...over });
  const all = [at('F4.S.h1'), at('F4.S.h1@F9.1'), at('F4.S.h1@F9.2'), at('F7.S.h1', { diameter: 3.4 }), at('F8.S.h1', { diameter: 3.4 })];
  it('groups the identical holes, the other selected ones and the pattern ones, each hole in one group only', () => {
    const g = groupsFor(all[0], all, [all[3], all[1]], [all[1], all[2], all[4]]);
    expect(g.identical.map((h) => h.face)).toEqual(['F4.S.h1@F9.1', 'F4.S.h1@F9.2']);
    expect(g.selected.map((h) => h.face)).toEqual(['F7.S.h1']);
    expect(g.pattern.map((h) => h.face)).toEqual(['F8.S.h1']);
  });
  it('resolves targets: the picked and identical holes get the dialog choices, the other ones their own size', () => {
    const g = groupsFor(all[0], all, [all[3]], []);
    const p = P({ washer: 'both', nut: true });
    const all3 = resolveTargets(all[0], p, g, { identical: true, selected: true, pattern: true });
    expect(all3.map((x) => x.hole.face)).toEqual(['F4.S.h1', 'F4.S.h1@F9.1', 'F4.S.h1@F9.2', 'F7.S.h1']);
    expect(all3[1].params).toBe(p);
    expect(all3[3].params).toMatchObject({ size: 'M3', type: 'hex', nut: true, washer: 'both', length: null });
    expect(resolveTargets(all[0], p, g, { identical: false, selected: false, pattern: false }).map((x) => x.hole.face)).toEqual(['F4.S.h1']);
    expect(resolveTargets(all[0], p, g, { identical: false, selected: true, pattern: false }).map((x) => x.hole.face)).toEqual(['F4.S.h1', 'F7.S.h1']);
  });
});

describe('fastenOps', () => {
  const doc = { features: [{ id: 'F1' }, { id: 'F2', name: 'Plate' }, { id: 'F4' }], seq: 5 };
  const feats = (ops: unknown[]) => (ops as Array<{ op: string; feature: Record<string, unknown> }>).map((o) => o.feature);
  it('every part is a named body in one folder; ids continue the document; nothing is numbered for a single hole', () => {
    const ops = fastenOps(doc, [{ hole: hole(), params: P({ washer: 'both', nut: true }) }]);
    const fs = feats(ops);
    expect(new Set(fs.map((f) => f.group))).toEqual(new Set(['Fasteners']));
    const ids = fs.map((f) => String(f.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(Number(id.slice(1))).toBeGreaterThanOrEqual(5);
    const bodies = fs.filter((f) => typeof f.body === 'string').map((f) => f.body);
    expect(bodies).toEqual(expect.arrayContaining(['Bolt', 'Bolt head', 'Washer', 'Washer (nut)', 'Nut']));
    // the shank is a separate body from the plate, the hex head too, and the two are united by name (no fuse with the plate)
    const solids = fs.filter((f) => ['extrude', 'revolve'].includes(String(f.type)) && f.op !== 'cut');
    expect(solids.every((f) => f.op === 'newBody')).toBe(true);
    const comb = fs.find((f) => f.type === 'combine')!;
    expect(comb).toMatchObject({ op: 'union', target: { body: 'Bolt' }, tools: [{ body: 'Bolt head' }], body: 'Bolt' });
    // every cut is aimed at the nut by name
    for (const f of fs.filter((x) => x.op === 'cut')) expect(f.target, JSON.stringify(f)).toEqual([{ body: 'Nut' }]);
  });
  it('a socket cap screw: the drive cut reaches the bolt only', () => {
    const fs = feats(fastenOps(doc, [{ hole: hole({ kind: 'cbore', seat: [20, 15, 7], seatDepth: 5, recessDiameter: 10, grip: 7 }), params: P({ type: 'cap' }) }]));
    const cuts = fs.filter((f) => f.op === 'cut');
    expect(cuts.length).toBeGreaterThan(0);
    for (const c of cuts) expect(c.target).toEqual([{ body: 'Bolt' }]);
    expect(fs.some((f) => f.type === 'combine')).toBe(false);
  });
  it('several holes: Bolt 1, Bolt 2 ...; names taken by earlier bodies are skipped; a second run lands in a second folder', () => {
    const t3 = [1, 2, 3].map((i) => ({ hole: hole({ face: `F4.S.h${i}`, mouth: [10 * i, 5, 12], seat: [10 * i, 5, 12], exit: [10 * i, 5, 0] }), params: P({ washer: 'head' }) }));
    const fs = feats(fastenOps(doc, t3));
    expect(fs.filter((f) => f.type === 'combine').map((f) => f.body)).toEqual(['Bolt 1', 'Bolt 2', 'Bolt 3']);
    expect(fs.filter((f) => /^Washer \d$/.test(String(f.body))).map((f) => f.body)).toEqual(['Washer 1', 'Washer 2', 'Washer 3']);
    const taken = new Set(['Bolt', 'Bolt head', 'Bolt 2']);
    expect(freeName('Bolt', taken, false)).toBe('Bolt 3');
    const next = fastenOps({ features: [{ id: 'F1', group: 'Fasteners', body: 'Bolt' }, { id: 'F2', body: 'Bolt head' }], seq: 20 }, [{ hole: hole(), params: P() }]);
    expect(feats(next)[0].group).toBe('Fasteners 2');
    expect(feats(next).find((f) => f.type === 'combine')!.body).toBe('Bolt 2');
  });
  it('throws the problem when the choices cannot be made', () => {
    expect(() => fastenOps(doc, [{ hole: hole({ through: false, exit: null }), params: P({ nut: true }) }])).toThrow(/blind/);
  });
  it('a button head and a countersunk screw are a single revolve (no combine)', () => {
    for (const type of ['button', 'countersunk'] as const) {
      const fs = feats(fastenOps(doc, [{ hole: hole(), params: P({ type }) }]));
      expect(fs.some((f) => f.type === 'combine'), type).toBe(false);
      expect(fs.find((f) => f.type === 'revolve')).toMatchObject({ op: 'newBody', body: 'Bolt' });
    }
  });
});
