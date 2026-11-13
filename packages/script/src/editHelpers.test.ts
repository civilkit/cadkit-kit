import { describe, expect, it } from 'vitest';
import { runScript, type ScriptHost } from './index';

// a 2 x 2 x 2 box as two named faces (top F2.C1, one side F2.S.e1) plus the one edge between them: enough to resolve face() and edges()
const geo = () => ({
  mesh: {
    positions: [0, 0, 2, 2, 0, 2, 2, 2, 2, 0, 0, 2, 2, 2, 2, 0, 2, 2, 0, 0, 0, 2, 0, 0, 2, 0, 2, 0, 0, 0, 2, 0, 2, 0, 0, 2],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0],
    triFace: [0, 0, 1, 1], faceIds: ['F2.C1', 'F2.S.e1'],
  },
  edges: [{ key: 'a', faces: ['F2.C1', 'F2.S.e1'], mid: [1, 0, 2], pts: [[0, 0, 2], [2, 0, 2]] }],
  box: { min: [0, 0, 0], max: [2, 2, 2] },
});
const host = (loaded: Array<Record<string, unknown>>): ScriptHost => ({
  load: async (d) => { loaded.push(d); },
  edit: async () => ({ ok: true }),
  geometry: geo as never,
  build: async () => ({ errors: [], geometry: geo() as never }),
  release: async () => {},
});
const BASE = `const p = part('B').sketch('front', (s) => s.rect(2, 2)).extrude(2);\n`;
/** the features a script adds after the base sketch + extrude */
async function feats(code: string): Promise<Array<Record<string, any>>> {
  const r = await runScript(BASE + code, host([]), {}, { yieldToUi: async () => {} });
  if (r.errors.length) throw new Error(r.errors.map((e) => e.message).join(' | '));
  return (r.document!.features as Array<Record<string, any>>).slice(2);
}
const fail = async (code: string): Promise<string> => {
  const r = await runScript(BASE + code, host([]), {}, { yieldToUi: async () => {} });
  return r.errors.map((e) => e.message).join(' | ');
};

