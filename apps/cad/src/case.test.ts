import { describe, expect, it } from 'vitest';
import './i18n';
import { DEFAULT_CASE, autoLid, autoTongue, caseIssue, caseOps, caseSummary, withChange, type CaseParams } from './case';

const P = (patch: Partial<CaseParams> = {}): CaseParams => withChange(DEFAULT_CASE, patch);
const types = (ops: Array<{ op: string; feature?: Record<string, unknown> }>) => ops.filter((o) => o.op === 'add').map((o) => o.feature!);

describe('case defaults', () => {
  it('is an 80 x 50 x 30 case, 2 mm wall, lid a quarter of the height, tongue 0.75 of the wall on the lid', () => {
    expect(DEFAULT_CASE).toMatchObject({ width: 80, depth: 50, height: 30, wall: 2, radius: 0, lidHeight: 7.5, tongueHeight: 1.5, tongueFraction: 0.5, clearance: 0.2, tongueOn: 'lid', baseName: 'Base', lidName: 'Lid' });
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
  it('corner radius: 0, or more than the wall and at most half the width or depth', () => {
    expect(code({ radius: 5 })).toBeNull();
    expect(code({ radius: -1 })).toBe('radius');
    expect(code({ radius: 2 })).toBe('radius');
    expect(code({ radius: 26 })).toBe('radiusBig');
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
    expect(caseSummary(P({ lidHeight: 15, origin: [0, 0, 5] })).cut).toBe(20);
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
    expect(f.at(-1)).toMatchObject({ type: 'moveBody', translate: [-10160, 0, 15] });
  });
  it('a document with features: the folder is numbered, the ids go on, the names and the tongue side follow the fields', () => {
    const doc = { features: [{ id: 'F1', group: 'Case' }, { id: 'F2', group: 'Case' }, { id: 'F7' }] };
    const f = types(caseOps(doc, P({ lidHeight: 15, tongueOn: 'base', baseName: 'Tray', lidName: 'Cover' })) as never);
    expect(f[0].id).toBe('F8');
    expect(f.every((x) => x.group === 'Case 2')).toBe(true);
    expect(ex(f)[0]).toMatchObject({ body: 'Tray', depth: 16.5 });
    expect(ex(f).at(-1)).toMatchObject({ op: 'cut', target: [{ body: 'Cover' }], depth: 1.7 });
  });
  it('a rounded case rounds every outline', () => {
    const f = types(caseOps({ features: [{ id: 'F1' }] }, P({ radius: 5 })) as never);
    const sk = f.filter((x) => x.type === 'sketch') as Array<{ entities: Array<{ type: string }> }>;
    expect(sk.length).toBeGreaterThan(3);
    for (const s of sk) expect(s.entities.filter((e) => e.type === 'arc').length % 4).toBe(0);
    expect(sk[0].entities.filter((e) => e.type === 'arc')).toHaveLength(4);
  });
  it('throws the helper message for parameters the checks missed', () => {
    expect(() => caseOps(empty, P({ wall: 0.2 }))).toThrow(/wall must be at least 0.4/);
  });
});
