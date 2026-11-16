import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, trayGeometry, type ScriptHost } from './index';

// gridTray(): a block with a scooped cavity along its length. Volumes are worked out by hand from the cross-section: width x height less the cavity (inside width x depth less the two
// scoop corners, (1 - pi/4) r2 each) times the length. With sharp plan corners (cornerRadius 0) the kernel must agree to a few mm3; the default rounded corners must lose no more than the four corner pieces (4 - pi) c2 x height.

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function run(code: string) {
  const store = createStore();
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
  };
  const r = await runScript(code, h);
  const ok = r.errors.length === 0;
  const s = sessions.at(-1)!;
  const m = ok ? ((await s.massProps({ bodies: true })) as { volume: number; bodies?: Array<{ name?: string; volume: number }> }) : null;
  const valid = ok ? (((await s.validate().catch(() => ({ ok: false }))) as { ok: boolean }).ok) : false;
    const vol = (name: string) => m?.bodies?.find((b) => b.name === name)?.volume ?? NaN;
  return { r, total: m?.volume ?? NaN, bodies: m?.bodies ?? [], vol, valid };
}
const T = 300000;
/** hand volume of a tray: block less cavity (inside width x depth less two scoop corners) over the length that is open */
function estimate(w: number, l: number, h: number, wall: number, floor: number, r: number, along: number) {
  const section = (w - 2 * wall) * (h - floor) - 2 * (1 - Math.PI / 4) * r * r;
  return w * l * h - section * along;
}

