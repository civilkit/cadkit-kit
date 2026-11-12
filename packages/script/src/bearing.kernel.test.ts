import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentSession, callTool, createTools } from '../../agent-tools/src';
import { placeholderSnapshot } from '../../agent-tools/src/testing/placeholder-snapshot';
import { bearingModel, housingSeat, innerRingProfile, outerRingProfile, type BearingSpec } from './bearingTable';

const tools = createTools();
let a: AgentSession;
beforeAll(async () => { a = await AgentSession.open({ wasmPath: process.env.CK_WASM, snapshotFn: placeholderSnapshot as never }); }, 60000);
afterAll(async () => { await a.close(); });
const call = async (name: string, args: unknown = {}) => {
  const r = await callTool(a, tools, name, args);
  const text = r.content.find((c) => c.type === 'text' && c.text.trim().startsWith('{')) as { text: string } | undefined;
  return { r, json: text ? JSON.parse(text.text) : null };
};
interface Body { name: string; feature: string; volume: number; bbox: { min: number[]; max: number[]; size: number[] } }
/** Run a script as a new part and read the bodies back. */
async function build(code: string): Promise<{ run: any; bodies: Body[] }> {
  const run = (await call('run_script', { code, mode: 'new' })).json;
  const bodies = run?.ok ? (await call('bodies')).json.bodies as Body[] : [];
  return { run, bodies };
}

/**
 * Volume of a polygon (x radial, y axial) revolved a full turn about the y axis: Pappus, 2 pi x centroid-x x area. The profiles passed in have the groove arcs
 * sampled in 2000 chords (points on the true arc), which puts the polygon's area within about one part in 10^7 of the true one, far below the tolerance.
 */
function revolved(pts: Array<[number, number]>): number {
  let A = 0, Sx = 0;
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; const c = p[0] * q[1] - q[0] * p[1]; A += c; Sx += (p[0] + q[0]) * c; });
  return Math.abs(2 * Math.PI * (Sx / (3 * A)) * (A / 2));
}
const near = (v: number, want: number, tol: number) => { expect(v).toBeGreaterThan(want * (1 - tol)); expect(v).toBeLessThan(want * (1 + tol)); };
const spec = (o: Partial<BearingSpec> = {}): BearingSpec => ({ bore: 8, od: 22, width: 7, ...o });

describe('bearing(): rings and covers', () => {
  for (const seal of ['2Z', '2RS'] as const) {
    it(`608 ${seal}: valid, two bodies named inner and outer ring, volumes match the revolved profiles, bbox is the outer diameter by the width`, async () => {
      const { run, bodies } = await build(`part('B').bearing({ designation: '608', seal: '${seal}' });`);
      console.log('BEARING', seal, JSON.stringify({ ok: run.ok, solids: run.solids, ms: run.ms, vol: run.volume, bodies: bodies.map((b) => [b.name, +b.volume.toFixed(2)]) }));
      expect(run.ok, JSON.stringify(run.errors)).toBe(true);
      expect(bodies.length).toBe(2);
      expect(bodies.map((b) => b.name).sort()).toEqual(['Bearing 608 inner ring', 'Bearing 608 outer ring']);
      const m = bearingModel(spec({ seal }));
      const inner = bodies.find((b) => /inner/.test(b.name))!, outer = bodies.find((b) => /outer/.test(b.name))!;
      near(inner.volume, revolved(innerRingProfile(m, 2000)), 0.002);
      near(outer.volume, revolved(outerRingProfile(m, 2000)), 0.002);
      expect(m.groove).not.toBeNull();   // the volumes above include the groove: a plain ring would be several percent bigger
      const all = [inner, outer];
      expect(Math.min(...all.map((b) => b.bbox.min[0]))).toBeCloseTo(-11, 2);
      expect(Math.max(...all.map((b) => b.bbox.max[0]))).toBeCloseTo(11, 2);
      expect(Math.min(...all.map((b) => b.bbox.min[2]))).toBeCloseTo(0, 2);
      expect(Math.max(...all.map((b) => b.bbox.max[2]))).toBeCloseTo(7, 2);
      expect(inner.bbox.size[0]).toBeCloseTo(2 * m.r2s, 1);   // the display mesh is faceted
    }, 600_000);
  }

  it('open bearing with small balls (too small for a groove), sharp corners: rings are plain tubes', async () => {
    const { run, bodies } = await build(`part('B').bearing({ bore: 10, od: 30, width: 9, seal: 'open', chamfer: 0, balls: 6, ballDiameter: 2 });`);
    expect(run.ok, JSON.stringify(run.errors)).toBe(true);
    const m = bearingModel(spec({ bore: 10, od: 30, width: 9, seal: 'open', chamfer: 0, balls: 6, ballDiameter: 2 }));
    expect(m.groove).toBeNull();
    const rings = bodies.filter((b) => / ring$/.test(b.name));
    expect(rings.length).toBe(2);
    const tube = (r1: number, r2: number) => Math.PI * (r2 * r2 - r1 * r1) * 9;
    near(rings.find((b) => /inner/.test(b.name))!.volume, tube(m.r1, m.r2), 0.005);
    near(rings.find((b) => /outer/.test(b.name))!.volume, tube(m.r3, m.R), 0.005);
  }, 600_000);
});

