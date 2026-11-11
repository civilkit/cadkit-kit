// The Frame tool against the real kernel through the Controller: a mitred SHS rectangle and a butted T-slot one from a sketch of
// four lines, the cut list read back from the regen reply, an edit of the skeleton followed by the frame, undo.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { DEFAULT_FRAME, bom, cutList, defaultHardware, frameFeature, frameOps, readFrames, type FrameParams } from './frameLib';
import { drawingPdf, frameDrawing } from './frameDrawing';

const none = { joint: null, corner3: null, cap: null, foot: null };
const params = (p: Partial<FrameParams>): FrameParams => ({ ...DEFAULT_FRAME, sketch: 'F1', hardware: none, joints: [], teeBoth: false, drill: false, ...p });
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const RECT = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 600, y: 0 }, { id: 'p3', x: 600, y: 400 }, { id: 'p4', x: 0, y: 400 }],
  entities: [{ type: 'line', id: 'e1', p1: 'p1', p2: 'p2' }, { type: 'line', id: 'e2', p1: 'p2', p2: 'p3' }, { type: 'line', id: 'e3', p1: 'p3', p2: 'p4' }, { type: 'line', id: 'e4', p1: 'p4', p2: 'p1' }],
  constraints: [] };

async function world() {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(emptyPart('Frame') as unknown as PartDoc);
  await controller.edit([{ op: 'add', feature: RECT }] as never);
  return controller;
}

