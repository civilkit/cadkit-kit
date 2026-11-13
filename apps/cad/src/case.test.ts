import { describe, expect, it } from 'vitest';
import './i18n';
import { DEFAULT_CASE, autoLid, autoTongue, caseIssue, caseOps, caseSummary, withChange, type CaseParams } from './case';

const P = (patch: Partial<CaseParams> = {}): CaseParams => withChange(DEFAULT_CASE, patch);
const types = (ops: Array<{ op: string; feature?: Record<string, unknown> }>) => ops.filter((o) => o.op === 'add').map((o) => o.feature!);

describe('case defaults', () => {
  it('is an 80 x 50 x 30 case, 2 mm wall, lid a quarter of the height, tongue 0.75 of the wall on the lid', () => {
    expect(DEFAULT_CASE).toMatchObject({ width: 80, depth: 50, height: 30, wall: 2, round: 'off', radius: 5, topRadius: 2, lidHeight: 7.5, tongueHeight: 1.5, tongueFraction: 0.5, clearance: 0.2, tongueOn: 'lid', baseName: 'Base', lidName: 'Lid' });
    expect(caseIssue(DEFAULT_CASE)).toBeNull();
  });
  it('the lid height is at least three walls, and follows the height and the wall until it is set by hand', () => {
    expect(autoLid(30, 2)).toBe(7.5);
    expect(autoLid(16, 2)).toBe(6);
    expect(P({ height: 60 }).lidHeight).toBe(15);
    expect(P({ wall: 3 }).lidHeight).toBe(9);
    const hand = P({ lidHeight: 12 });
    expect(hand.lidAuto).toBe(false);
    expect(withChange(hand, { height: 60 }).lidHeight).toBe(12);
  });
  it('the tongue height follows the wall until it is set by hand', () => {
    expect(autoTongue(2)).toBe(1.5);
    expect(P({ wall: 3 }).tongueHeight).toBe(2.25);
    expect(withChange(P({ tongueHeight: 1 }), { wall: 3 }).tongueHeight).toBe(1);
  });
});

describe('caseIssue', () => {
  const code = (patch: Partial<CaseParams>) => caseIssue(P(patch))?.code ?? null;
  it('size and wall', () => {
    expect(code({ width: 0 })).toBe('size');
    expect(code({ wall: 0.3 })).toBe('wall');
    expect(code({ wall: 0.4, tongueFraction: 0.5, clearance: 0.05 })).toBeNull();
    expect(code({ wall: 16, height: 30, lidHeight: 15 })).toBe('wallThick');
  });
  it('side edges: a radius more than the wall and at most half the width or depth, only checked when the side edges are on', () => {
    expect(code({ round: 'side', radius: 5 })).toBeNull();
    expect(code({ round: 'side', radius: -1 })).toBe('radius');
    expect(code({ round: 'side', radius: 0 })).toBe('radius');
    expect(code({ round: 'side', radius: 2 })).toBe('radius');
    expect(code({ round: 'side', radius: 26 })).toBe('radiusBig');
    expect(code({ round: 'top', radius: 26 })).toBeNull();   // a stale side radius does not count when only the top is rounded
    expect(code({ round: 'off', radius: 0 })).toBeNull();
  });
  it('top edges: more than 0, at most half the width or depth, 2.2 walls, the side radius when both, and under the half height less its groove', () => {
    expect(code({ round: 'top', topRadius: 4 })).toBeNull();
    expect(code({ round: 'top', topRadius: 0 })).toBe('topRadius');
    expect(code({ round: 'top', topRadius: 4.5 })).toBe('topWall');   // 2.207 x the 2 mm wall is 4.414
    expect(caseIssue(P({ round: 'top', topRadius: 4.5 }))?.params).toMatchObject({ max: 4.414 });
    expect(code({ round: 'top', width: 6, depth: 6, topRadius: 4 })).toBe('topBig');
    expect(code({ round: 'both', radius: 5, topRadius: 4 })).toBeNull();
    expect(code({ round: 'both', radius: 4, topRadius: 4.2 })).toBe('topSide');
    expect(code({ round: 'side', radius: 4, topRadius: 4.2 })).toBeNull();   // top edges off: its radius is not looked at
    expect(code({ round: 'top', lidHeight: 25, topRadius: 3.5 })).toBe('topSeam');   // the base is 5 tall and carries the 1.7 groove: 3.3 free
    expect(caseIssue(P({ round: 'top', lidHeight: 25, topRadius: 3.5 }))?.params).toMatchObject({ half: 'base', max: 3.3 });
    expect(code({ round: 'top', lidHeight: 25, topRadius: 3.5, tongueOn: 'base' })).toBeNull();   // then the lid carries it and is 25 tall
  });
  it('the halves must be taller than the wall and leave a wall under the groove', () => {
    expect(code({ lidHeight: 2 })).toBe('lid');
    expect(code({ lidHeight: 28 })).toBe('lid');
    expect(code({ lidHeight: 27 })).toBe('groove');   // tongue on the lid: the base is 3 mm, the groove 1.7 and a 2 mm wall under it need 3.7
    expect(code({ lidHeight: 27, tongueOn: 'base' })).toBeNull();   // then the lid is grooved and is 27 mm tall
    expect(caseIssue(P({ lidHeight: 27 }))?.params).toMatchObject({ need: 3.7, have: 3 });
  });
  it('the tongue and the clearance must fit the wall', () => {
    expect(code({ tongueFraction: 0.9 })).toBe('tongueFit');
    expect(code({ clearance: 0.6 })).toBe('tongueFit');
    expect(code({ clearance: 0.5 })).toBe('tongueFit');   // 1 + 2 x 0.5 is the whole 2 mm wall
    expect(code({ tongueFraction: 1 })).toBe('tongue');
    expect(code({ tongueHeight: 0 })).toBe('tongue');
    expect(code({ clearance: 2 })).toBe('clearance');
  });
  it('the two names must be there and differ', () => {
    expect(code({ lidName: ' ' })).toBe('names');
    expect(code({ lidName: 'Base' })).toBe('names');
    expect(code({ baseName: 'Tray', lidName: 'Cover' })).toBeNull();
  });
});

