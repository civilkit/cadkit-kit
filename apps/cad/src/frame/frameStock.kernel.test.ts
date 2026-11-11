// The regional stock against the real kernel: one profile of each family builds a frame whose members weigh what the catalogue says,
// open sections mitre, butt and tee, hollow sections take their default hardware, and the bill of materials gives standard, grade and mass.
// FRAME_ALL=1 builds every profile of the library (a few minutes), for when the data changes.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { DEFAULT_FRAME, PROFILES, bom, cutList, defaultHardware, frameFeature, frameOps, loadAllRegions, profileById, profileMaterial, readFrames, toCsv, type FrameParams } from './frameLib';
import { massTolerance } from './massTolerance';

beforeAll(async () => { await loadAllRegions(); });
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const params = (p: Partial<FrameParams>): FrameParams => ({ ...DEFAULT_FRAME, sketch: 'F1', hardware: { joint: null, corner3: null, cap: null, foot: null }, joints: [], teeBoth: false, drill: false, ...p });

const SKETCH = (w: number, h: number, extra = false) => ({ type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: w, y: 0 }, { id: 'p3', x: w, y: h }, { id: 'p4', x: 0, y: h }, ...(extra ? [{ id: 'p5', x: w / 2, y: 0 }, { id: 'p6', x: w / 2, y: h }] : [])],
  entities: [{ type: 'line', id: 'e1', p1: 'p1', p2: 'p2' }, { type: 'line', id: 'e2', p1: 'p2', p2: 'p3' }, { type: 'line', id: 'e3', p1: 'p3', p2: 'p4' }, { type: 'line', id: 'e4', p1: 'p4', p2: 'p1' }, ...(extra ? [{ type: 'line', id: 'e5', p1: 'p5', p2: 'p6' }] : [])],
  constraints: [] });

async function world(w = 1500, h = 1000, extra = false) {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(emptyPart('Frame') as unknown as PartDoc);
  await controller.edit([{ op: 'add', feature: SKETCH(w, h, extra) }] as never);
  return controller;
}

/** kg per mm3 of the profile's material: the catalogue grade where it has one (Inspect's density), else the frame library's. */
const density = (p: NonNullable<ReturnType<typeof profileById>>): number => (profileMaterial(p)?.density ?? 7850) * 1e-9;

/** Each member's modelled mass against its catalogue mass over the same stock length (butt corners at right angles cut every member square). */
function massMatches(frames: ReturnType<typeof readFrames>, id: string): void {
  const p = profileById(id)!;
  for (const m of frames[0].members) {
    expect(m.angles, `${id} ${m.segment}`).toEqual([0, 0]);
    const modelled = m.volume * density(p), published = p.mass_per_m_kg! * m.length / 1000;
    expect(Math.abs(modelled / published - 1), `${id} ${m.segment}: modelled ${modelled.toFixed(3)} kg vs catalogue ${published.toFixed(3)} kg`).toBeLessThan(massTolerance(id));
  }
}

const ONE_PER_FAMILY = [
  'au-shs-50x50x3-c350l0', 'au-rhs-100x50x4-c450l0', 'au-chs-88.9x3.2-c350l0', 'au-ub-310ub40.4', 'au-uc-200uc46.2', 'au-ubp-310ubp110', 'au-pfc-230',
  'au-ea-75x75x6', 'au-ua-150x100x12', 'au-fl-50x6', 'au-rd-12', 'us-hss-4x4x0.250', 'us-hss-6x4x0.250', 'us-hss-2.375x0.250',
];
// the United States and Europe: one of every family (open families build with the ibeam / channel / angle outlines; the catalogue mass is checked against the model)
const US_FAMILIES = ['us-w14x233', 'us-w6x9', 'us-s10x25.4', 'us-c6x8.2', 'us-mc8x20', 'us-l3-1-2x3-1-2x7-16', 'us-l8x4x1', 'us-pipe3xs', 'us-pipe4std', 'us-hss-5x5x0.313', 'us-hss-6x5x0.313', 'us-hss-5x0.125'];
const EU_FAMILIES = ['eu-ipe200', 'eu-ipea200', 'eu-ipeo270', 'eu-ipeaa160', 'eu-hea260', 'eu-heb260', 'eu-hem260', 'eu-heaa260', 'eu-ipn220', 'eu-upn160',
  'eu-en10210-shs40x40x3', 'eu-en10210-rhs220x120x6.3', 'eu-en10210-chs168.3x5', 'eu-en10219-shs25x25x2', 'eu-en10219-rhs50x25x2', 'eu-en10219-chs33.7x3'];

