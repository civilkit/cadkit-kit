import { describe, expect, it } from 'vitest';
import { evaluate } from './run';
import { caseEditOps } from './index';

// caseBox(): the ops it emits and its checks; the kernel behaviour (volumes, validity) is in caseBox.kernel.test.ts
const feats = (o: Parameters<typeof caseEditOps>[0]) => caseEditOps(o, 1).filter((x) => x.op === 'add').map((x) => (x as { feature: Record<string, unknown> }).feature);
const BASE = { width: 80, depth: 50, height: 30, lidHeight: 15, axis: 'z' as const };   // the z ops are checked here; the default (y) has its own test below
const err = (o: Record<string, unknown>) => { try { caseEditOps({ ...BASE, ...o } as never, 1); return ''; } catch (e) { return (e as Error).message; } };

const extrudes = (f: Array<Record<string, unknown>>) => f.filter((x) => x.type === 'extrude');
const sketches = (f: Array<Record<string, unknown>>) => f.filter((x) => x.type === 'sketch') as Array<{ name: string; entities: Array<{ type: string }> }>;

describe('caseBox() ops', () => {
  it('emits two cups: each an own-body extrude shelled open at one cap, a groove cut in one rim, two tongue cuts on the other, and the lid moved on top', () => {
    const f = feats({ ...BASE, tongueHeight: 1.5, tongueWidth: 1 });
    expect(f.map((x) => x.type).filter((t) => t !== 'plane' && t !== 'sketch')).toEqual(['extrude', 'shell', 'extrude', 'extrude', 'shell', 'extrude', 'extrude', 'moveBody']);
    const ex = extrudes(f);
    expect(ex[0]).toMatchObject({ op: 'newBody', body: 'Base', depth: 15 });
    expect(ex[1]).toMatchObject({ op: 'cut', target: [{ body: 'Base' }], depth: 1.7 });   // tongue on the lid by default: the base gets the groove, 1.5 + 0.2 deep
    expect(ex[2]).toMatchObject({ op: 'newBody', body: 'Lid', depth: 16.5 });   // lidHeight 15 plus the 1.5 tongue layer
    expect(ex[3]).toMatchObject({ op: 'cut', target: [{ body: 'Lid' }], depth: 1.5 });
    expect(ex[4]).toMatchObject({ op: 'cut', target: [{ body: 'Lid' }], depth: 1.5 });
    const sh = f.filter((x) => x.type === 'shell');
    expect(sh[0]).toMatchObject({ faces: [`${ex[0].id}.C1`], thickness: 2 });   // the base opens at its top cap
    expect(sh[1]).toMatchObject({ faces: [`${ex[2].id}.C0`], thickness: 2 });   // the lid at its bottom cap
    const mv = f.at(-1)!;
    expect(mv).toMatchObject({ type: 'moveBody', bodies: [{ feature: ex[2].id }] });
    expect((mv.translate as number[])[2]).toBe(15);   // the lid goes up by the base height
    expect((mv.translate as number[])[0]).toBeLessThan(-10000);   // and back from where it was built, far to one side
    expect(f.some((x) => x.type === 'lip' || x.type === 'lipJoint' || x.type === 'split')).toBe(false);
  });
  it('the default rises along y: sketches on the top plane at y offsets, the lid moved up by y, the fillet points in world coordinates; axis z is the old +z', () => {
    const f = caseEditOps({ width: 80, depth: 50, height: 30, lidHeight: 15, radius: 5, topRadius: 2, origin: [10, 5, -7] }, 1).filter((x) => x.op === 'add').map((x) => (x as { feature: Record<string, unknown> }).feature);
    const sk = f.filter((x) => x.type === 'sketch') as Array<{ plane: { kind: string; id?: string; plane?: string }; entities: unknown[] }>;
    const planes = f.filter((x) => x.type === 'plane') as Array<{ offset: number; base?: { id?: string } }>;
    expect(planes[0].offset).toBe(5);   // the base stands on y = 5, an offset of the top plane
    expect(planes[0].base).toMatchObject({ id: 'top' });
    expect(sk[0].plane).toMatchObject({ kind: 'feature', id: 'F1' } as never);
    expect(feats({ width: 80, depth: 50, height: 30 }).filter((x) => x.type === 'sketch')[0].plane).toMatchObject({ kind: 'std', id: 'top' } as never);   // no origin: on the top plane itself
    expect(f.at(-1)).toMatchObject({ type: 'moveBody', translate: [-10160, 15, 0] });
    const fl = f.filter((x) => x.type === 'fillet') as Array<{ edges: Array<{ at: number[] }> }>;
    expect(fl[0].edges.every((e) => e.at[1] === 5)).toBe(true);   // the base bottom, y = 5, and the points lie round (10, -7) in x and z
    expect(Math.max(...fl[0].edges.map((e) => e.at[0]))).toBe(50);
    expect(Math.max(...fl[0].edges.map((e) => e.at[2]))).toBe(18);
    expect(Math.min(...fl[0].edges.map((e) => e.at[2]))).toBe(-32);
    expect(fl[1].edges.every((e) => e.at[1] === 20)).toBe(true);   // the lid top as built, y = 5 + 15 (the tongue layer is below)
    expect(err({ axis: 'x' })).toContain("axis is 'y'");
  });
  it('a plain rectangle for radius 0, arcs for a radius (the outline, the cavity-side loops of the tongue and groove follow the radius)', () => {
    const sk = (o: object) => sketches(feats({ ...BASE, ...o }));
    expect(sk({}).every((s) => s.entities.every((e) => e.type === 'line'))).toBe(true);
    expect(sk({ radius: 5 }).every((s) => s.entities.filter((e) => e.type === 'arc').length % 4 === 0 && s.entities.some((e) => e.type === 'arc'))).toBe(true);
  });
  it('topRadius adds one fillet per cup, after its shell: the outer edges of the closed end (base bottom, lid top), one per side face of the outline; none for 0', () => {
    expect(feats({ ...BASE }).some((x) => x.type === 'fillet')).toBe(false);
    const f = feats({ ...BASE, topRadius: 2, tongueHeight: 1.5, tongueWidth: 1 });
    expect(f.map((x) => x.type).filter((t) => t !== 'plane' && t !== 'sketch')).toEqual(['extrude', 'shell', 'fillet', 'extrude', 'extrude', 'shell', 'fillet', 'extrude', 'extrude', 'moveBody']);
    const ex = extrudes(f), fl = f.filter((x) => x.type === 'fillet') as Array<{ radius: number; edges: Array<{ faces: string[]; at: number[] }> }>;
    expect(fl[0].radius).toBe(2);
    expect(fl[0].edges.map((e) => e.faces)).toEqual([0, 1, 2, 3].map((i) => [`${ex[0].id}.C0`, `${ex[0].id}.S.e${i + 1}`]));   // the base closes at its bottom cap
    expect(fl[0].edges.every((e) => e.at[2] === 0)).toBe(true);
    expect(fl[1].edges[0].faces[0]).toBe(`${ex[2].id}.C1`);   // the lid at its top cap, z 15 as built (the tongue layer is below)
    expect(fl[1].edges.every((e) => e.at[2] === 15)).toBe(true);
    const sh = f.filter((x) => x.type === 'shell');
    expect(sh[0]).toMatchObject({ faces: [`${ex[0].id}.C1`] });   // the shell still names the open cap
  });
  it('with a side radius the fillet takes the whole rounded loop: a line and an arc per corner, and not a line the radius turns to nothing', () => {
    const fl = (o: object) => (feats({ ...BASE, ...o }).find((x) => x.type === 'fillet') as unknown as { edges: Array<{ faces: string[] }> }).edges;
    expect(fl({ radius: 5, topRadius: 3 })).toHaveLength(8);
    expect(fl({ radius: 25, topRadius: 3 })).toHaveLength(6);   // 2 x 25 is the whole depth: no straight piece on the short sides
  });
  it('tongue on the base builds the base a tongue layer taller and grooves the lid; names, origin and name are carried', () => {
    const f = feats({ ...BASE, tongueOn: 'base', names: ['Tray', 'Cover'], origin: [10, 20, 5] });
    const ex = extrudes(f);
    expect(ex[0]).toMatchObject({ body: 'Tray', depth: 16.5 });
    expect(ex[3]).toMatchObject({ body: 'Cover', depth: 15 });
    expect(ex.at(-1)).toMatchObject({ op: 'cut', target: [{ body: 'Cover' }], depth: 1.7 });
    const planes = f.filter((x) => x.type === 'plane') as Array<{ offset: number }>;
    expect(planes[0].offset).toBe(5);   // the base stands on z = 5
    expect(f.at(-1)).toMatchObject({ type: 'moveBody', translate: [-10160, 0, 15] });
  });
  it('defaults: wall 2, lid a quarter of the height (at least 3 walls), tongue 0.75 wall high and half a wall wide, clearance 0.2', () => {
    const f = feats({ width: 80, depth: 50, height: 40 });
    expect(f.filter((x) => x.type === 'shell')[0]).toMatchObject({ thickness: 2 });
    expect(extrudes(f)[0]).toMatchObject({ depth: 30 });   // the base: 40 less a lid of 10
    expect(extrudes(f)[1]).toMatchObject({ depth: 1.7 });   // the groove: 1.5 + 0.2
    expect(extrudes(f)[2]).toMatchObject({ depth: 11.5 });   // the lid: 10 + the 1.5 tongue layer
    const small = feats({ width: 40, depth: 30, height: 16 });   // a quarter is 4 mm, three walls are 6 mm
    expect(extrudes(small)[0]).toMatchObject({ depth: 10 });
  });
  it("joint: 'lipJoint' emits one shelled box and the lip joint at the seam", () => {
    const f = feats({ ...BASE, joint: 'lipJoint', tongueHeight: 1.5, tongueWidth: 1 });
    expect(f.map((x) => x.type)).toEqual(['sketch', 'extrude', 'shell', 'plane', 'lipJoint']);
    expect(f[2]).toMatchObject({ faces: [], thickness: 2 });
    expect(f[4]).toMatchObject({ height: 1.5, width: 1, clearance: 0.2, tongue: 'above', names: ['Base', 'Lid'], target: { body: 'Case' } });
  });
  it('runs from a script as the free function and as a part method', () => {
    expect(evaluate("caseBox({ width: 60, depth: 40, height: 24 });").errors).toEqual([]);
    expect(evaluate("part('C').caseBox({ width: 60, depth: 40, height: 24, names: ['A', 'B'] });").errors).toEqual([]);
  });
});