describe('bearing(): the ball groove', () => {
  for (const [designation, seal] of [['608', 'open'], ['608', '2Z'], ['608', '2RS'], ['6204', 'open'], ['6204', '2RS'], ['625', 'open']] as const) {
    it(`${designation} ${seal}: regenerates valid, each ring one solid whose volume is the grooved profile revolved`, async () => {
      const { run, bodies } = await build(`part('B').bearing({ designation: '${designation}', seal: '${seal}' });`);
      expect(run.ok, JSON.stringify(run.errors)).toBe(true);
      const p = { '608': [8, 22, 7], '6204': [20, 47, 14], '625': [5, 16, 5] }[designation];
      const m = bearingModel({ bore: p[0], od: p[1], width: p[2], seal });
      expect(m.groove, 'grooved').not.toBeNull();
      const inner = bodies.find((b) => /inner/.test(b.name))!, outer = bodies.find((b) => /outer/.test(b.name))!;
      // The kernel reports the volume of its display mesh, and the groove is a concave torus: its facets move the volume by up to 0.3 % (6204 inner ring +0.27 %,
      // outer ring -0.17 %; 608 +0.13 % / -0.17 %). 0.005 holds that, and a plain ring (no groove) would differ by 5 to 10 %, so it still tells a groove from none.
      near(inner.volume, revolved(innerRingProfile(m, 2000)), 0.005);
      near(outer.volume, revolved(outerRingProfile(m, 2000)), 0.005);
      console.log('GROOVEDIFF', designation, seal, (inner.volume / revolved(innerRingProfile(m, 2000)) - 1).toFixed(5), (outer.volume / revolved(outerRingProfile(m, 2000)) - 1).toFixed(5));
      // the groove really removed material: the kernel volume is the same ring without the groove minus the revolved circular segment, whose centroid lies between the groove bottom and the shoulder
      const g = m.groove!, h = g.radius - g.depth;
      const seg = g.radius ** 2 * Math.acos(h / g.radius) - h * Math.sqrt(g.radius ** 2 - h * h);
      const removed = revolved(innerRingProfile({ ...m, groove: null }, 2000)) - inner.volume;
      expect(removed).toBeGreaterThan(2 * Math.PI * (g.centre[0] - g.radius) * seg * 0.95);
      expect(removed).toBeLessThan(2 * Math.PI * m.r2s * seg * 1.05);
      console.log('GROOVE', designation, seal, JSON.stringify({ inner: +inner.volume.toFixed(3), outer: +outer.volume.toFixed(3), r: +g.radius.toFixed(4), depth: +g.depth.toFixed(4) }));
    }, 600_000);
  }
});

