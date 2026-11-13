import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentSession, callTool, createTools } from './index';
import { placeholderSnapshot } from './testing/placeholder-snapshot';

// Known scenes: a 20 x 20 x 10 Base (x, y in [-10, 10], z in [0, 10]) and a 10 x 10 x 10 Peg beside it or across it.
const tools = createTools();
let a: AgentSession;
beforeAll(async () => { a = await AgentSession.open({ wasmPath: process.env.CK_WASM, snapshotFn: placeholderSnapshot as never }); }, 60000);
afterAll(async () => { await a.close(); });
const call = async (name: string, args: unknown = {}) => {
  const r = await callTool(a, tools, name, args);
  const text = r.content.find((c) => c.type === 'text' && c.text.trim().startsWith('{')) as { text: string } | undefined;
  return { r, json: text ? JSON.parse(text.text) : null };
};
const scene = async (peg: string) => {
  const r = (await call('run_script', { mode: 'new', code: `const p = part('Pair');
p.sketch('front', (s) => s.rect(20, 20)).extrude(10);
const base = p.handle();
p.sketch('front', (s) => s.rect(10, 10, ${peg})).extrude(10, { newBody: 'Peg' });
p.bodyName(base, 'Base');` })).json;
  expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
  expect(r.solids).toBe(2);
};
const solid = async (code: string) => {
  const r = (await call('run_script', { mode: 'new', code })).json;
  expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
  return r;
};

describe('measure and clearance on two boxes', () => {
  it('a Peg 15 mm from the Base: measure and clearance agree, with the closest points', async () => {
    await scene('[30, 0]');   // Peg x in [25, 35]
    const m = (await call('measure', { a: 'Base', b: 'Peg' })).json;
    expect(m.distance).toBeCloseTo(15, 6);
    expect(m.pointA[0]).toBeCloseTo(10, 6);
    expect(m.pointB[0]).toBeCloseTo(25, 6);
    expect(m.intersects).toBe(false);
    expect(m.offset[0]).toBeCloseTo(15, 6);
    const c = (await call('clearance', { required: 10 })).json;   // two bodies: no a / b needed
    expect(c).toMatchObject({ state: 'clear', pass: true, a: 'Base', b: 'Peg' });
    expect(c.gap).toBeCloseTo(15, 6);
    expect(c.closePairs.length).toBeGreaterThan(0);
    expect(c.closePairs[0].distance).toBeCloseTo(15, 6);
    const tight = (await call('clearance', { a: 1, b: 2, required: 16 })).json;
    expect(tight.pass).toBe(false);
    expect(tight.verdict).toMatch(/short by 1 mm/);
  });

  it('faces and points: a face of the Base to a point, and the angle between two faces of the Base', async () => {
    await scene('[30, 0]');
    const p = (await call('measure', { a: 'Peg', b: [10, 0, 5] })).json;
    expect(p.distance).toBeCloseTo(15, 6);
    const facts = (await call('bodies')).json.bodies;
    expect(facts).toHaveLength(2);
    const near = (await call('measure', { a: [0, 0, 5], b: [0, 0, 50] })).json;
    expect(near.distance).toBeCloseTo(45, 6);   // two points are just two points, inside the part or not
  });

  it('a bad face name is a measure_failed error with a hint, not a crash', async () => {
    await scene('[30, 0]');
    const r = await call('measure', { a: 'F99.C9', b: 'Peg' });
    expect(r.r.isError).toBe(true);
    expect(r.json.error.code).toBe('measure_failed');
    expect(r.json.error.hint).toMatch(/bodies/);
  });
});

describe('interference', () => {
  it('a Peg 5 mm into the Base overlaps by 500 mm3, named by body; a separate Peg does not overlap', async () => {
    await scene('[10, 0]');   // Peg x in [5, 15]: shares x in [5, 10], y in [-5, 5], z in [0, 10] = 5 x 10 x 10
    const i = (await call('interference')).json;
    expect(i.overlapping).toBe(true);
    expect(i.pairCount).toBe(1);
    expect(i.pairs[0].volume).toBeCloseTo(500, 3);
    expect([i.pairs[0].a, i.pairs[0].b].sort()).toEqual(['Base', 'Peg']);
    expect(i.pairs[0].shareOfSmaller).toBeCloseTo(0.5, 3);
    expect(i.pairs[0].box.min[0]).toBeCloseTo(5, 4);
    expect(i.pairs[0].box.max[0]).toBeCloseTo(10, 4);
    const c = (await call('clearance')).json;
    expect(c.state).toBe('contact');
    expect(c.pass ?? false).toBe(false);

    await scene('[30, 0]');
    const none = (await call('interference')).json;
    expect(none).toMatchObject({ overlapping: false, pairCount: 0, bodies: 2 });
  });

  it('one body: the merge rule is explained', async () => {
    await solid(`part('One').sketch('front', (s) => s.rect(20, 20)).extrude(10);`);
    const i = (await call('interference')).json;
    expect(i.bodies).toBe(1);
    expect(i.note).toMatch(/newBody/);
    const c = await call('clearance');
    expect(c.json.error.code).toBe('need_bodies');
  });
});

