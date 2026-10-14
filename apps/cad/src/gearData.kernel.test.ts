// Gears against the real kernel: valid solids, tooth count, volume against the profile's area, one undo step, regeneration keeps ids,
// the parameters survive on the feature, a meshing pair sits at the centre distance and its bodies stay apart.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { DEFAULT_GEAR, defaultPair, gearGeom, gearOps, mateParams, outline, readGear, type GearParams } from './gearData';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

/** Area enclosed by the outline (the flanks as polylines through their points), mm2. */
function area(p: GearParams): number {
  const o = outline(p);
  const P = Object.fromEntries(o.points.map((q) => [q.id, q]));
  const loop: Array<[number, number]> = [];
  const ents = o.entities;
  if (p.type === 'rack') for (const e of ents) loop.push([P[e.p1 as string].x, P[e.p1 as string].y]);
  else for (const e of ents) {
    if (e.type === 'spline') for (const id of e.pts as string[]) loop.push([P[id].x, P[id].y]);
    else { const c = P[e.c as string], a = P[e.p1 as string], b = P[e.p2 as string]; const r = Math.hypot(a.x - c.x, a.y - c.y); const a0 = Math.atan2(a.y - c.y, a.x - c.x); let a1 = Math.atan2(b.y - c.y, b.x - c.x); while (a1 < a0) a1 += 2 * Math.PI; for (let i = 0; i <= 12; i++) loop.push([c.x + r * Math.cos(a0 + ((a1 - a0) * i) / 12), c.y + r * Math.sin(a0 + ((a1 - a0) * i) / 12)]); }
  }
  let A = 0;
  for (let i = 0; i < loop.length; i++) { const [x0, y0] = loop[i], [x1, y1] = loop[(i + 1) % loop.length]; A += x0 * y1 - x1 * y0; }
  return Math.abs(A) / 2;
}

async function build(p: GearParams) {
  const s = await Session.open(emptyPart('G') as unknown as PartDoc); sessions.push(s);
  const t0 = Date.now();
  const r = await s.edit(gearOps(s.document as never, p), 'gear');
  const ms = Date.now() - t0;
  const rep = await s.verify();
  const mass = await s.massProps({ bodies: true });
  const facts = await s.facts();
  return { s, r, ms, rep, mass, vol: mass.volume as number, faces: facts.faces as string[] };
}
const near = (a: number, b: number, rel: number): void => { expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(rel); };
const bore = (p: GearParams): number => (p.boreDia > 0 ? Math.PI * (p.boreDia / 2) ** 2 * p.faceWidth : 0);

