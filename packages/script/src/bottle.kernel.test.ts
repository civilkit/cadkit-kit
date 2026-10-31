import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function run(code: string) {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('x') as never);
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
  };
  return runScript(code, h);
}

// script helpers added with the PET bottle example: thin side, sketch.polar, part.combine
describe('bottle helpers', () => {
  it('thin revolve side: left of the profile direction is inside, the other side outside', async () => {
    // the line runs down (sketch y towards 0 from -20): its left is towards the axis, so 'inside' grows a wall r 9..10 and 'outside' r 10..11
    const tube = (side: string) => `part('Tube').sketch('top', (s) => s.polyline([[10, -20], [10, 0]])).revolve(360, { thin: { thickness: 1, side: '${side}' } })`;
    const inward = await run(`${tube('inside')}.expectVolume(${Math.PI * (100 - 81) * 20}, { tol: 1e-3 });`);
    expect(inward.errors.map((e) => e.message)).toEqual([]);
    const outward = await run(`${tube('outside')}.expectVolume(${Math.PI * (121 - 100) * 20}, { tol: 1e-3 });`);
    expect(outward.errors.map((e) => e.message)).toEqual([]);
  }, 120_000);
  it('sketch.polar repeats a drawing: four bars at 90 degree steps', async () => {
    const r = await run(`part('Bars').sketch('front', (s) => s.polar(4, (c) => c.polygon([[10, -1], [14, -1], [14, 1], [10, 1]]))).extrude(3, { newBody: 'Bar' })
      .expectVolume(96, { tol: 1e-6 }).expectBBox({ min: [-14, -14, 0], max: [14, 14, 3] });`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
  }, 120_000);
  it('sketch.polar about a centre and over part of a turn', async () => {
    const r = await run(`part('Dots').sketch('front', (s) => s.polar(3, (c) => c.circle(1, [5, 0]), { about: [10, 0], angle: 180 })).extrude(2, { newBody: 'Dot' }).expectBBox({ min: [4, -6, 0], max: [16, 1, 2] }, { tol: 0.02 });`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
  }, 120_000);
  it('part.combine cuts one named body out of another', async () => {
    const r = await run(`part('Cup').sketch('front', (s) => s.circle(20)).extrude(30, { newBody: 'Cup' })
      .sketch('front', (s) => s.circle(17)).extrude(28, { newBody: 'Core' }).combine('cut', 'Cup', 'Core').expectVolume(${Math.PI * (400 * 30 - 289 * 28)}, { tol: 1e-3 });`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
  }, 120_000);
  it('part.combine names the bodies that exist when one is missing', async () => {
    const r = await run(`part('Cup').sketch('front', (s) => s.circle(20)).extrude(30, { newBody: 'Cup' }).combine('cut', 'Cup', 'Nope');`);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.errors)).toMatch(/Nope.*Cup/);
  }, 120_000);
});

describe('PET bottle example (docs/examples/pet-bottle.script.ts)', () => {
  it('builds the bottle and the cap as valid solids with the expected size', async () => {
    const code = readFileSync(resolve(process.cwd(), 'docs/examples/pet-bottle.script.ts'), 'utf8') + `\nP.expectValid().expectBBox({ min: [-33, -33, 0], max: [33, 33, 207.4] }, { tol: 0.05 });\n`;
    const r = await run(code);
    expect(r.errors.map((e) => e.message)).toEqual([]);
  }, 300_000);
  it('builds without the cap, with another number of feet and a thicker wall', async () => {
    const code = readFileSync(resolve(process.cwd(), 'docs/examples/pet-bottle.script.ts'), 'utf8').replace('WALL: 0.35, FEET: 5', 'WALL: 0.5, FEET: 6').replace('CAP: 1', 'CAP: 0');
    const r = await run(code + `\nP.expectValid();\n`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
  }, 300_000);
});

describe('PET bottle example, short version (docs/examples/pet-bottle-shell.script.ts)', () => {
  const src = () => readFileSync(resolve(process.cwd(), 'docs/examples/pet-bottle-shell.script.ts'), 'utf8');
  it('builds the shelled bottle with its cap as a valid solid with the expected size', async () => {
    const r = await run(src() + `\nP.expectValid().expectBBox({ min: [-33, -33, 0], max: [33, 33, 207.4] }, { tol: 0.05 });\n`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
  }, 300_000);
  it('builds without the cap, with six feet and a thicker wall', async () => {
    const r = await run(src().replace('WALL: 0.35, FEET: 5', 'WALL: 0.5, FEET: 6').replace('CAP: 1', 'CAP: 0') + `\nP.expectValid();\n`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
  }, 300_000);
});