describe('bearing(): open bearing with balls', () => {
  it('625 open: rings plus one body per ball, each ball a sphere of the model diameter, between the races', async () => {
    const { run, bodies } = await build(`part('B').bearing({ designation: '625', seal: 'open' });`);
    console.log('BEARING open 625', JSON.stringify({ ok: run.ok, solids: run.solids, ms: run.ms, bodies: bodies.map((b) => [b.name, +b.volume.toFixed(3)]) }));
    expect(run.ok, JSON.stringify(run.errors)).toBe(true);
    const m = bearingModel({ bore: 5, od: 16, width: 5, seal: 'open' });
    expect(m.balls).toBe(7);
    expect(bodies.length).toBe(2 + m.balls);
    const balls = bodies.filter((b) => !/ ring$/.test(b.name));
    expect(balls.length).toBe(m.balls);
    const sphere = (4 / 3) * Math.PI * (m.ballDiameter / 2) ** 3;
    for (const b of balls) {
      near(b.volume, sphere, 0.01);
      expect(b.bbox.size[2]).toBeCloseTo(m.ballDiameter, 2);
      expect(b.bbox.min[2]).toBeCloseTo(2.5 - m.ballDiameter / 2, 2);   // centred on the mid plane of the width
    }
    // the centres sit on the pitch circle
    for (const b of balls) {
      const cx = (b.bbox.min[0] + b.bbox.max[0]) / 2, cy = (b.bbox.min[1] + b.bbox.max[1]) / 2;
      expect(Math.hypot(cx, cy)).toBeCloseTo(m.pitchRadius, 1);
    }
  }, 600_000);

  it('an offset origin and a sideways axis build each ball where it sits (no world-axis pattern)', async () => {
    const { run, bodies } = await build(`part('B').bearing({ designation: '608', seal: 'open', origin: [10, 20, 5], axis: [1, 0, 0] });`);
    console.log('BEARING offset', JSON.stringify({ ok: run.ok, ms: run.ms, n: bodies.length }));
    expect(run.ok, JSON.stringify(run.errors)).toBe(true);
    const m = bearingModel(spec({ seal: 'open' }));
    expect(bodies.length).toBe(2 + m.balls);
    // along +X from x = 10 for the width, round about (y, z) = (20, 5)
    const lo = Math.min(...bodies.map((b) => b.bbox.min[0])), hi = Math.max(...bodies.map((b) => b.bbox.max[0]));
    expect(lo).toBeCloseTo(10, 2); expect(hi).toBeCloseTo(17, 2);
    const ring = bodies.find((b) => /outer/.test(b.name))!;
    expect((ring.bbox.min[1] + ring.bbox.max[1]) / 2).toBeCloseTo(20, 2);
    expect((ring.bbox.min[2] + ring.bbox.max[2]) / 2).toBeCloseTo(5, 2);
  }, 600_000);

  it('a bearing along the world Y axis through the origin is patterned', async () => {
    const { run, bodies } = await build(`part('B').bearing({ designation: '608', seal: 'open', axis: [0, 1, 0], origin: [0, 3, 0] });`);
    expect(run.ok, JSON.stringify(run.errors)).toBe(true);
    expect(bodies.length).toBe(2 + bearingModel(spec({ seal: 'open' })).balls);
  }, 600_000);
});

describe('bearing(): the housing seat', () => {
  const plate = `const p = part('Housing'); p.sketch('front', (s) => s.rect(40, 40)).extrude(10);\n`;
  for (const fit of ['h7', 'print', 'press'] as const) {
    it(`seat fit ${fit}: the pocket for a 608 is cut first, the bearing sits in it as separate bodies`, async () => {
      const { run, bodies } = await build(plate + `p.bearing({ designation: '608', seal: '2Z', origin: [0, 0, 10], axis: [0, 0, -1], seat: { fit: '${fit}' } });`);
      console.log('BEARING seat', fit, JSON.stringify({ ok: run.ok, ms: run.ms, bodies: bodies.map((b) => [b.name, +b.volume.toFixed(2)]) }));
      expect(run.ok, JSON.stringify(run.errors)).toBe(true);
      expect(bodies.length).toBe(3);
      const seat = housingSeat({ od: 22, width: 7, fit });
      const housing = bodies.find((b) => b.name === 'Housing' || !/Bearing/.test(b.name))!;
      near(housing.volume, 40 * 40 * 10 - (Math.PI / 4) * seat.diameter ** 2 * 7, 0.002);
      const outer = bodies.find((b) => /outer/.test(b.name))!;
      expect(outer.bbox.min[2]).toBeCloseTo(3, 2); expect(outer.bbox.max[2]).toBeCloseTo(10, 2);   // flush with the housing face, 7 deep
    }, 600_000);
  }
  it('seat: true is the H7 pocket', async () => {
    const { run, bodies } = await build(plate + `p.bearing({ designation: '608', origin: [0, 0, 10], axis: [0, 0, -1], seat: true });`);
    expect(run.ok, JSON.stringify(run.errors)).toBe(true);
    const housing = bodies.find((b) => !/Bearing/.test(b.name))!;
    near(housing.volume, 40 * 40 * 10 - (Math.PI / 4) * housingSeat({ od: 22, width: 7 }).diameter ** 2 * 7, 0.002);
  }, 600_000);
  it('refuses an unknown fit', async () => {
    const run = (await call('run_script', { code: plate + `p.bearing({ designation: '608', seat: { fit: 'loose' } });`, mode: 'new' })).json;
    expect(run.ok).toBe(false);
    expect(JSON.stringify(run.errors)).toMatch(/seat.fit must be one of/);
  }, 120_000);
});