describe('caseSummary', () => {
  it('the guide numbers', () => {
    expect(caseSummary(P({ lidHeight: 15 }))).toEqual({ base: 15, lid: 15, cut: 15, tongueWidth: 1, tongueHeight: 1.5, grooveWidth: 1.4, grooveDepth: 1.7 });
    expect(caseSummary(P({ lidHeight: 15, origin: [0, 5, 0] })).cut).toBe(20);   // the case rises along y
    expect(caseSummary(P({ lidHeight: 15, origin: [0, 5, 0], axis: 'z' })).cut).toBe(15);
    expect(caseSummary(P({ lidHeight: 15, origin: [0, 5, 7], axis: 'z' })).cut).toBe(22);
  });
});

describe('caseOps', () => {
  const empty = { features: [] as Array<{ id?: string; group?: unknown }> };
  const ex = (f: Array<Record<string, unknown>>) => f.filter((x) => x.type === 'extrude');
  it('an empty document: the two cups and the move, all in a Case folder, numbered from F1, bodies Base and Lid', () => {
    const f = types(caseOps(empty, P({ lidHeight: 15 })) as never);
    expect(f[0].id).toBe('F1');
    expect(f.every((x) => x.group === 'Case')).toBe(true);
    expect(f.map((x) => x.type).filter((t) => t !== 'plane' && t !== 'sketch')).toEqual(['extrude', 'shell', 'extrude', 'extrude', 'shell', 'extrude', 'extrude', 'moveBody']);
    expect(ex(f)[0]).toMatchObject({ op: 'newBody', body: 'Base', depth: 15 });
    expect(ex(f)[2]).toMatchObject({ op: 'newBody', body: 'Lid', depth: 16.5 });
    expect(f.at(-1)).toMatchObject({ type: 'moveBody', translate: [-10160, 15, 0] });   // up the app's y axis
    expect(types(caseOps(empty, P({ lidHeight: 15, axis: 'z' })) as never).at(-1)).toMatchObject({ type: 'moveBody', translate: [-10160, 0, 15] });
  });
  it('a document with features: the folder is numbered, the ids go on, the names and the tongue side follow the fields', () => {
    const doc = { features: [{ id: 'F1', group: 'Case' }, { id: 'F2', group: 'Case' }, { id: 'F7' }] };
    const f = types(caseOps(doc, P({ lidHeight: 15, tongueOn: 'base', baseName: 'Tray', lidName: 'Cover' })) as never);
    expect(f[0].id).toBe('F8');
    expect(f.every((x) => x.group === 'Case 2')).toBe(true);
    expect(ex(f)[0]).toMatchObject({ body: 'Tray', depth: 16.5 });
    expect(ex(f).at(-1)).toMatchObject({ op: 'cut', target: [{ body: 'Cover' }], depth: 1.7 });
  });
  it('top edges add one fillet per half after its shell, none otherwise; the radius of an edge that is off is not sent', () => {
    const kinds = (patch: Partial<CaseParams>) => types(caseOps(empty, P(patch)) as never).filter((x) => x.type === 'fillet') as Array<{ radius: number; edges: unknown[] }>;
    expect(kinds({ round: 'off', topRadius: 3 })).toHaveLength(0);
    expect(kinds({ round: 'side', topRadius: 3 })).toHaveLength(0);
    const top = kinds({ round: 'top', topRadius: 3 });
    expect(top.map((x) => [x.radius, x.edges.length])).toEqual([[3, 4], [3, 4]]);
    const both = kinds({ round: 'both', radius: 6, topRadius: 3 });
    expect(both.map((x) => [x.radius, x.edges.length])).toEqual([[3, 8], [3, 8]]);
    const sk = (patch: Partial<CaseParams>) => (types(caseOps(empty, P(patch)) as never).filter((x) => x.type === 'sketch') as Array<{ entities: Array<{ type: string }> }>)[0].entities.filter((e) => e.type === 'arc').length;
    expect(sk({ round: 'top', radius: 6 })).toBe(0);   // top only: the outline stays a plain rectangle
    expect(sk({ round: 'both', radius: 6 })).toBe(4);
  });
  it('a rounded case rounds every outline', () => {
    const f = types(caseOps({ features: [{ id: 'F1' }] }, P({ round: 'side', radius: 5 })) as never);
    const sk = f.filter((x) => x.type === 'sketch') as Array<{ entities: Array<{ type: string }> }>;
    expect(sk.length).toBeGreaterThan(3);
    for (const s of sk) expect(s.entities.filter((e) => e.type === 'arc').length % 4).toBe(0);
    expect(sk[0].entities.filter((e) => e.type === 'arc')).toHaveLength(4);
  });
  it('throws the helper message for parameters the checks missed', () => {
    expect(() => caseOps(empty, P({ wall: 0.2 }))).toThrow(/wall must be at least 0.4/);
  });
});