describe('gears against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('spur 20T module 2: valid, 20 teeth, volume matches the profile, parameters kept on the sketch', async () => {
    const p = { ...DEFAULT_GEAR };
    const b = await build(p);
    expect(b.r.ok).toBe(true);
    expect(b.rep.regen.errors).toEqual([]);
    expect(b.rep.validate?.ok).toBe(true);
    // one tip face and one flank/root face per tooth, the bore, two caps
    const sides = b.faces.filter((f) => f.startsWith('F2.S.')).length;
    expect(sides).toBe(2 * 20);
    expect(b.faces.filter((f) => f.startsWith('F2.C')).length).toBe(2);
    near(b.vol, area(p) * p.faceWidth - bore(p), 0.003);
    // analytic estimate: between the root and outside circles
    const g = gearGeom(p);
    expect(b.vol).toBeGreaterThan(Math.PI * g.rf ** 2 * 10 - bore(p));
    expect(b.vol).toBeLessThan(Math.PI * g.ra ** 2 * 10 - bore(p));
    const rec = readGear(b.s.document.features[0]);
    expect(rec?.params.teeth).toBe(20);
    expect(rec?.roles.body).toBe('F2');
    expect(b.s.history().length).toBe(1);   // one edit, one undo step
    console.log('GEARTIME spur20', b.ms);
  }, 120000);

  it('regenerating from the record keeps the ids, adds hub and keyway, removes them again, each as one step', async () => {
    const b = await build({ ...DEFAULT_GEAR, teeth: 16 });
    const first = readGear(b.s.document.features[0])!;
    const p2 = { ...first.params, teeth: 18, hubDia: 18, hubLength: 16, keyway: true };
    const r2 = await b.s.edit(gearOps(b.s.document as never, p2, first.roles), 'gear');
    expect(r2.ok).toBe(true);
    const ids = b.s.document.features.map((f) => f.id);
    expect(ids.slice(0, 2)).toEqual(['F1', 'F2']);
    expect(b.s.document.features.length).toBe(8);
    const rec = readGear(b.s.document.features[0])!;
    expect(Object.keys(rec.roles)).toEqual(['profile', 'body', 'hubSketch', 'hub', 'boreSketch', 'bore', 'keySketch', 'key']);
    const rep = await b.s.verify();
    expect(rep.regen.errors).toEqual([]);
    expect(rep.validate?.ok).toBe(true);
    const v = ((await b.s.massProps()).volume) as number;
    expect(v).toBeGreaterThan(0);
    // back to a plain gear: hub and key features removed
    const r3 = await b.s.edit(gearOps(b.s.document as never, { ...p2, hubLength: 0, keyway: false }, rec.roles), 'gear');
    expect(r3.ok).toBe(true);
    expect(b.s.document.features.length).toBe(4);
    expect(b.s.history().length).toBe(3);
    await b.s.undo();
    expect(b.s.document.features.length).toBe(8);
  }, 180000);

  it('helical: a twisted extrude, valid, same volume as the straight gear of the same transverse profile', async () => {
    const p = { ...DEFAULT_GEAR, type: 'helical' as const, helixAngle: 20, faceWidth: 12 };
    const b = await build(p);
    expect(b.r.ok).toBe(true);
    expect(b.rep.validate?.ok).toBe(true);
    expect(b.rep.regen.errors).toEqual([]);
    near(b.vol, area(p) * p.faceWidth - bore(p), 0.006);
    const body = b.s.document.features[1] as unknown as { twist: number };
    expect(body.twist).toBeCloseTo(gearGeom(p).twist, 3);
    expect(Math.abs(body.twist)).toBeGreaterThan(5);
    console.log('GEARTIME helical', b.ms);
  }, 120000);

  it('ring gear: valid, volume = rim disc minus the tooth spaces', async () => {
    const p = { ...DEFAULT_GEAR, type: 'internal' as const, teeth: 36, boreDia: 0, faceWidth: 8 };
    const b = await build(p);
    expect(b.r.ok).toBe(true);
    expect(b.rep.validate?.ok).toBe(true);
    const g = gearGeom(p);
    const rim = g.rf + 2.5 * g.mn;
    near(b.vol, (Math.PI * rim * rim - area(p)) * p.faceWidth, 0.004);
    console.log('GEARTIME ring', b.ms);
  }, 120000);

  it('rack: valid, volume matches the polygon', async () => {
    const p = { ...DEFAULT_GEAR, type: 'rack' as const, teeth: 8, boreDia: 0, faceWidth: 12 };
    const b = await build(p);
    expect(b.r.ok).toBe(true);
    expect(b.rep.validate?.ok).toBe(true);
    near(b.vol, area(p) * p.faceWidth, 0.002);
  }, 120000);

  it('pair 20T / 40T module 2: two bodies at the centre distance (20+40)*2/2 = 60, nothing merged, teeth in phase', async () => {
    const p = defaultPair();
    const b = await build(p);
    expect(b.r.ok).toBe(true);
    expect(b.rep.regen.errors).toEqual([]);
    expect(b.rep.validate?.ok).toBe(true);
    expect(b.mass.bodies?.length).toBe(2);
    const [c1, c2] = b.mass.bodies!.map((x) => x.com);
    expect(Math.hypot(c2[0] - c1[0], c2[1] - c1[1], c2[2] - c1[2])).toBeCloseTo(60, 1);
    const m = mateParams(p);
    expect(m.center[0] - p.center[0]).toBeCloseTo(60, 6);
    // the first gear has a tooth on the line of centres (angle 0): the mate has a gap there (a tooth centre half a pitch away)
    const tau2 = 360 / 40;
    const off = (((m.phase - 180) % tau2) + tau2) % tau2;
    expect(off).toBeCloseTo(tau2 / 2, 6);
    near(b.vol, area(p) * 10 - bore(p) + area(m) * 10 - Math.PI * 25 * 10, 0.004);
    console.log('GEARTIME pair', b.ms);
  }, 180000);

  it('a gear on a profile shift and diametral pitch sizing keeps the module consistent', async () => {
    const p = { ...DEFAULT_GEAR, sizing: 'dp' as const, dp: 12.7, teeth: 14, shift: 0.3 };
    expect(gearGeom(p).mn).toBeCloseTo(2, 6);
    const b = await build(p);
    expect(b.rep.validate?.ok).toBe(true);
    near(b.vol, area(p) * p.faceWidth - bore(p), 0.003);
  }, 120000);
});