describe('typed helpers for kernel features: the emitted feature JSON', () => {
  it('draft', async () => {
    const [f] = await feats(`p.draft(face('F2.S.e1'), 5, { neutral: 'front' });`);
    expect(f).toMatchObject({ type: 'draft', neutral: { kind: 'std', id: 'front' }, faces: ['F2.S.e1'], angle: 5 });
    expect(f.flip).toBeUndefined();
    const [g] = await feats(`p.draft(face('F2.S.e1'), 3, { neutral: face('F2.C1'), flip: true });`);
    expect(g).toMatchObject({ neutral: { kind: 'face', id: 'F2.C1' }, flip: true, angle: 3 });
    expect(await fail(`p.draft(face('F2.S.e1'), 3, {});`)).toMatch(/neutral plane/);
  });
  it('moveFace: offset or translate', async () => {
    expect((await feats(`p.moveFace(face('F2.C1'), { distance: 2.5 });`))[0]).toMatchObject({ type: 'moveFace', faces: ['F2.C1'], mode: 'offset', distance: 2.5 });
    expect((await feats(`p.moveFace(face('F2.S.e1'), { translate: [3, 0, 0], flip: true });`))[0]).toMatchObject({ mode: 'translate', translate: [3, 0, 0], flip: true });
    expect(await fail(`p.moveFace(face('F2.C1'), {});`)).toMatch(/exactly one/);
    expect(await fail(`p.moveFace(face('F2.C1'), { distance: 1, translate: [1, 0, 0] });`)).toMatch(/exactly one/);
  });
  it('lip and groove', async () => {
    const [l] = await feats(`p.lip(face('F2.C1'), edges('all'), { width: 1, height: 1.5 });`);
    expect(l).toMatchObject({ type: 'lip', kind: 'lip', faces: ['F2.C1'], edges: [{ faces: ['F2.C1', 'F2.S.e1'], at: [1, 0, 2] }], width: 1, height: 1.5 });
    const [g] = await feats(`p.groove(face('F2.C1'), edges('all'));`);
    expect(g).toMatchObject({ type: 'lip', kind: 'groove' });
    expect(g.width).toBeUndefined();
  });
  it('scale, split, deleteBody, deleteFace', async () => {
    expect((await feats(`p.scale([1, 2, 0.5], { about: 'origin' });`))[0]).toMatchObject({ type: 'scale', factor: [1, 2, 0.5], about: 'origin' });
    expect((await feats(`p.scale(1.5, { at: [1, 2, 3], bodies: 'A' });`))[0]).toMatchObject({ factor: 1.5, at: [1, 2, 3], bodies: [{ body: 'A' }] });
    expect(await fail(`p.scale(1.5, { about: 'middle' });`)).toMatch(/centroid/);
    expect((await feats(`p.split('Block', ['Slab', 'Cut'], { keepTools: true });`))[0]).toMatchObject({ type: 'combine', op: 'split', target: { body: 'Block' }, tools: [{ body: 'Slab' }, { body: 'Cut' }], keepTools: true });
    expect((await feats(`p.deleteBody('B');`))[0]).toMatchObject({ type: 'deleteBody', mode: 'delete', bodies: [{ body: 'B' }] });
    expect((await feats(`p.deleteBody([face('F2.C1'), 'X'], { keep: true });`))[0]).toMatchObject({ mode: 'keep', bodies: [{ face: 'F2.C1' }, { body: 'X' }] });
    expect((await feats(`p.deleteFace(face('F2.C1'));`))[0]).toEqual(expect.objectContaining({ type: 'deleteFace', faces: ['F2.C1'] }));
  });
  it('helix: a circle sketch and the helix feature, by any two of pitch / revolutions / height', async () => {
    const [sk, h] = await feats(`p.helix({ radius: 10, pitch: 4, revolutions: 5 });`);
    expect(sk).toMatchObject({ type: 'sketch', plane: { kind: 'std', id: 'top' }, entities: [expect.objectContaining({ type: 'circle', r: 10 })] });
    expect(h).toMatchObject({ type: 'helix', sketch: sk.id, definedBy: 'pitchRevs', pitch: 4, revolutions: 5 });
    expect((await feats(`p.helix({ radius: 5, height: 20, revolutions: 4, leftHand: true, startAngle: 90 });`))[1]).toMatchObject({ definedBy: 'heightRevs', height: 20, revolutions: 4, leftHand: true, startAngle: 90 });
    expect((await feats(`p.helix({ radius: 5, height: 20, pitch: 2, reverse: true });`))[1]).toMatchObject({ definedBy: 'heightPitch', reverse: true });
    expect(await fail(`p.helix({ radius: 5, pitch: 2 });`)).toMatch(/exactly two/);
    expect(await fail(`p.helix({ radius: 5, pitch: 2, height: 3, revolutions: 4 });`)).toMatch(/exactly two/);
  });
  it('sweep along a helix handle', async () => {
    const fs = await feats(`p.helix({ radius: 10, pitch: 4, revolutions: 5 }); const hx = p.handle();
      p.sweep({ on: 'front', draw: (s) => s.circle(1.5, [10, 0]) }, { curve: hx });`);
    const helix = fs.find((f) => f.type === 'helix')!, sweep = fs.find((f) => f.type === 'sweep')!;
    expect(sweep.path).toEqual({ kind: 'curve', id: helix.id });
  });
  it('sweep with guides and guideMode', async () => {
    const fs = await feats(`p.sweep({ on: 'top', draw: (s) => s.circle(3) }, { on: 'front', draw: (s) => s.line([0, 0], [0, 20]) },
      { guides: [{ on: 'front', draw: (s) => s.line([3, 0], [6, 20]) }], guideMode: 'turn' });`);
    const sweep = fs.find((f) => f.type === 'sweep')!;
    expect(sweep.guideMode).toBe('turn');
    expect(sweep.guides).toEqual([{ kind: 'sketchCurve', sketch: expect.any(String), entity: expect.any(String) }]);
    const gsk = fs.find((f) => f.id === sweep.guides[0].sketch)!;
    expect(gsk.entities.map((e: any) => e.id)).toContain(sweep.guides[0].entity);
    expect(await fail(`p.sweep({ on: 'top', draw: (s) => s.circle(3) }, { on: 'front', draw: (s) => s.line([0, 0], [0, 20]) }, { guideMode: 'turn' });`)).toMatch(/needs guides/);
    expect(await fail(`p.sweep({ on: 'top', draw: (s) => s.circle(3) }, { on: 'front', draw: (s) => s.line([0, 0], [0, 20]) }, { twist: 10, guides: [{ on: 'front', draw: (s) => s.line([3, 0], [6, 20]) }] });`)).toMatch(/twist/);
    expect(await fail(`p.sweep({ on: 'top', draw: (s) => s.circle(3) }, { on: 'front', draw: (s) => s.line([0, 0], [0, 20]) }, { guides: [{ on: 'front', draw: (s) => s.rect(3, 3) }] });`)).toMatch(/exactly one curve/);
  });
  it('axis: world axis, edge, cylinder face and two planes', async () => {
    expect((await feats(`p.axis('y');`))[0]).toMatchObject({ type: 'axis', refs: [{ kind: 'axis', axis: 'y' }] });
    expect((await feats(`p.axis(edges('all'));`))[0]).toMatchObject({ refs: [{ kind: 'edge', faces: ['F2.C1', 'F2.S.e1'], at: [1, 0, 2] }] });
    expect((await feats(`p.axis(face('F2.S.e1'));`))[0]).toMatchObject({ refs: [{ kind: 'face', id: 'F2.S.e1' }] });
    expect((await feats(`p.axis('top', face('F2.C1'));`))[0]).toMatchObject({ refs: [{ kind: 'std', id: 'top' }, { kind: 'face', id: 'F2.C1' }] });
    expect(await fail(`p.axis(12);`)).toMatch(/axis\(a\)/);
  });
  it('sphere', async () => {
    expect((await feats(`p.sphere(10);`))[0]).toMatchObject({ type: 'sphere', op: 'add', center: [0, 0, 0], radius: 10 });
    expect((await feats(`p.sphere(4, { centre: [1, 2, 3], op: 'cut' });`))[0]).toMatchObject({ op: 'cut', center: [1, 2, 3], radius: 4 });
    expect((await feats(`p.sphere(4, { newBody: 'Ball' });`))[0]).toMatchObject({ op: 'newBody', body: 'Ball' });
    expect(await fail(`p.sphere(4, { op: 'cut', newBody: true });`)).toMatch(/newBody/);
  });
  it('moveBody: translate, rotate, copy and mirror copy', async () => {
    expect((await feats(`p.moveBody('A', { translate: [100, 0, 0], rotate: { axis: 'z', origin: [0, 0, 0], angle: 90 } });`))[0])
      .toMatchObject({ type: 'moveBody', bodies: [{ body: 'A' }], translate: [100, 0, 0], rotate: { axis: 'z', origin: [0, 0, 0], angle: 90 } });
    const all = (await feats(`p.moveBody({ translate: [0, 30, 0], copy: true, body: 'Copy' });`))[0];
    expect(all).toMatchObject({ type: 'moveBody', copy: true, body: 'Copy', translate: [0, 30, 0] });
    expect(all.bodies).toBeUndefined();
    expect((await feats(`p.moveBody('A', { copy: true, mirror: 'right' });`))[0]).toMatchObject({ copy: true, mirror: { kind: 'std', id: 'right' } });
    expect(await fail(`p.moveBody('A', { mirror: 'right' });`)).toMatch(/copy: true/);
    expect(await fail(`p.moveBody('A', {});`)).toMatch(/translate, rotate/);
  });
});
