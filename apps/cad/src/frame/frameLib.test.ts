import { describe, expect, it } from 'vitest';
import { bom, cutList, frameFeature, paramsFromFeature, PROFILES, readFrames, skeletons, toCsv, type FrameReport } from './frameLib';

const member = (segment: string, length: number, angles: [number, number], ends: [string, string], profile = 'shs-40x40x2', volume = 304 * length) =>
  ({ segment, body: `F2 M${segment.slice(1)}`, profile, label: '', length, angles, ends, volume });

// the kernel's report for a mitred 600 x 400 rectangle of SHS 40x40x2 (crates/ck-model/tests/frame.rs)
const mitred: FrameReport[] = [{ id: 'F2', members: [
  member('e1', 640, [45, 45], ['mitre', 'mitre'], 'shs-40x40x2', 304 * 600), member('e2', 440, [45, 45], ['mitre', 'mitre'], 'shs-40x40x2', 304 * 400),
  member('e3', 640, [45, 45], ['mitre', 'mitre'], 'shs-40x40x2', 304 * 600), member('e4', 440, [45, 45], ['mitre', 'mitre'], 'shs-40x40x2', 304 * 400),
] }];

describe('profile library', () => {
  it('has a dozen standard sizes, each with a section and known fittings', () => {
    expect(PROFILES.length).toBeGreaterThanOrEqual(12);
    for (const p of PROFILES) {
      expect(p.section.kind, p.id).toBeTruthy();
      expect(new Set(PROFILES.map((q) => q.id)).size).toBe(PROFILES.length);
    }
  });
});

describe('frame feature', () => {
  it('is built from a skeleton and a profile, and read back for Edit', () => {
    expect(frameFeature('F2', { sketch: null, segments: null, profile: 'shs-40x40x2', corner: 'mitre', rotate: 0 })).toBeNull();
    const f = frameFeature('F2', { sketch: 'F1', segments: null, profile: 'shs-40x40x2', corner: 'mitre', rotate: 90 })!;
    expect(f).toMatchObject({ type: 'frame', sketch: 'F1', corner: 'mitre', rotate: 90, profile: { kind: 'rectTube', w: 40, h: 40, t: 2, id: 'shs-40x40x2' } });
    expect(paramsFromFeature(f)).toEqual({ sketch: 'F1', segments: null, profile: 'shs-40x40x2', corner: 'mitre', rotate: 90 });
  });
  it('lists sketches with lines as skeletons', () => {
    const doc = { features: [
      { id: 'F1', type: 'sketch', entities: [{ type: 'line', id: 'e1' }, { type: 'line', id: 'e2', construction: true }, { type: 'circle', id: 'e3' }] },
      { id: 'F2', type: 'sketch', entities: [{ type: 'circle', id: 'e1' }] },
      { id: 'F3', type: 'extrude' },
    ] };
    expect(skeletons(doc as never)).toEqual([{ id: 'F1', label: 'F1', lines: ['e1'] }]);
  });
});

describe('cut list and BOM', () => {
  it('counts equal pieces together with their cut angles', () => {
    const cl = cutList(mitred);
    expect(cl.map((l) => [l.length, l.angles, l.qty])).toEqual([[640, [45, 45], 2], [440, [45, 45], 2]]);
    expect(cl[0].massKg).toBeCloseTo(2 * 304 * 600 * 7.85e-6, 9);
  });
  it('treats a piece cut 0/45 and 45/0 as the same piece', () => {
    const cl = cutList([{ id: 'F2', members: [member('e1', 600, [0, 45], ['butt', 'mitre']), member('e2', 600, [45, 0], ['mitre', 'butt'])] }]);
    expect(cl).toHaveLength(1);
    expect(cl[0].qty).toBe(2);
  });
  it('adds the fittings the library calls for: T-slot brackets per joint, caps per free end', () => {
    // a butted T-slot rectangle with a tee (four corners + two tee ends = 6 joints), and a free-standing post (2 free ends)
    const fr: FrameReport[] = [{ id: 'F2', members: [
      member('e1', 640, [0, 0], ['through', 'through'], 'tslot-2020'), member('e2', 400, [0, 0], ['butt', 'through'], 'tslot-2020'),
      member('e3', 600, [0, 0], ['butt', 'through'], 'tslot-2020'), member('e4', 360, [0, 0], ['butt', 'butt'], 'tslot-2020'),
      member('e5', 360, [0, 0], ['tee', 'tee'], 'tslot-2020'), member('e6', 300, [0, 0], ['free', 'free'], 'tslot-2020'),
    ] }];
    const b = bom(fr);
    const q = (id: string) => b.find((l) => l.id === id)?.qty;
    expect(q('tslot-2020')).toBe(6);
    expect(q('bracket-20')).toBe(6);
    expect(q('tnut-m5-20')).toBe(12);
    expect(q('bhcs-m5x10')).toBe(12);
    expect(q('cap-20')).toBe(2);
  });
  it('counts a mitred steel rectangle as four welds and no plugs', () => {
    const b = bom(mitred);
    expect(b.find((l) => l.id === 'weld')).toMatchObject({ qty: 4, unit: 'joints' });
    expect(b.find((l) => l.id === 'plug-shs-40')).toBeUndefined();
    expect(b.find((l) => l.id === 'shs-40x40x2')?.detail).toContain('2160 mm total');
  });
  it('exports both tables as CSV', () => {
    const csv = toCsv(mitred).split('\n');
    expect(csv[0]).toBe('Item,Profile,Length (mm),Angle 1 (deg),Angle 2 (deg),Qty,Mass each (kg),Members');
    expect(csv[1]).toBe('1,SHS 40 x 40 x 2,640,45,45,2,1.432,F2 M1 F2 M3');
    expect(csv).toContain('Item,Part,Qty,Unit,Detail');
  });
  it('reads only well-formed frames from a reply', () => {
    expect(readFrames(undefined)).toEqual([]);
    expect(readFrames([{ id: 'F2', members: [] }, { nope: 1 }])).toHaveLength(1);
  });
});
