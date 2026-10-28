import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentSession, callTool, createTools } from './index';
import { placeholderSnapshot } from './testing/placeholder-snapshot';

const tools = createTools();
let a: AgentSession;
beforeAll(async () => { a = await AgentSession.open({ wasmPath: process.env.CK_WASM, snapshotFn: placeholderSnapshot as never }); }, 60000);
afterAll(async () => { await a.close(); });
const call = async (name: string, args: unknown = {}) => {
  const r = await callTool(a, tools, name, args);
  const text = r.content.find((c) => c.type === 'text' && c.text.trim().startsWith('{')) as { text: string } | undefined;
  return { r, json: text ? JSON.parse(text.text) : null };
};
const run = (code: string) => call('run_script', { code, mode: 'new' });

describe('bodies tool, newBody and multi-body cut warnings', () => {
  it('touching solids fuse into one body; newBody keeps them apart and names them', async () => {
    const fused = (await run(`const p = part('Pair');
p.sketch('front', (s) => s.rect(20, 20)).extrude(10);
p.sketch('front', (s) => s.rect(10, 10)).extrude(20);`)).json;
    expect(fused.solids).toBe(1);
    expect((await call('bodies')).json.count).toBe(1);

    const sep = (await run(`const p = part('Pair');
p.sketch('front', (s) => s.rect(20, 20)).extrude(10);
const base = p.handle();
p.sketch('front', (s) => s.rect(10, 10)).extrude(20, { newBody: 'Pin' });
const pin = p.handle();
p.appearance({ feature: pin, colour: '#b87333', finish: 'plastic' });
p.bodyName(base, 'Base');`)).json;
    expect(sep.ok).toBe(true);
    expect(sep.solids).toBe(2);
    const b = (await call('bodies')).json;
    expect(b.count).toBe(2);
    const [base, pin] = b.bodies;
    expect(base.name).toBe('Base');
    expect(base.feature).toBe('F2');
    expect(base.volume).toBeCloseTo(4000, 0);
    expect(base.bbox.size).toEqual([20, 20, 10]);
    expect(base.appearance).toBeNull();
    expect(pin.name).toBe('Pin');
    expect(pin.volume).toBeCloseTo(2000, 0);
    expect(pin.appearance).toEqual({ color: '#b87333', finish: 'plastic' });
  });

  it('warns when one cut changed several bodies; a single-body cut does not warn', async () => {
    const r = (await run(`const p = part('Slit');
p.sketch('front', (s) => s.rect(40, 10)).extrude(10);
p.sketch('front', (s) => s.rect(10, 10, [0, 30])).extrude(10, { newBody: true });
p.sketch('front', (s) => s.rect(2, 80, [0, 15])).cut(through(), { direction: 'away' });`)).json;
    expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
    expect(JSON.stringify(r.warnings)).toMatch(/cutHitManyBodies/);
    expect(JSON.stringify(r.warnings)).toMatch(/changed 2 bodies/);
    const clean = (await run(`const p = part('Slit');
p.sketch('front', (s) => s.rect(40, 10)).extrude(10);
p.sketch('front', (s) => s.rect(10, 10, [0, 30])).extrude(10, { newBody: true });
p.sketch('front', (s) => s.rect(6, 2)).cut(through(), { direction: 'away' });`)).json;
    expect(clean.ok).toBe(true);
    expect(JSON.stringify(clean.warnings)).not.toMatch(/cutHitManyBodies/);
  });

  it('profileCrossesAxis and cutNoEffect hints say what to draw and print the sketch frame', async () => {
    const rev = (await run(`part('Screw').sketch('front', (s) => s.polygon([[-5, 0], [5, 0], [5, 20], [-5, 20]])).revolve(360);`)).json;
    expect(rev.ok).toBe(false);
    expect(rev.errors[0].code).toBe('profileCrossesAxis');
    expect(rev.errors[0].hint).toMatch(/HALF of the profile, from the axis outwards/);
    const cut = (await run(`part('Miss').sketch('front', (s) => s.rect(20, 20)).extrude(10).sketch('right', (s) => s.circle(3, [100, 0])).cut(5, { direction: 'into' });`)).json;
    expect(cut.ok).toBe(false);
    expect(cut.errors[0].code).toMatch(/cutNoEffect|nothingToCut/);
    expect(cut.errors[0].hint).toMatch(/'right': sketch x = world -Z, sketch y = world \+Y, normal \+X/);
  });

  it('documented plane frames hold: standard planes and { origin, normal, xdir } (u = xdir, v = normal x xdir)', async () => {
    const box = async (plane: string) => (await run(`part('Frame').sketch(${plane}, (s) => s.rect(2, 2, [10, 5])).extrude(1);`)).json.bbox;
    const centre = (b: { min: number[]; max: number[] }) => b.min.map((m, i) => (m + b.max[i]) / 2);
    expect(centre(await box(`'front'`))).toEqual([10, 5, 0.5]);
    expect(centre(await box(`'top'`))).toEqual([10, 0.5, -5]);          // sketch y = world -Z
    expect(centre(await box(`'right'`))).toEqual([0.5, 5, -10]);        // sketch x = world -Z
    expect(centre(await box(`at({ origin: [0, 0, 0], normal: [1, 0, 0], xdir: [0, 0, 1] })`))).toEqual([0.5, -5, 10]);   // u = +Z, v = X x Z = -Y
    expect(centre(await box(`at({ origin: [0, 0, 0], normal: [0, 0, 1], xdir: [0, 1, 0] })`))).toEqual([-5, 10, 0.5]);   // u = +Y, v = Z x Y = -X
  });
});