describe('bearing(): the free function, several bearings and errors', () => {
  it('bearing() as a free function and two bearings in one part make separate bodies', async () => {
    const { run, bodies } = await build(`bearing({ designation: '625', seal: '2Z' });\nbearing({ designation: '608-2RS', origin: [40, 0, 0] });`);
    expect(run.ok, JSON.stringify(run.errors)).toBe(true);
    expect(bodies.length).toBe(4);
    expect(bodies.map((b) => b.name).sort()).toEqual(['Bearing 608 inner ring', 'Bearing 608 outer ring', 'Bearing 625 inner ring', 'Bearing 625 outer ring']);
  }, 600_000);

  it('a seal suffix in the designation sets the seal; seal overrides it', async () => {
    const a1 = await build(`part('B').bearing({ designation: '608-2RS' });`);
    const a2 = await build(`part('B').bearing({ designation: '608', seal: '2RS' });`);
    const a3 = await build(`part('B').bearing({ designation: '608-2RS', seal: '2Z' });`);
    expect(a1.run.ok && a2.run.ok && a3.run.ok).toBe(true);
    const vol = (r: { bodies: Body[] }) => r.bodies.reduce((s, b) => s + b.volume, 0);
    near(vol(a1), vol(a2), 1e-6);
    expect(Math.abs(vol(a3) - vol(a1))).toBeGreaterThan(0.1);
  }, 600_000);

  const bad: Array<[string, string, RegExp]> = [
    ['unknown designation', `part('B').bearing({ designation: '9999' });`, /unknown designation/],
    ['no size at all', `part('B').bearing({ seal: '2Z' });`, /give bore/],
    ['bore larger than od', `part('B').bearing({ bore: 30, od: 20, width: 5 });`, /smaller than the outer diameter/],
    ['unknown seal', `part('B').bearing({ designation: '608', seal: 'felt' });`, /seal must be one of/],
    ['balls with a shield', `part('B').bearing({ designation: '608', seal: '2Z', balls: 7 });`, /open bearing only/],
    ['too many balls', `part('B').bearing({ designation: '608', seal: 'open', balls: 20 });`, /do not fit/],
    ['zero axis', `part('B').bearing({ designation: '608', axis: [0, 0, 0] });`, /non-zero/],
  ];
  for (const [what, code, msg] of bad) {
    it(`refuses ${what} with a plain message`, async () => {
      const run = (await call('run_script', { code, mode: 'new' })).json;
      expect(run.ok).toBe(false);
      expect(JSON.stringify(run.errors)).toMatch(msg);
      expect(JSON.stringify(run.errors)).toMatch(/bearing\(\)/);
    }, 120_000);
  }
});

describe('bearing(): flanged F625', () => {
  it('builds valid, the outer ring is as wide as the flange and its volume matches the revolved profile', async () => {
    const { run, bodies } = await build(`part('B').bearing({ designation: 'F625', seal: '2Z' });`);
    expect(run.ok, JSON.stringify(run.errors)).toBe(true);
    expect(bodies.length).toBe(2);
    const outer = bodies.find((b) => /outer/.test(b.name))!;
    near(outer.bbox.size[0], 18, 0.001);   // flange D1 across the ring's axis directions (z is the bearing axis)
    near(outer.bbox.size[2], 5, 0.001);
    const m = bearingModel(spec({ bore: 5, od: 16, width: 5, seal: '2Z', flange: { diameter: 18, thickness: 1 } }));
    near(outer.volume, revolved(outerRingProfile(m, 2000)), 0.002);
  });
});