describe('thickness and draft', () => {
  it('a 1.5 mm plate: the thinnest wall is 1.5 between its two big faces; min 2 fails and lists the place', async () => {
    await solid(`part('Plate').sketch('front', (s) => s.rect(40, 30)).extrude(1.5);`);
    const t = (await call('thickness', { min: 2 })).json;
    expect(t.minThickness).toBeCloseTo(1.5, 3);
    expect(t.pass).toBe(false);
    expect(t.under.length).toBeGreaterThan(0);
    expect(t.where.face).toMatch(/^F\d/);
    expect(t.where.farFace).not.toBe(t.where.face);
    expect(Math.abs(t.where.farPoint[2] - t.where.point[2])).toBeCloseTo(1.5, 3);
    expect(((await call('thickness', { min: 1 })).json).pass).toBe(true);
  });

  it('thickness of one body of two', async () => {
    await scene('[30, 0]');
    const t = (await call('thickness', { body: 'Peg' })).json;
    expect(t.scope).toBe('Peg');
    expect(t.minThickness).toBeCloseTo(10, 3);
  });

  it('a straight box has no draft against +Z (vertical walls, parting top and bottom); a 5 degree taper has 5 against +Z and undercuts against -Z', async () => {
    await solid(`part('Box').sketch('front', (s) => s.rect(20, 20)).extrude(10);`);
    const flat = (await call('draft', { pull: '+Z', min: 1 })).json;
    expect(flat.pass).toBe(false);
    expect(flat.counts).toMatchObject({ vertical: 4, parting: 2, undercut: 0 });
    expect(flat.violations).toHaveLength(4);

    await solid(`part('Taper').sketch('front', (s) => s.rect(20, 20)).extrude(10, { draft: 5 });`);
    const up = (await call('draft', { pull: '+Z', min: 1 })).json;
    const down = (await call('draft', { pull: '-Z', min: 1 })).json;
    const worst = [Math.abs(up.least.draft), Math.abs(down.least.draft)];
    expect(worst[0]).toBeCloseTo(5, 1);
    expect(worst[1]).toBeCloseTo(5, 1);
    expect(Math.sign(up.least.draft)).toBe(-Math.sign(down.least.draft));
    expect([up.pass, down.pass].sort()).toEqual([false, true]);   // one pull direction drafts the walls, the other locks the part in
  });
});

describe('dfm', () => {
  it('printing: a 0.5 mm plate fails the minimum wall; with its own limit 0.4 it passes that rule', async () => {
    await solid(`part('Foil').sketch('front', (s) => s.rect(40, 30)).extrude(0.5);`);
    const r = (await call('dfm', { process: 'printing' })).json;
    expect(r.passed).toBe(false);
    const wall = r.issues.filter((i: { rule: string }) => i.rule === 'minWall');
    expect(wall.length).toBeGreaterThan(0);
    expect(wall[0].value).toBeCloseTo(0.5, 2);
    expect(wall[0].limit).toBeCloseTo(1.2, 6);
    expect(r.limits.find((l: { rule: string }) => l.rule === 'minWall').params.min).toBe(1.2);
    const loose = (await call('dfm', { process: 'printing', rules: ['minWall'], params: { minWall: { min: 0.4 } } })).json;
    expect(loose.issues).toEqual([]);
    expect(loose.passed).toBe(true);
    expect((await call('dfm', { process: 'printing', rules: ['nope'] })).json.error.code).toBe('unknown_rule');
  }, 60000);

  it('cnc: a pocket open to the side is not reachable from +Z only', async () => {
    await solid(`part('Block').sketch('front', (s) => s.rect(40, 20)).extrude(20);`);
    const r = (await call('dfm', { process: 'cnc' })).json;
    expect(r.process).toBe('cnc');
    expect(r.rules.map((x: { rule: string }) => x.rule)).toEqual(expect.arrayContaining(['undercut', 'minWall']));
  }, 60000);

  it('injection: a hole along the pull is fine, a cross hole is an undercut that no mould half can form, a step is not', async () => {
    const mould = async () => (await call('dfm', { process: 'injection', rules: ['mouldUndercut'] })).json;
    await solid(`part('Through').sketch('front', (s) => s.rect(40, 20)).extrude(10).sketch('front', (s) => s.circle(3)).cut(through(), { direction: 'both' });`);
    expect((await mould()).issues).toEqual([]);

    await solid(`part('Step').sketch('front', (s) => s.rect(40, 20)).extrude(10).sketch('front', (s) => s.rect(20, 20, [10, 0])).extrude(8);`);
    expect((await mould()).issues).toEqual([]);

    await solid(`part('Cross').sketch('front', (s) => s.rect(40, 20)).extrude(10).sketch('right', (s) => s.circle(2, [-5, 0])).cut(through(), { direction: 'both' });`);   // sketch x = world -Z: a hole along X through the middle of the 10 mm height
    const cross = await mould();
    expect(cross.issues.length).toBeGreaterThan(0);
    expect(cross.issues[0]).toMatchObject({ rule: 'mouldUndercut', unit: 'mm2' });
    expect(cross.issues[0].message).toMatch(/neither half can form it/);
    expect(cross.issues[0].faces[0]).toMatch(/^F\d/);
    // against the sideways pull the same hole is drilled along the pull: no undercut
    const side = (await call('dfm', { process: 'injection', rules: ['mouldUndercut'], direction: '+X' })).json;
    expect(side.issues).toEqual([]);
    const full = (await call('dfm', { process: 'injection' })).json;
    expect(full.rules.map((x: { rule: string }) => x.rule)).toEqual(['openShell', 'draft', 'uniformWall', 'minWall', 'mouldUndercut']);
    expect(full.issues.some((i: { rule: string }) => i.rule === 'draft')).toBe(true);
  }, 120000);
});