describe('gridTray() in the kernel', () => {
  it('a 1 x 4 x 4 open tray with sharp corners: 41.5 x 167.5 x 28 less the scooped cavity, one valid body', async () => {
    const o = await run('gridTray({ widthUnits: 1, lengthUnits: 4, heightUnits: 4, cornerRadius: 0 });');
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.bodies.length).toBe(1);
    expect(o.vol('Tray')).toBeCloseTo(estimate(41.5, 167.5, 28, 1.2, 1.2, 8, 167.5), 0);
  }, T);

  it('the default rounded corners take away material, at most the four corner pieces over the whole height', async () => {
    const o = await run('gridTray({ widthUnits: 1, lengthUnits: 4, heightUnits: 4 });');
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    const lost = estimate(41.5, 167.5, 28, 1.2, 1.2, 8, 167.5) - o.vol('Tray');   // the rounded body is lighter than the sharp one by the corners the cavity does not already take
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThanOrEqual((4 - Math.PI) * 3.75 ** 2 * 28 + 1e-6);
  }, T);

  it('endWalls both makes a bin: the cavity is two walls shorter', async () => {
    const o = await run("gridTray({ widthUnits: 1, lengthUnits: 2, heightUnits: 3, cornerRadius: 0, endWalls: 'both', scoopRadius: 4 });");
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.vol('Tray')).toBeCloseTo(estimate(41.5, 83.5, 21, 1.2, 1.2, 4, 83.5 - 2.4), 0);
  }, T);

  it('one end wall closes only that end', async () => {
    const both = await run("gridTray({ widthUnits: 1, lengthUnits: 2, heightUnits: 3, cornerRadius: 0, endWalls: 'front' });");
    expect(both.vol('Tray')).toBeCloseTo(estimate(41.5, 83.5, 21, 1.2, 1.2, 8, 83.5 - 1.2), 0);
  }, T);

  it('a scoop radius of 0 is a square cavity', async () => {
    const o = await run('gridTray({ widthUnits: 1, lengthUnits: 2, heightUnits: 3, cornerRadius: 0, scoopRadius: 0 });');
    expect(o.r.errors).toEqual([]);
    expect(o.vol('Tray')).toBeCloseTo(estimate(41.5, 83.5, 21, 1.2, 1.2, 0, 83.5), 0);
  }, T);

  it('magnets cut four holes per whole unit: 6 x 2 mm each, one valid body', async () => {
    const plain = await run('gridTray({ widthUnits: 1, lengthUnits: 2, heightUnits: 3, cornerRadius: 0, floor: 3 });');
    const mag = await run('gridTray({ widthUnits: 1, lengthUnits: 2, heightUnits: 3, cornerRadius: 0, floor: 3, magnets: true });');
    expect(mag.r.errors).toEqual([]);
    expect(mag.valid).toBe(true);
    expect(plain.vol('Tray') - mag.vol('Tray')).toBeCloseTo(8 * Math.PI * 9 * 2, 1);   // 2 units x 4 holes
  }, T);

  it('a half unit has no magnets of its own', async () => {
    const mag = await run('gridTray({ widthUnits: 1.5, lengthUnits: 2, heightUnits: 3, cornerRadius: 0, floor: 3, magnets: true });');
    const plain = await run('gridTray({ widthUnits: 1.5, lengthUnits: 2, heightUnits: 3, cornerRadius: 0, floor: 3 });');
    expect(plain.vol('Tray') - mag.vol('Tray')).toBeCloseTo(8 * Math.PI * 9 * 2, 1);   // one whole unit across x
  }, T);

  it('two trays in one part stay separate bodies', async () => {
    const o = await run("gridTray({ widthUnits: 1, lengthUnits: 2, heightUnits: 3, name: 'A' }); gridTray({ widthUnits: 2, lengthUnits: 2, heightUnits: 3, name: 'B', origin: [100, 0, 0] });");
    expect(o.r.errors).toEqual([]);
    expect(o.bodies.map((b) => b.name).sort()).toEqual(['A', 'B']);
  }, T);

  it('refuses a scoop that does not fit, with the reason', async () => {
    const o = await run('gridTray({ widthUnits: 1, lengthUnits: 2, heightUnits: 1, scoopRadius: 15 });');
    expect(o.r.errors.length).toBeGreaterThan(0);
  }, T);

  it('with the Gridfinity foot: one valid body, 4.75 mm of foot narrowed to 35.6 mm at the bottom, volume as worked out', async () => {
    const o = await run('gridTray({ widthUnits: 1, lengthUnits: 2, heightUnits: 3, foot: true });');
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.bodies.length).toBe(1);
    const g = trayGeometry({ widthUnits: 1, lengthUnits: 2, heightUnits: 3, foot: true });
    // the estimate leaves the rounded corners out: the real part is lighter by no more than the corners over the height
    const gap = g.volume - o.vol('Tray');
    expect(gap).toBeGreaterThan(-1);
    expect(gap).toBeLessThanOrEqual(2 * (4 - Math.PI) * 3.75 ** 2 * 21 + 1);
  }, T);

  it('feet on a 2 x 1.5 grid (a half cell too) stay one valid body and the bounding box stands on z = 0', async () => {
    const o = await run("gridTray({ widthUnits: 2, lengthUnits: 1.5, heightUnits: 3, foot: true, magnets: true });");
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.bodies.length).toBe(1);
  }, T);

  it('a 2 x 2 baseplate: one valid body, 84 x 84 x 5.95, the pockets take out about the foot volume', async () => {
    const o = await run('gridBaseplate({ widthUnits: 2, lengthUnits: 2 });');
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.bodies.length).toBe(1);
    const solid = 84 * 84 * 5.95;
    const pockets = solid - o.vol('Baseplate');
    // four pockets of about the foot (41.7 mm top, 4.75 deep, 35.8 at the bottom): between a 35.8 and a 41.7 mm prism
    expect(pockets).toBeGreaterThan(4 * 35.8 * 35.8 * 4.75 * 0.97);
    expect(pockets).toBeLessThan(4 * 41.7 * 41.7 * 4.75);
  }, T);

  it('a bin foot seats in the baseplate: the bin and the plate do not overlap when the bin stands in a pocket', async () => {
    const o = await run(`gridBaseplate({ widthUnits: 1, lengthUnits: 1, name: 'Plate' });
gridTray({ widthUnits: 1, lengthUnits: 1, heightUnits: 3, foot: true, origin: [0, 0, 1.3], name: 'Bin' });`);
    expect(o.r.errors).toEqual([]);
    expect(o.bodies.length).toBe(2);
    expect(o.valid).toBe(true);
    // the plate pocket is 0.1 mm bigger all round than the foot: the two solids touch nowhere, so the bodies together weigh the same as apart
    expect(o.total).toBeCloseTo(o.vol('Plate') + o.vol('Bin'), 3);
  }, T);

  it('a plate bigger than the bed is split into equal pieces that each fit it: 11 x 7 units on 256 mm is 2 x 2 pieces, one valid body each', async () => {
    const o = await run("gridBaseplate({ widthUnits: 11, lengthUnits: 4, bed: 256 });");
    expect(o.r.errors).toEqual([]);
    expect(o.valid).toBe(true);
    expect(o.bodies.length).toBe(2);              // 11 units = 5.5 + 5.5 across; 4 units fit along
    for (const b of o.bodies) expect(b.volume).toBeGreaterThan(0);
  }, 600000);
});
