import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAME, bom, cutList, defaultHardware, jointFaces, jointOfFace, extendLibrary, FITTINGS, frameFeature, paramsFromFeature, partSpec, PROFILES, profileById, readFrames, skeletons, toCsv, toText, type FrameParams, type FrameReport } from './frameLib';

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
    const none = { joint: null, corner3: null, cap: null, foot: null };
    expect(frameFeature('F2', { ...DEFAULT_FRAME, sketch: null, profile: 'shs-40x40x2', corner: 'mitre', hardware: none })).toBeNull();
    const p: FrameParams = { sketch: 'F1', segments: null, profile: 'shs-40x40x2', corner: 'mitre', rotate: 90, hardware: none, joints: [], teeBoth: false, drill: false };
    const f = frameFeature('F2', p)!;
    expect(f).toMatchObject({ type: 'frame', sketch: 'F1', corner: 'mitre', rotate: 90, profile: { kind: 'rectTube', w: 40, h: 40, t: 2, id: 'shs-40x40x2' } });
    expect(f.hardware).toBeUndefined();   // no hardware chosen: the payload is what it was before connectors
    expect(paramsFromFeature(f)).toEqual(p);
  });
  it('carries the chosen hardware as kernel parts, with nut and screw inlined, and the per-joint choices, and reads them back', () => {
    const p: FrameParams = { ...DEFAULT_FRAME, sketch: 'F1', profile: 'tslot-3030', hardware: defaultHardware('tslot-3030'), joints: [{ segments: ['e1', 'e2'], connector: 'none' }] };
    const f = frameFeature('F2', p)! as { hardware: Record<string, Record<string, unknown>>; joints: Array<Record<string, unknown>> };
    expect(f.hardware.joint).toMatchObject({ id: 'bracket-30', kind: 'lbracket', arm: 25, t: 3, tnut: { id: 'tnut-m6-30', kind: 'nut', l: 10 }, bolt: { id: 'bhcs-m6x10', kind: 'bolt', d: 6, len: 10 } });
    expect(f.hardware.corner3).toMatchObject({ id: 'corner3-30', kind: 'corner3', block: 20, tnut: { id: 'tnut-m6-30' } });
    expect(f.hardware.cap).toMatchObject({ id: 'cap-30', kind: 'cap', t: 2 });
    expect(f.hardware.foot).toMatchObject({ id: 'foot-30', kind: 'foot' });
    expect(f.joints).toEqual([{ segments: ['e1', 'e2'], connector: 'none' }]);
    expect(paramsFromFeature(f as never)).toEqual({ ...p, corner: 'butt' });
    // tee on both sides, drill and the tube options travel too
    const q: FrameParams = { ...DEFAULT_FRAME, sketch: 'F1', profile: 'shs-40x40x2', corner: 'mitre', hardware: { ...defaultHardware('shs-40x40x2'), joint: 'bracket-tube-40' }, joints: [{ segments: ['e1', 'e2'], connector: 'default', both: true }], teeBoth: true, drill: true };
    const g = frameFeature('F2', q)! as { hardware: Record<string, unknown>; joints: unknown[] };
    expect(g.hardware).toMatchObject({ teeBoth: true, drill: true, joint: { id: 'bracket-tube-40', bolt: { id: 'hex-m6', d: 6 }, nut: { id: 'nut-m6', af: 10 } } });
    expect(g.joints).toEqual([{ segments: ['e1', 'e2'], both: true }]);
    expect(paramsFromFeature(g as never)).toEqual(q);
  });
  it('every profile offers fittings that have geometry and that fit the profile', () => {
    for (const prof of PROFILES) {
      for (const [place, ids] of Object.entries(prof.hardware ?? {})) for (const id of ids!) {
        expect(partSpec(id), `${prof.id} ${place} ${id}`).not.toBeNull();
      }
      if (prof.family === 'tslot') {
        const br = partSpec(prof.hardware!.joint![0])!;
        expect(br.kind).toBe('lbracket');
        expect((br.bolt as { d: number }).d).toBeLessThan(prof.section.slot as number);
      }
    }
    // a corner block is the default for T-slot only; a tube keeps weld gussets and offers brackets and the block
    expect(defaultHardware('tslot-3030').corner3).toBe('corner3-30');
    expect(defaultHardware('shs-40x40x2')).toMatchObject({ joint: 'gusset-3', corner3: null });
    expect(profileById('shs-40x40x2')!.hardware!.corner3).toEqual(['corner3-tube-40']);
    expect(defaultHardware('nope')).toEqual({ joint: null, corner3: null, cap: null, foot: null });
  });
  it('a user can add stock and fittings', () => {
    extendLibrary({ fittings: { 'my-cap': { label: 'My cap', kind: 'cap', part: { kind: 'cap', t: 4 } } }, profiles: [{ ...profileById('shs-40x40x2')!, id: 'my-shs', label: 'My SHS', hardware: { cap: ['my-cap'] } }] });
    expect(defaultHardware('my-shs')).toEqual({ joint: null, corner3: null, cap: 'my-cap', foot: null });
    expect(partSpec('my-cap')).toMatchObject({ id: 'my-cap', t: 4 });
    PROFILES.splice(PROFILES.findIndex((x) => x.id === 'my-shs'), 1);
    delete FITTINGS['my-cap'];
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
  it('lists the hardware the kernel placed, grouped, and none the model does not hold', () => {
    const hp = (id: string, label: string, kind: string, qty: number) => ({ id, label, kind, spec: id + ' spec', qty, bodies: Array.from({ length: qty }, (_, i) => `F2 H${i + 1}`) });
    const fr: FrameReport[] = [{ id: 'F2', members: [member('e1', 640, [0, 0], ['through', 'through'], 'tslot-2020'), member('e2', 400, [0, 0], ['butt', 'free'], 'tslot-2020')],
      hardware: { parts: [hp('cap-20', 'End cap', 'cap', 1), hp('bracket-20', 'Bracket', 'lbracket', 1), hp('bhcs-m5x8', 'Screw', 'bolt', 2), hp('tnut-m5-20', 'T-nut', 'nut', 2)], joints: [] } }];
    const b = bom(fr);
    expect(b.map((l) => [l.group, l.id, l.qty])).toEqual([['stock', 'tslot-2020', 2], ['connector', 'bracket-20', 1], ['fastener', 'bhcs-m5x8', 2], ['fastener', 'tnut-m5-20', 2], ['end', 'cap-20', 1]]);
    // the seeded fittings of the profile (geometry-backed ones) no longer add rows of their own: a frame with no hardware lists stock only
    const plain = bom([{ id: 'F2', members: fr[0].members }]);
    expect(plain.map((l) => l.id)).toEqual(['tslot-2020']);
    // quantities add up across frames
    const two = bom([...fr, { ...fr[0], id: 'F3' }]);
    expect(two.find((l) => l.id === 'bracket-20')?.qty).toBe(2);
  });
  it('welds are still counted from the joints', () => {
    // a butted T-slot rectangle with a tee (four corners + two tee ends = 6 joints), and a free-standing post (2 free ends)
    const fr: FrameReport[] = [{ id: 'F2', members: [
      member('e1', 640, [0, 0], ['through', 'through'], 'tslot-2020'), member('e2', 400, [0, 0], ['butt', 'through'], 'tslot-2020'),
      member('e3', 600, [0, 0], ['butt', 'through'], 'tslot-2020'), member('e4', 360, [0, 0], ['butt', 'butt'], 'tslot-2020'),
      member('e5', 360, [0, 0], ['tee', 'tee'], 'tslot-2020'), member('e6', 300, [0, 0], ['free', 'free'], 'tslot-2020'),
    ] }];
    const q = (id: string) => bom(fr).find((l) => l.id === id)?.qty;
    expect(q('tslot-2020')).toBe(6);
    expect(q('bracket-20')).toBeUndefined();
    const steel = bom([{ id: 'F3', members: [member('e1', 600, [0, 45], ['butt', 'mitre']), member('e2', 600, [45, 0], ['mitre', 'butt'])] }]);
    expect(steel.find((l) => l.id === 'weld')?.qty).toBe(3);   // a butt is one weld, each mitre end half of one
  });
  it('counts a mitred steel rectangle as four welds and no plugs', () => {
    const b = bom(mitred);
    expect(b.find((l) => l.id === 'weld')).toMatchObject({ qty: 4, unit: 'joints' });
    expect(b.find((l) => l.id === 'plug-shs-40')).toBeUndefined();
    expect(b.find((l) => l.id === 'shs-40x40x2')?.detail).toContain('2160 mm total');
  });
  it('exports both tables as CSV', () => {
    const csv = toCsv(mitred).split('\r\n');
    expect(csv[0]).toBe('Item,Profile,Length (mm),Angle 1 (deg),Angle 2 (deg),Qty,Mass each (kg),Members');
    expect(csv[1]).toBe('1,SHS 40 x 40 x 2,640,45,45,2,1.432,F2 M1 F2 M3');
    expect(csv).toContain('Item,Part,Qty,Unit,Type,Standard,Grade,Material,Mass (kg),Detail');
    expect(toCsv(mitred).endsWith('\r\n')).toBe(true);
  });
  it('exports both tables as aligned text', () => {
    const t = toText(mitred).split('\n');
    expect(t[0]).toMatch(/^Item +Profile +Length \(mm\)/);
    expect(t[2]).toContain('SHS 40 x 40 x 2');
    expect(t).toContain('');
  });
  it('reads only well-formed frames from a reply', () => {
    expect(readFrames(undefined)).toEqual([]);
    expect(readFrames([{ id: 'F2', members: [] }, { nope: 1 }])).toHaveLength(1);
  });
});