describe('frame tool against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('builds a mitred steel rectangle, reports its cut list, follows the sketch, undoes', async () => {
    const c = await world();
    const feat = frameFeature('F2', params({ profile: 'shs-40x40x2', corner: 'mitre' }))!;
    const pre = await c.preview(frameOps(feat, false) as never, 0);
    expect(pre.ok, JSON.stringify(pre)).toBe(true);
    await c.cancelPreview();
    const r = await c.commit(frameOps(feat, false) as never, 'frame');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const vol = (await c.massProps() as { volume: number }).volume;
    expect(vol).toBeCloseTo(304 * 2000, 1);   // section area x centre-line length
    const frames = readFrames(await c.frameReports());
    expect(cutList(frames).map((l) => [l.length, l.angles, l.qty])).toEqual([[640, [45, 45], 2], [440, [45, 45], 2]]);
    expect(bom(frames).find((b) => b.id === 'weld')?.qty).toBe(4);
    // the skeleton is longer: the frame follows
    await c.edit([{ op: 'set', id: 'F1', path: 'points.1.x', value: 800 }, { op: 'set', id: 'F1', path: 'points.2.x', value: 800 }] as never);
    const after = cutList(readFrames(await c.frameReports()));
    expect(after.map((l) => l.length)).toEqual([840, 440]);
    await c.undo();
    await c.undo();
    expect(c.document()!.features.map((f) => f.type)).toEqual(['sketch']);
  }, 300000);

  it('butts a T-slot rectangle with hardware: brackets, T-nuts and screws placed, and the BOM lists exactly the bodies in the model', async () => {
    const c = await world();
    const feat = frameFeature('F2', params({ profile: 'tslot-2020', corner: 'butt', hardware: defaultHardware('tslot-2020') }))!;
    const r = await c.commit(frameOps(feat, false) as never, 'frame');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const frames = readFrames(await c.frameReports());
    expect(frames[0].members.map((m) => m.length)).toEqual([620, 400, 600, 380]);   // 20 mm stock: +10 where a member runs through, -10 where it butts
    const b = bom(frames);
    const q = (id: string) => b.find((x) => x.id === id)?.qty;
    expect([q('bracket-20'), q('tnut-m5-20'), q('bhcs-m5x8'), q('cap-20')]).toEqual([4, 8, 8, undefined]);
    expect(frames[0].hardware!.joints.map((j) => j.connector)).toEqual(['bracket-20', 'bracket-20', 'bracket-20', 'bracket-20']);
    // the model holds the members and every BOM piece, one body each
    const bodies = ((await c.massProps() as { bodies?: Array<{ name?: string }> }).bodies ?? []).map((x) => x.name ?? '');
    const hardware = b.filter((x) => x.kind === 'fitting').reduce((n, x) => n + x.qty, 0);
    expect(bodies.filter((n) => / H\d+$/.test(n))).toHaveLength(hardware);
    expect(bodies).toHaveLength(4 + hardware);
    const hit = (await c.interference())?.pairs.filter((p) => /\.H\d+\./.test(p.a) || /\.H\d+\./.test(p.b)) ?? [];
    expect(hit, 'hardware overlaps a member or another part').toEqual([]);
    // one joint takes no connector: the BOM follows
    const feat2 = frameFeature('F2', params({ profile: 'tslot-2020', corner: 'butt', hardware: defaultHardware('tslot-2020'), joints: [{ segments: ['e1', 'e2'], connector: 'none' }] }))!;
    expect((await c.commit(frameOps(feat2, true) as never, 'frame')).ok).toBe(true);
    const b2 = bom(readFrames(await c.frameReports()));
    expect([b2.find((x) => x.id === 'bracket-20')?.qty, b2.find((x) => x.id === 'bhcs-m5x8')?.qty]).toEqual([3, 6]);
  }, 300000);

  it('a T-slot post with caps and feet; a steel rectangle with gussets and plugs', async () => {
    const c = await world();
    const feat = frameFeature('F2', params({ profile: 'tslot-3030', corner: 'butt', segments: ['e1'], hardware: defaultHardware('tslot-3030') }))!;
    expect((await c.commit(frameOps(feat, false) as never, 'frame')).ok).toBe(true);
    const b = bom(readFrames(await c.frameReports()));
    expect(b.find((x) => x.id === 'cap-30')?.qty).toBe(2);   // a lone horizontal member: two free ends, no leg to stand
    const steel = frameFeature('F2', params({ profile: 'shs-40x40x2', corner: 'mitre', hardware: defaultHardware('shs-40x40x2') }))!;
    expect((await c.commit(frameOps(steel, true) as never, 'frame')).ok).toBe(true);
    const sb = bom(readFrames(await c.frameReports()));
    expect([sb.find((x) => x.id === 'gusset-3')?.qty, sb.find((x) => x.id === 'weld')?.qty]).toEqual([4, 4]);
  }, 300000);

  it('a 3-way corner block, a tee with a bracket each side, and drilled tube joints: the BOM is the bodies in the model', async () => {
    const c = await world();
    const bodiesOf = async (): Promise<string[]> => ((await c.massProps() as { bodies?: Array<{ name?: string }> }).bodies ?? []).map((x) => x.name ?? '');
    const onLines = (p: Partial<FrameParams>, lines: number[][][]): Record<string, unknown> => {
      const f = frameFeature('F2', params({ corner: 'butt', ...p }))!;
      delete f.sketch;
      return { ...f, lines };
    };
    const noInterference = async (): Promise<void> => {
      const hit = (await c.interference())?.pairs.filter((q) => /\.H\d+\./.test(q.a) || /\.H\d+\./.test(q.b)) ?? [];
      expect(hit, 'hardware overlaps a member or another part').toEqual([]);
    };
    // three T-slot members at right angles: one block, three screws and nuts, a cap per free end; no brackets
    const corner = onLines({ profile: 'tslot-3030', hardware: defaultHardware('tslot-3030') }, [[[0, 0, 0], [300, 0, 0]], [[0, 0, 0], [0, 300, 0]], [[0, 0, 0], [0, 0, 300]]]);
    const r1 = await c.commit([{ op: 'add', feature: corner }] as never, 'frame');
    expect(r1.ok, JSON.stringify(r1)).toBe(true);
    const b1 = bom(readFrames(await c.frameReports()));
    const q1 = (id: string) => b1.find((x) => x.id === id)?.qty;
    expect([q1('corner3-30'), q1('bracket-30'), q1('tnut-m6-30'), q1('bhcs-m6x10'), q1('cap-30')]).toEqual([1, undefined, 3, 3, 3]);
    const n1 = (await bodiesOf()).length;
    expect(n1).toBe(3 + b1.filter((x) => x.kind === 'fitting').reduce((n, x) => n + x.qty, 0));
    await noInterference();
    await c.undo();
    // a tee with a bracket on each side
    const tee = onLines({ profile: 'tslot-3030', hardware: { ...defaultHardware('tslot-3030'), cap: null, foot: null }, teeBoth: true }, [[[0, 0, 0], [600, 0, 0]], [[300, 0, 0], [300, 400, 0]]]);
    expect((await c.commit([{ op: 'add', feature: tee }] as never, 'frame')).ok).toBe(true);
    const b2 = bom(readFrames(await c.frameReports()));
    expect([b2.find((x) => x.id === 'bracket-30')?.qty, b2.find((x) => x.id === 'bhcs-m6x10')?.qty]).toEqual([2, 4]);
    expect((await bodiesOf()).length).toBe(2 + b2.filter((x) => x.kind === 'fitting').reduce((n, x) => n + x.qty, 0));
    await noInterference();
    await c.undo();
    // a steel rectangle with tube brackets, drilled and bolted: holes in every member, bolts sized to the tube
    const drilled = frameFeature('F2', params({ profile: 'shs-40x40x2', corner: 'mitre', hardware: { ...defaultHardware('shs-40x40x2'), joint: 'bracket-tube-40' }, drill: true }))!;
    const r3 = await c.commit([{ op: 'add', feature: drilled }] as never, 'frame');
    expect(r3.ok, JSON.stringify(r3)).toBe(true);
    const fr3 = readFrames(await c.frameReports());
    expect(fr3[0].members.map((m) => m.holes)).toEqual([2, 2, 2, 2]);
    const b3 = bom(fr3);
    expect([b3.find((x) => x.id === 'bracket-tube-40')?.qty, b3.find((x) => x.id === 'hex-m6x50')?.qty, b3.find((x) => x.id === 'nut-m6')?.qty]).toEqual([4, 8, 8]);
    await noInterference();
  }, 300000);

  it('makes the PDF sheet from the real views: balloons carry the cut-list row numbers, the pdf holds the tables', async () => {
    const c = await world();
    const feat = frameFeature('F2', params({ profile: 'shs-40x40x2', corner: 'mitre' }))!;
    expect((await c.commit(frameOps(feat, false) as never, 'frame')).ok).toBe(true);
    const frames = readFrames(await c.frameReports());
    const sh = await frameDrawing(frames, c.drawingQuery(), { name: 'Rect', date: '2026-11-07' });
    expect(Object.keys(sh.data)).toHaveLength(3);
    const rows = cutList(frames);
    for (const v of sh.doc.views) {
      const bs = sh.doc.balloons.filter((b) => b.view === v.id);
      expect(bs.length, v.label).toBeGreaterThan(0);
      for (const b of bs) expect(b.n).toBeGreaterThanOrEqual(1), expect(b.n).toBeLessThanOrEqual(rows.length);
    }
    // the iso view shows every piece: one balloon per member, each row as often as its quantity
    const iso = sh.doc.balloons.filter((b) => b.view === 'V1');
    expect(iso.map((b) => b.n).sort()).toEqual(rows.flatMap((r, i) => Array(r.qty).fill(i + 1)).sort());
    const txt = Array.from(drawingPdf(sh.doc, sh.data).pdf, (b) => String.fromCharCode(b)).join('');
    expect(txt.startsWith('%PDF-1.4')).toBe(true);
    for (const w of ['(Rect)', '(Cut list)', '(Bill of materials)', '(640)', '(440)', '(45 / 45)']) expect(txt).toContain(w);
    if (process.env.FRAME_SHEET_OUT) (await import('node:fs')).writeFileSync(process.env.FRAME_SHEET_OUT, drawingPdf(sh.doc, sh.data).svg);
  }, 300000);
});
