import { describe, expect, it } from 'vitest';
import { Interpreter, lookOf, SUPPORTED, type DocContext } from './interpreter';

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
    expect(() => I.runSync('solid.cylinder', { base: [0, 0, 0], axis: [0, 0, 0], diameter: 5, height: 5, operation: 'new', body_name: 'X' })).toThrow(/non-zero 3D vector/);
    expect(() => I.runSync('solid.cone', { base: [0, 0, 0], axis: [0, 0, 0], diameter: 5, top_diameter: 2, height: 5, operation: 'new', body_name: 'X' })).toThrow(/non-zero 3D vector/);
    expect(() => I.runSync('solid.combine', { target: 'Rail', tools: ['Nope'], operation: 'cut' })).toThrow(/no body named "Nope"/);
    expect(() => I.runSync('solid.combine', { target: 'Rail', tools: ['Rail'], operation: 'xor' })).toThrow(/cut", "join" or "intersect/);
    expect(() => I.runSync('solid.move', { bodies: ['Rail'] })).toThrow(/translate or axis/);
    expect(() => I.runSync('solid.box', { corner: [0, 0, 0], length: 1, width: 1, height: 1, operation: 'cut', targets: ['Nope'], name: 'c' })).toThrow(/no body named "Nope"/);
  });

  it('supports arbitrary 3D axis vectors for solid.cylinder, solid.cone, and solid.hole (Z-up and Y-up)', () => {
    const I = new Interpreter(scratch, { doc: doc('z') });
    I.runSync('solid.cylinder', { base: [10, 20, 30], axis: [1, 1, 0], diameter: 10, height: 40, operation: 'new', body_name: 'Strut', name: 'Strut' });
    I.runSync('solid.cone', { base: [0, 0, 0], axis: [0, 3, 4], diameter: 12, top_diameter: 4, height: 10, operation: 'new', body_name: 'Nozzle', name: 'Nozzle' });
    I.runSync('solid.cylinder', { base: [0, 0, 0], axis: [1, 0, 1], diameter: 6, height: 20, operation: 'cut', targets: ['Rail'], name: 'AngledBore' });
    I.runSync('solid.hole', { position: [5, 5, 5], direction: [1, 1, 1], diameter: 4, depth: 12, targets: ['Rail'], name: 'SkewHole' });
    const zScript = I.script({ up: 'z' });
    expect(zScript).toContain('at({ origin: [10,20,30], normal: [0.707106781,0.707106781,0], xdir:');
    expect(zScript).toContain('.extrude(40, { name: "Strut", newBody: "Strut" })');
    expect(zScript).toContain('p.loft([{ on: at({ origin: [0,0,0], normal: [0,0.6,0.8], xdir:');
    expect(zScript).toContain('origin: [0,6,8], normal: [0,0.6,0.8]');
    expect(zScript).toContain('.cut(20, { name: "AngledBore @ Rail", from: ["Rail"], direction: \'away\' })');
    expect(zScript).toContain('.cut(12, { name: "SkewHole @ Rail", from: ["Rail"], direction: \'away\' })');
    // Y-up rotates plugin [0, 0.6, 0.8] -> [0, 0.8, -0.6]
    const yScript = I.script({ up: 'y' });
    expect(yScript).toContain('normal: [0,0.8,-0.6]');
  });

  it('maps rich material presets and explicit PBR properties onto boxes and cylinders', () => {
    expect(lookOf('Oak')).toMatchObject({ colour: '#b78a56', finish: 'matte', metalness: 0 });
    expect(lookOf('Walnut')).toMatchObject({ colour: '#6b4a32', finish: 'matte', metalness: 0 });
    expect(lookOf('Maple')).toMatchObject({ colour: '#e6cfa6', finish: 'matte', metalness: 0 });
    expect(lookOf('Stainless Steel')).toMatchObject({ finish: 'brushed', metalness: 0.9 });
    expect(lookOf('Aluminium 6061')).toMatchObject({ finish: 'brushed', metalness: 0.88 });
    expect(lookOf('Clear Glass')).toMatchObject({ finish: 'glass', opacity: 0.35 });

    const I = new Interpreter(scratch, { doc: doc('z') });
    I.runSync('solid.box', { corner: [0, 0, 0], length: 10, width: 10, height: 10, operation: 'new', body_name: 'Panel', name: 'Panel' });
    I.runSync('solid.cylinder', { base: [20, 0, 0], axis: [0, 0, 1], diameter: 8, height: 30, operation: 'new', body_name: 'Rod', name: 'Rod' });
    I.runSync('material.create', { name: 'CustomGlass', color: '#88ccee', opacity: 0.25, roughness: 0.05, metalness: 0, finish: 'glass' });
    I.runSync('material.create', { name: 'Steel', appearance: { preset: 'steel', roughness: 0.2, metalness: 0.95, clearcoat: 0.1 } });
    I.runSync('material.assign', { material: 'CustomGlass', bodies: ['Panel'] });
    I.runSync('material.assign', { material: 'Steel', bodies: ['Rod'] });
    const script = I.script({ up: 'z' });
    expect(script).toContain('p.appearance({ feature: H["Panel"], colour: "#88ccee", finish: "glass", metallic: 0, roughness: 0.05, opacity: 0.25 });');
    expect(script).toContain('p.appearance({ feature: H["Rod"], colour: "#b8c0c8", finish: "brushed", metallic: 0.95, roughness: 0.2, clearcoat: 0.1 });');
  });

  it('captures plugin-declared joint/motion hints with limits and transforms them into document coordinates', () => {
    const I = new Interpreter(scratch, { doc: doc('z') });
    I.runSync('component.create', { name: 'DoorL' });
    I.runSync('solid.box', { corner: [0, 0, 0], length: 300, width: 18, height: 600, operation: 'new', body_name: 'DoorL Panel', name: 'DoorL Panel' });
    I.runSync('component.activate', { component: 'Root' });
    I.runSync('joint.as_built', { name: 'Left Hinge', type: 'revolute', occurrence1: 'DoorL:1', origin: [0, 0, 100], axis: [0, 0, 1] });
    I.runSync('joint.limits', { joint: 'Left Hinge', min: 0, max: 95 });
    I.runSync('joint.create', { name: 'Top Drawer', kind: 'prismatic', bodies: ['DrawerBox'], origin: [0, 0, 500], axis: [0, -1, 0], limits: { min: 0, max: 350 } });

    const zHints = I.jointHints({ up: 'z', offset: [10, 20, 0] });
    expect(zHints).toEqual([
      { name: 'Left Hinge', kind: 'revolute', bodies: ['DoorL Panel'], origin: [10, 20, 100], axis: [0, 0, 1], min: 0, max: 95, component: 'DoorL' },
      { name: 'Top Drawer', kind: 'prismatic', bodies: ['DrawerBox'], origin: [10, 20, 500], axis: [0, -1, 0], min: 0, max: 350 },
    ]);
    // In Y-up document frame: plugin Z -> +Y, plugin -Y -> +Z
    const yHints = I.jointHints({ up: 'y' });
    expect(yHints[0].axis).toEqual([0, 1, 0]);
    expect(yHints[1].axis).toEqual([0, 0, 1]);
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