describe('picking a joint', () => {
  const report: FrameReport = { id: 'F2', members: [member('e1', 600, [0, 0], ['butt', 'through'], 'tslot-2020'), member('e2', 400, [0, 0], ['butt', 'through'], 'tslot-2020'), member('e3', 600, [0, 0], ['butt', 'through'], 'tslot-2020')].map((m, i) => ({ ...m, body: `F2 M${i + 1}`, segment: `e${i + 1}` })),
    hardware: { parts: [], joints: [
      { segments: ['e1', 'e2'], node: [600, 0, 0], angle: 90, corner: 'butt', connector: 'bracket-20', bodies: ['F2 H1', 'F2 H2'] },
      { segments: ['e2', 'e3'], node: [600, 400, 0], angle: 90, corner: 'butt', connector: null, reason: 'x', bodies: [] },
    ] } };
  const faces = ['F2.M1.C0', 'F2.M2.C0', 'F2.M3.C0', 'F2.H1.C0', 'F2.H1.C1', 'F2.H2.C0', 'F2.H3.C0'];
  it('a hardware body picks its own joint, a member face the nearest joint of that member', () => {
    expect(jointOfFace('F2.H2.C4', report)).toBe('e1/e2');
    expect(jointOfFace('F2.H3.C0', report)).toBeNull();
    expect(jointOfFace('F2.M2.C1', report, [595, 20, 0])).toBe('e1/e2');
    expect(jointOfFace('F2.M2.C1', report, [605, 390, 0])).toBe('e2/e3');
    expect(jointOfFace('F2.M2.C1', report, [300, 200, 0])).toBeNull();   // the middle of a member is no joint
    expect(jointOfFace('F2.M1.C1', report)).toBe('e1/e2');   // one joint on that member: no point needed
    expect(jointOfFace('F9.H1.C0', report)).toBeNull();
    expect(jointOfFace(undefined, report)).toBeNull();
  });
  it('lights the hardware at the joint, or the two members when it has none', () => {
    expect(jointFaces('e1/e2', report, faces)).toEqual(['F2.H1.C0', 'F2.H1.C1', 'F2.H2.C0']);
    expect(jointFaces('e2/e3', report, faces)).toEqual(['F2.M2.C0', 'F2.M3.C0']);
    expect(jointFaces('nope', report, faces)).toEqual([]);
  });
});
