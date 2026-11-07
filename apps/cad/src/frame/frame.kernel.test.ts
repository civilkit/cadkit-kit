// The Frame tool against the real kernel through the Controller: a mitred SHS rectangle and a butted T-slot one from a sketch of
// four lines, the cut list read back from the regen reply, an edit of the skeleton followed by the frame, undo.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { bom, cutList, frameFeature, frameOps, readFrames } from './frameLib';
import { drawingPdf, frameDrawing } from './frameDrawing';

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
    const feat = frameFeature('F2', { sketch: 'F1', segments: null, profile: 'shs-40x40x2', corner: 'mitre', rotate: 0 })!;
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

  it('butts a T-slot rectangle and lists brackets, nuts and bolts per joint', async () => {
    const c = await world();
    const feat = frameFeature('F2', { sketch: 'F1', segments: null, profile: 'tslot-2020', corner: 'butt', rotate: 0 })!;
    const r = await c.commit(frameOps(feat, false) as never, 'frame');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const frames = readFrames(await c.frameReports());
    expect(frames[0].members.map((m) => m.length)).toEqual([620, 400, 600, 380]);   // 20 mm stock: +10 where a member runs through, -10 where it butts
    const b = bom(frames);
    expect(b.find((x) => x.id === 'bracket-20')?.qty).toBe(4);
    expect(b.find((x) => x.id === 'tnut-m5-20')?.qty).toBe(8);
  }, 300000);

  it('makes the PDF sheet from the real views: balloons carry the cut-list row numbers, the pdf holds the tables', async () => {
    const c = await world();
    const feat = frameFeature('F2', { sketch: 'F1', segments: null, profile: 'shs-40x40x2', corner: 'mitre', rotate: 0 })!;
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
