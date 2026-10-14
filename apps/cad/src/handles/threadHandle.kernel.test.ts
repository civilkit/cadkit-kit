// The Thread editor's length handle and face reading against the real kernel (the threaded-bolt sample: an M10 shaft and
// an M8 tapped blind hole): the face length read from the view equals the length the kernel gives a "full" thread, a drag
// previews `set length` and regenerates the entry, past the face it is clamped to the face, release edits nothing.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Session } from '@ck/session';
import type { EditOp } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { faceExtent, startMatters } from '../threadData';
import { threadLengthSession, type ThreadEntryLike } from './threadHandle';
import { planHandles } from './plan';
import { HandleRunner } from './runner';

const sample = (): PartDoc => JSON.parse(readFileSync(resolve(process.cwd(), 'apps/cad/public/samples/threaded-bolt.ckpart'), 'utf8')) as PartDoc;
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world() {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {}, setThreads() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(sample());
  const entryOf = (id: string) => (controller.threadsShown() as ThreadEntryLike[]).find((x) => x.id === id)!;
  const drafts: Array<Record<string, unknown>> = [];
  const runner = new HandleRunner({
    preview: (ops) => controller.preview(ops, 0),
    cancelPreview: () => controller.cancelPreview(),
    commit: async (c) => { if (c.draft) drafts.push(c.draft); else await controller.commit(c.ops); },
  });
  const sessionFor = (id: string, face: string) => {
    const ext = faceExtent(face, controller.bodyEdges(), controller.bodyFaces());
    return { ext, s: planHandles({ doc: controller.document(), selection: [], mode: 'face', edges: [], mesh: null, box: null, editingId: id, sketching: false, enabled: true,
      thread: { id, entry: entryOf(id), maxLength: ext?.length ?? null, ops: (length) => [{ op: 'set', id, path: 'length', value: length } as EditOp] } })! };
  };
  const drag = async (s: ReturnType<typeof sessionFor>['s'], qs: number[], end: 'commit' | 'cancel') => {
    const sink = runner.sink(s);
    sink.onStart!('length');
    for (const q of qs) { sink.onDrag('length', q, [0, 0, 0]); await new Promise((r) => setTimeout(r, 5)); }
    await new Promise((r) => setTimeout(r, 300));
    if (end === 'commit') await runner.commit(s.commit('length', qs[qs.length - 1], [0, 0, 0])); else await runner.cancel();
  };
  return { controller, entryOf, sessionFor, drag, drafts };
}

describe('thread length handle against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('the face length read from the view is the length of a full thread; the shaft and the blind hole each have one open end', async () => {
    const w = await world();
    const shaft = faceExtent('F4.S.c1', w.controller.bodyEdges(), w.controller.bodyFaces())!;
    const hole = faceExtent('F10.S.h1', w.controller.bodyEdges(), w.controller.bodyFaces())!;
    expect(hole.length).toBeCloseTo(14, 3);                   // the F11 thread is "full": its entry length is the wall length
    expect(w.entryOf('F11').length).toBeCloseTo(hole.length!, 3);
    expect(hole.open!.filter(Boolean)).toHaveLength(1);       // the mouth is open, the bottom is not
    expect(startMatters(hole)).toBe(false);
    expect(shaft.open!.filter(Boolean)).toHaveLength(1);      // the free end is open, the head side is a shoulder
    expect(startMatters(shaft)).toBe(false);
    // asking for the whole face gives exactly that length
    await w.controller.preview([{ op: 'set', id: 'F6', path: 'length', value: 'full' }], 0);
    expect(w.entryOf('F6').length).toBeCloseTo(shaft.length!, 3);
    await w.controller.cancelPreview();
  }, 60000);

  it('dragging previews `set length` and regenerates the entry; the handle sits at start + dir * length', async () => {
    const w = await world();
    const { s } = w.sessionFor('F6', 'F4.S.c1');
    const e0 = w.entryOf('F6');
    expect(e0.length).toBe(30);
    expect(s.specs[0].origin).toEqual([e0.start[0] + e0.dir[0] * 30, e0.start[1] + e0.dir[1] * 30, e0.start[2] + e0.dir[2] * 30]);
    await w.drag(s, [26, 22, 18], 'cancel');
    expect(w.entryOf('F6').length).toBe(30);                  // cancelled: the committed thread is back
    // mid-drag state: run the steps and look before releasing
    const sink = new HandleRunner({ preview: (ops) => w.controller.preview(ops, 0), cancelPreview: () => w.controller.cancelPreview(), commit: async () => {} }).sink(s);
    sink.onStart!('length'); sink.onDrag('length', 18, [0, 0, 0]);
    await new Promise((r) => setTimeout(r, 400));
    expect(w.entryOf('F6').length).toBeCloseTo(18, 3);        // the preview regenerated the thread entry
    expect((w.controller.threadsNow() as ThreadEntryLike[]).find((x) => x.id === 'F6')!.length).toBe(30);   // committed state untouched
    expect((w.controller.document()!.features.find((f) => f.id === 'F6') as unknown as { length: number }).length).toBe(30);
    await w.controller.cancelPreview();
  }, 60000);

  it('past the face the length is clamped to the face; release hands a draft and edits no document', async () => {
    const w = await world();
    const { s, ext } = w.sessionFor('F6', 'F4.S.c1');
    const before = w.controller.document()!.features.length;
    await w.drag(s, [35, 60, 500], 'commit');
    expect(w.drafts).toEqual([{ length: 'full' }]);
    expect(w.entryOf('F6').length).toBeCloseTo(ext!.length!, 3);          // the preview is still shown: the whole face
    expect((w.controller.document()!.features.find((f) => f.id === 'F6') as unknown as { length: number }).length).toBe(30);
    expect(w.controller.document()!.features.length).toBe(before);
    await w.controller.cancelPreview();
    expect(w.entryOf('F6').length).toBe(30);
  }, 60000);

  it('a typed length that lands on a number sets exactly that; the minimum is one pitch', async () => {
    const w = await world();
    const { s } = w.sessionFor('F6', 'F4.S.c1');
    await w.drag(s, [0.1], 'commit');
    expect(w.drafts.at(-1)).toEqual({ length: 1.5 });
    await w.controller.cancelPreview();
    await w.drag(s, [12.5], 'commit');
    expect(w.drafts.at(-1)).toEqual({ length: 12.5 });
    expect(w.entryOf('F6').length).toBeCloseTo(12.5, 3);
    await w.controller.cancelPreview();
  }, 60000);
});
