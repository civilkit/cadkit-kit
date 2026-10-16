import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import type { Ctx } from './featureCommands';
import { loftMoveAfter, loftOps, loftProfileIds, orderPointSections } from './featureCreators';

type Wire = Record<string, unknown>;
const plane = (id: string, offset: number): Wire => ({ type: 'plane', id, mode: 'offset', base: { kind: 'std', id: 'right' }, offset, name: 'x', autoName: true });
const circle = (id: string, pl: string): Wire => ({ type: 'sketch', id, plane: { kind: 'feature', id: pl }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [{ id: 'e1', type: 'circle', c: 'O', r: 5 }], constraints: [] });
const dot = (id: string, pl: string): Wire => ({ type: 'sketch', id, plane: { kind: 'feature', id: pl }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0.5 }], entities: [{ id: 'e1', type: 'point', p: 'p1' }], constraints: [] });
const partOf = (features: Wire[]): PartDoc => ({ ...emptyPart('Hull'), features, seq: features.length + 1 }) as unknown as PartDoc;
const ctx = (features: Wire[], extra: Partial<Ctx> = {}): Ctx => ({ doc: partOf(features), selection: [], mode: 'body', box: null, edges: [], ...extra }) as Ctx;

describe('point sections go to the ends of a loft', () => {
  // planes at x = 0, 20, 40 hold circles; a point sits where the test puts it
  const base = [plane('P1', 0), circle('S1', 'P1'), plane('P2', 20), circle('S2', 'P2'), plane('P3', 40), circle('S3', 'P3')];
  it('a point beyond the last plane drawn in the middle of the tree order goes last', () => {
    const f = [...base.slice(0, 4), plane('P9', 60), dot('S9', 'P9'), ...base.slice(4)];
    expect(loftProfileIds(ctx(f))).toEqual(['S1', 'S2', 'S3', 'S9']);
  });
  it('a point before the first plane goes first', () => {
    const f = [...base, plane('P9', -30), dot('S9', 'P9')];
    expect(loftProfileIds(ctx(f))).toEqual(['S9', 'S1', 'S2', 'S3']);
  });
  it('a selection with the point in the middle is reordered; two points go to opposite ends', () => {
    const f = [...base, plane('P9', 60), dot('S9', 'P9'), plane('P8', -30), dot('S8', 'P8')];
    expect(orderPointSections(ctx(f), ['S1', 'S9', 'S2', 'S3'])).toEqual(['S1', 'S2', 'S3', 'S9']);
    expect(orderPointSections(ctx(f), ['S9', 'S2', 'S8', 'S1'])).toEqual(['S9', 'S2', 'S1', 'S8']);   // the sections run downhill, so the high point starts the loft
  });
  it('a descending section order keeps its direction: the point past the last section goes last', () => {
    const f = [...base, plane('P9', -30), dot('S9', 'P9')];
    expect(orderPointSections(ctx(f), ['S3', 'S9', 'S2', 'S1'])).toEqual(['S3', 'S2', 'S1', 'S9']);
  });
  it('unreadable positions keep the order (the editor shows the problem)', () => {
    const f: Wire[] = [...base, { ...dot('S9', 'P3'), plane: { kind: 'face', id: 'F1.f2' } }];
    expect(orderPointSections(ctx(f), ['S1', 'S9', 'S2'])).toEqual(['S1', 'S9', 'S2']);
  });
  it('more than two points are left alone', () => {
    const f = [...base, plane('P9', 60), dot('S9', 'P9'), plane('P8', 70), dot('S8', 'P8'), plane('P7', 80), dot('S7', 'P7')];
    expect(orderPointSections(ctx(f), ['S9', 'S1', 'S8', 'S7'])).toEqual(['S9', 'S1', 'S8', 'S7']);
  });
  it('the Loft tool is offered the reordered profiles', () => {
    const f = [...base.slice(0, 4), plane('P9', 60), dot('S9', 'P9'), ...base.slice(4)];
    const ops = loftOps(ctx(f))!;
    expect((ops[0] as unknown as { feature: { sketches: string[] } }).feature.sketches).toEqual(['S1', 'S2', 'S3', 'S9']);
  });
});

describe('a loft moves after the last sketch it uses', () => {
  const feats = [{ id: 'S1' }, { id: 'S2' }, { id: 'L' }, { id: 'S3' }, { id: 'S4' }];
  it('later sketch picked: move to just after it', () => {
    expect(loftMoveAfter(feats, 'L', ['S1', 'S2', 'S3'])).toEqual({ op: { op: 'move', id: 'L', to: 3 }, after: 'S3' });
    expect(loftMoveAfter(feats, 'L', ['S1', 'S4', 'S2'])).toEqual({ op: { op: 'move', id: 'L', to: 4 }, after: 'S4' });
  });
  it('earlier sketches only: nothing to do', () => {
    expect(loftMoveAfter(feats, 'L', ['S1', 'S2'])).toBeNull();
  });
});

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function world(doc: PartDoc) {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc);
  return controller;
}

describe('against the kernel', () => {
  const doc = partOf([plane('P1', 0), circle('S1', 'P1'), plane('P2', 20), circle('S2', 'P2'), { type: 'loft', id: 'L', op: 'add', sketches: ['S1', 'S2'] }, plane('P3', 40), circle('S3', 'P3')]);
  it('picking a later sketch alone is "missing sketch"; with the move it builds', async () => {
    const c = await world(doc);
    const bad = await c.edit([{ op: 'set', id: 'L', path: 'sketches', value: ['S1', 'S2', 'S3'] }]);
    expect(bad.ok).toBe(false);
    const mv = loftMoveAfter(c.document()!.features as never, 'L', ['S1', 'S2', 'S3'])!;
    const ok = await c.edit([{ op: 'set', id: 'L', path: 'sketches', value: ['S1', 'S2', 'S3'] }, mv.op]);
    expect(ok.ok).toBe(true);
    expect(c.document()!.features.map((f) => f.id)).toEqual(['P1', 'S1', 'P2', 'S2', 'P3', 'S3', 'L']);
  }, 60000);

  it('a refused loft can be kept as a suppressed draft and made real by its first accepted edit', async () => {
    const c = await world(partOf([plane('P1', 0), circle('S1', 'P1'), plane('P2', 20), circle('S2', 'P2')]));
    const f = { type: 'loft', op: 'add', sketches: ['S1', 'NOPE'] };
    expect((await c.edit([{ op: 'add', feature: f as never }])).ok).toBe(false);
    expect((await c.edit([{ op: 'add', feature: { ...f, suppressed: true, draftNew: true } as never }])).ok).toBe(true);
    const id = c.document()!.features.at(-1)!.id;
    const live = { ...c.document()!.features.at(-1)!, sketches: ['S1', 'S2'] } as Wire;
    delete live.suppressed; delete live.draftNew;
    const rr = await c.edit([{ op: 'replace', id, feature: live as never }]);
    expect(rr.ok).toBe(true);
    const done = c.document()!.features.at(-1) as unknown as Wire;
    expect(done.suppressed).toBeUndefined();
    expect(done.draftNew).toBeUndefined();
  }, 60000);
});
