import { describe, expect, it } from 'vitest';
import { Interpreter, SUPPORTED, type DocContext } from './interpreter';

const scratch = { async build() { return []; } };
const doc = (up: 'y' | 'z'): DocContext => ({ up, bodies: [{ name: 'Rail', bbox: up === 'z' ? { min: [30, -10, 170], max: [330, 10, 230] } : { min: [30, 170, -10], max: [330, 230, 10] }, volume: 360000 }], selection: [{ type: 'body', name: 'Rail' }, { type: 'face', body: 'Rail', normal: up === 'z' ? [0, 0, 1] : [0, 1, 0] }] });

describe('the commands a joinery plugin needs', () => {
  it('are all supported', () => { for (const c of ['selection.get', 'solid.cylinder', 'solid.cone', 'solid.combine', 'solid.move']) expect(SUPPORTED.has(c)).toBe(true); });

  it('selection.get gives the picked bodies and faces; detail adds the face normal in the plugin frame (Y-up document turned to Z-up)', () => {
    for (const up of ['z', 'y'] as const) {
      const I = new Interpreter(scratch, { doc: doc(up) });
      expect(I.runSync('selection.get', { detail: false })).toEqual({ items: [{ type: 'body', name: 'Rail' }, { type: 'face', body: 'Rail' }] });
      expect(I.runSync('selection.get', { detail: true })).toEqual({ items: [{ type: 'body', name: 'Rail' }, { type: 'face', body: 'Rail', surface: { normal: [0, 0, 1] } }] });
    }
  });

  it('measure answers the open document\'s bodies in the plugin frame, and names_only lists them', async () => {
    const I = new Interpreter(scratch, { doc: doc('y') });
    const r = await I.run('inspect.measure', { bodies: ['Rail'] }) as { bodies: Array<{ volume_mm3: number; bbox: { min: number[]; max: number[] } }> };
    expect(r.bodies[0].bbox).toEqual({ min: [30, -10, 170], max: [330, 10, 230] });
    expect(await I.run('inspect.measure', { names_only: true })).toEqual({ bodies: [{ name: 'Rail' }] });
  });

  it('a translate of a document body shows in the next measure', async () => {
    const I = new Interpreter({ async build() { throw new Error('should not build'); } }, { doc: doc('z') });
    I.runSync('solid.move', { bodies: ['Rail'], translate: [10, 0, 5] });
    // a build is needed once something is recorded: the scratch answers nothing here, so the document's box (moved) fills in
    const I2 = new Interpreter({ async build() { return [{ name: 'Rail', volume: 360000, bbox: null }]; } }, { doc: doc('z') });
    I2.runSync('solid.move', { bodies: ['Rail'], translate: [10, 0, 5] });
    const r = await I2.run('inspect.measure', { bodies: ['Rail'] }) as { bodies: Array<{ bbox: { min: number[] } }> };
    expect(r.bodies[0].bbox.min).toEqual([40, -10, 175]);
  });

  it('refuses what it cannot do, with the command in the message', () => {
    const I = new Interpreter(scratch, { doc: doc('z') });
    expect(() => I.runSync('solid.cylinder', { base: [0, 0, 0], axis: [1, 1, 0], diameter: 5, height: 5, operation: 'new', body_name: 'X' })).toThrow(/axis along x, y or z/);
    expect(() => I.runSync('solid.combine', { target: 'Rail', tools: ['Nope'], operation: 'cut' })).toThrow(/no body named "Nope"/);
    expect(() => I.runSync('solid.combine', { target: 'Rail', tools: ['Rail'], operation: 'xor' })).toThrow(/cut", "join" or "intersect/);
    expect(() => I.runSync('solid.move', { bodies: ['Rail'] })).toThrow(/translate or axis/);
    expect(() => I.runSync('solid.box', { corner: [0, 0, 0], length: 1, width: 1, height: 1, operation: 'cut', targets: ['Nope'], name: 'c' })).toThrow(/no body named "Nope"/);
  });

  it('writes the script: a cone is a loft, a join or intersect is a combine, a move is moveBody (Y-up turns axes and points)', () => {
    const I = new Interpreter(scratch, { doc: doc('z') });
    I.runSync('solid.cone', { base: [0, 0, 10], axis: [0, 0, -1], diameter: 8, top_diameter: 4, height: 2, operation: 'cut', targets: ['Rail'], name: 'Countersink' });
    I.runSync('solid.cylinder', { base: [0, 0, 0], axis: [0, 0, 1], diameter: 8, height: 4, operation: 'intersect', targets: ['Rail'], name: 'Biscuit' });
    I.runSync('solid.box', { corner: [0, 0, 0], length: 5, width: 5, height: 5, operation: 'new', body_name: 'Tool', name: 'Tool' });
    I.runSync('solid.move', { bodies: ['Tool'], origin: [0, 0, 0], axis: [0, 0, 1], angle: 45 });
    I.runSync('solid.combine', { target: 'Rail', tools: ['Tool'], operation: 'cut', keep_tools: true });
    const z = I.script({ up: 'z' });
    expect(z).toMatch(/p\.loft\(\[.*\], \{ op: 'cut', name: "Countersink @ Rail", from: \["Rail"\] \}\)/);
    expect(z).toContain(`p.combine('intersect', "Rail", ["Biscuit (intersect)"])`);
    expect(z).toContain('p.moveBody(["Tool"], { rotate: { axis: [0,0,1], origin: [0,0,0], angle: 45 } })');
    expect(z).toContain(`p.combine('cut', "Rail", ["Tool"], { keepTools: true })`);
    expect(I.script({ up: 'y' })).toContain('rotate: { axis: [0,1,0], origin: [0,0,0], angle: 45 }');   // plugin Z (up) is the document's Y
  });
});
