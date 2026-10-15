// The wall-thickness handle of a thin extrude against the real kernel: the offset wall (F2.S.e1.W0) carries an arrow, dragging it
// edits `thin.thickness` live and release is ONE edit.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { planHandles } from './plan';
import { HandleRunner } from './runner';

const circle = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'o', x: 0, y: 0 }], entities: [{ type: 'circle', id: 'e1', c: 'o', r: 10 }], constraints: [] };
const doc = (side: string): PartDoc => ({ ...emptyPart('Ring'), features: [circle, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 5, thin: { thickness: 2, side } }], seq: 5 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('thin wall thickness handle', { skip: !process.env.CK_WASM }, () => {
  it('drags the thickness of an inside wall and of a mid wall', async () => {
    for (const [side, scale] of [['inside', 1], ['mid', 2]] as const) {
      const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
      const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
      const c = new Controller({ store: createStore(), view, kernel });
      await c.load(doc(side));
      const s = planHandles({ doc: c.document(), selection: ['F2.S.e1.W0'], mode: 'face', edges: c.bodyEdges(), mesh: c.bodyFaces(), box: c.bodyBox(), editingId: null, sketching: false, enabled: true })!;
      expect(s?.kind, side).toBe('thin-thickness');
      expect(s.specs[0].base).toBe(2);
      expect(s.specs[0].scale).toBe(scale);
      const runner = new HandleRunner({ preview: (ops) => c.preview(ops, 0), cancelPreview: () => c.cancelPreview(), commit: async (x) => { await c.commit(x.ops); } });
      const sink = runner.sink(s);
      sink.onStart!('thin');
      sink.onDrag('thin', 3, [0, 0, 0]);
      await new Promise((r) => setTimeout(r, 300));
      await runner.commit(s.commit('thin', 3, [0, 0, 0]));
      const f = c.document()!.features[1] as unknown as { thin: { thickness: number; side: string } };
      expect(f.thin).toMatchObject({ thickness: 3, side });
      const errors = (await sessions.at(-1)!.verify()).regen.errors;
      expect(errors).toEqual([]);
      // a drag below the minimum shows nothing
      expect(s.preview('thin', 0, [0, 0, 0])).toBeNull();
    }
  }, 60000);
});