describe('regional stock against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it.each([...ONE_PER_FAMILY, ...US_FAMILIES, ...EU_FAMILIES])('%s builds a butted frame that weighs what the catalogue says', async (id) => {
    expect(profileById(id), id).toBeTruthy();
    const c = await world();
    const feat = frameFeature('F2', params({ profile: id, corner: 'butt', hardware: defaultHardware(id) }))!;
    const r = await c.commit(frameOps(feat, false) as never, 'frame');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const frames = readFrames(await c.frameReports());
    expect(frames[0].members).toHaveLength(4);
    massMatches(frames, id);
    // the cut list's mass is the catalogue's; the BOM line carries standard, grade and the total
    const p = profileById(id)!;
    const stock = bom(frames).find((b) => b.kind === 'stock')!;
    expect(stock).toMatchObject({ id, qty: 4, standard: p.standard, grade: p.grade });
    expect(stock.massKg).toBeCloseTo(p.mass_per_m_kg! * frames[0].members.reduce((s, m) => s + m.length, 0) / 1000, 2);
    expect(cutList(frames).reduce((s, l) => s + l.massKg, 0)).toBeCloseTo(stock.massKg!, 2);
    expect(toCsv(frames)).toContain(`,${p.standard},${p.grade},`);
  }, 120000);

  it.each(['au-ub-310ub40.4', 'au-pfc-230', 'au-ea-75x75x6', 'au-uc-200uc46.2', 'au-shs-50x50x3-c350l0', 'us-w14x233', 'us-c6x8.2', 'us-l3-1-2x3-1-2x7-16', 'eu-ipe200', 'eu-hea260', 'eu-upn160', 'eu-en10210-shs40x40x3'])('%s: mitred rectangle and a tee, joints and welds counted', async (id) => {
    const c = await world(1500, 1000, true);
    const mit = frameFeature('F2', params({ profile: id, corner: 'mitre', segments: ['e1', 'e2', 'e3', 'e4'] }))!;
    const r = await c.commit(frameOps(mit, false) as never, 'frame');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    let frames = readFrames(await c.frameReports());
    expect(frames[0].members.map((m) => m.angles)).toEqual([[45, 45], [45, 45], [45, 45], [45, 45]]);
    expect(frames[0].members.every((m) => m.ends[0] === 'mitre' && m.ends[1] === 'mitre')).toBe(true);
    expect(bom(frames).find((b) => b.id === 'weld')?.qty).toBe(4);
    expect(frames[0].hardware).toBeUndefined();   // nothing chosen: no hardware, whatever the section
    expect(((await c.massProps() as { bodies?: unknown[] }).bodies ?? [])).toHaveLength(4);
    // butted with a tee in the middle
    const butt = frameFeature('F2', params({ profile: id, corner: 'butt' }))!;
    expect((await c.commit(frameOps(butt, true) as never, 'frame')).ok).toBe(true);
    frames = readFrames(await c.frameReports());
    expect(frames[0].members).toHaveLength(5);
    expect(frames[0].members.find((m) => m.segment === 'e5')!.ends).toEqual(['tee', 'tee']);
    expect(bom(frames).find((b) => b.id === 'weld')?.qty).toBe(6);   // four corners and the two ends of the tee
    massMatches(frames, id);
  }, 120000);

  it('hollow sections take their default hardware: gussets, plugs, a bracket and feet where they fit', async () => {
    for (const id of ['au-shs-50x50x3-c350l0', 'au-rhs-100x50x4-c450l0', 'au-chs-88.9x3.2-c350l0', 'us-hss-4x4x0.250', 'us-hss-6x4x0.250', 'us-hss-2.375x0.250', 'us-pipe3xs', 'eu-en10210-shs40x40x3', 'eu-en10219-rhs50x25x2', 'eu-en10219-chs33.7x3']) {
      const c = await world(1500, 1000);
      const hw = defaultHardware(id);
      const gusset = frameFeature('F2', params({ profile: id, corner: 'mitre', hardware: hw }))!;
      const r = await c.commit(frameOps(gusset, false) as never, 'frame');
      expect(r.ok, `${id}: ${JSON.stringify(r)}`).toBe(true);
      const b = bom(readFrames(await c.frameReports()));
      expect(b.find((x) => x.id === hw.joint)?.qty, id).toBe(4);
      const prof = profileById(id)!;
      if (prof.hardware?.joint?.[1]) {   // the tube bracket where one is offered
        const br = frameFeature('F2', params({ profile: id, corner: 'mitre', hardware: { ...hw, joint: prof.hardware.joint[1] } }))!;
        const rb = await c.commit(frameOps(br, true) as never, 'frame');
        expect(rb.ok, `${id} bracket: ${JSON.stringify(rb)}`).toBe(true);
      }
    }
  }, 300000);

  it('every profile of the library builds with its default hardware (only with FRAME_ALL=1)', async () => {
    if (!process.env.FRAME_ALL) return;
    const failed: string[] = [];
    let built = 0;
    for (const p of PROFILES) {
      await Promise.all(sessions.splice(0).map((x) => x.close().catch(() => {})));   // one kernel session at a time: thousands of open ones exhaust the worker's memory
      const c = await world(1200, 900);
      for (const corner of ['mitre', 'butt'] as const) {
        const f = frameFeature('F2', params({ profile: p.id, corner, hardware: defaultHardware(p.id) }))!;
        const r = await c.commit(frameOps(f, corner === 'butt') as never, 'frame');
        if (!r.ok) { failed.push(`${p.id} ${corner}: ${JSON.stringify((r as { errors?: unknown }).errors)}`); break; }
        built++;
        if (p.mass_per_m_kg && corner === 'butt') {
          const fr = readFrames(await c.frameReports());
          for (const m of fr[0].members) {
            const dev = Math.abs(m.volume * density(p) / (p.mass_per_m_kg * m.length / 1000) - 1);
            if (dev > massTolerance(p.id)) failed.push(`${p.id}: mass off by ${(dev * 100).toFixed(1)} %`);
          }
        }
      }
    }
    expect(failed).toEqual([]);
    expect(built).toBe(PROFILES.length * 2);
  }, 3600000);
});