describe('caseBox() checks', () => {
  it('passes the guide case', () => { expect(err({})).toBe(''); });
  it('size and wall', () => {
    expect(err({ width: 0 })).toMatch(/must be more than 0/);
    expect(err({ wall: 0.3 })).toMatch(/at least 0.4/);
    expect(err({ wall: 15 })).toMatch(/two walls/);
    expect(err({ height: 4, lidHeight: 2, wall: 2 })).toMatch(/two walls/);
  });
  it('radius', () => {
    expect(err({ radius: -1 })).toMatch(/0 or more/);
    expect(err({ radius: 2 })).toMatch(/more than the wall/);
    expect(err({ radius: 30 })).toMatch(/half of the width or depth/);
    expect(err({ radius: 5 })).toBe('');
  });
  it('topRadius', () => {
    expect(err({ topRadius: -1 })).toMatch(/0 or more/);
    expect(err({ topRadius: 2 })).toBe('');
    expect(err({ topRadius: 4.4 })).toBe('');
    expect(err({ topRadius: 4.5 })).toMatch(/under half a wall/);   // 2.207 x the 2 mm wall is 4.414
    expect(err({ topRadius: 3, radius: 5 })).toBe('');
    expect(err({ topRadius: 5, radius: 4.5 })).toMatch(/at most the side radius/);
    expect(err({ width: 6, depth: 6, topRadius: 4 })).toMatch(/half of the width or depth/);
    expect(err({ lidHeight: 25, topRadius: 3.5 })).toMatch(/less than 3.3 mm, the height of the base less its groove/);   // the base is 5 tall and carries the 1.7 mm groove
    expect(err({ lidHeight: 25, topRadius: 3.2 })).toBe('');
    expect(err({ topRadius: 2, joint: 'lipJoint' })).toMatch(/'cups' only/);
  });
  it('lid and groove heights', () => {
    expect(err({ lidHeight: 2 })).toMatch(/taller than the wall/);
    expect(err({ lidHeight: 29 })).toMatch(/taller than the wall/);
    expect(err({ lidHeight: 3.5, tongueOn: 'base', tongueHeight: 1.5 })).toMatch(/under the groove/);   // the lid is grooved: 3.5 < 1.7 + 2
    expect(err({ lidHeight: 27, tongueHeight: 1.5 })).toMatch(/under the groove/);   // the base is 3 mm: groove 1.7 + wall 2 does not fit
  });
  it('tongue and clearance', () => {
    expect(err({ tongueWidth: 1.8 })).toMatch(/must be less than the 2 mm wall/);
    expect(err({ tongueWidth: 1.6 })).toMatch(/must be less than the 2 mm wall/);   // 1.6 + 0.4 is the whole wall: no wall left outside the groove
    expect(err({ names: ['A', 'A'] })).toMatch(/two different names/);
    expect(err({ joint: 'x' })).toMatch(/joint is/);
    expect(err({ clearance: 1.5 })).toMatch(/between 0 and 1/);
    expect(err({ tongueHeight: 0 })).toMatch(/tongueHeight/);
    expect(err({ tongueOn: 'side' })).toMatch(/'lid' or 'base'/);
  });
});
