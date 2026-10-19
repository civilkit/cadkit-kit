// The depth arrow of an open Extrude / Cut card against the real kernel: its origin sits on the end cap of the preview body
// (boss, flipped boss, cut), and a drag previews the card's depth through the same ops the Depth field sends.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { depthArrowSession } from './depthArrow';
import { profileCentre } from './sizeBox';

const sk = (id: string, r: number, x = 0) => ({ type: 'sketch', id, plane: { kind: 'std', id: 'front' }, points: [{ id: 'o', x, y: 0 }], entities: [{ type: 'circle', id: 'e1', c: 'o', r }], constraints: [] });
const doc = (last: Record<string, unknown>): PartDoc => ({ ...emptyPart('P'), features: [sk('F1', 10), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 20 }, sk('F3', 3, 2), last], seq: 6 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function open(d: PartDoc): Promise<Controller> {
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view, kernel });
  await c.load(d);
  return c;
}

describe('depth arrow on the real preview', { skip: !process.env.CK_WASM }, () => {
  it('the arrow origin is on the cap of an added extrude, a flipped one and a cut', async () => {
    const cases: Array<[Record<string, unknown>, 'add' | 'cut', boolean]> = [
      [{ type: 'extrude', id: 'F4', op: 'add', sketch: 'F3', end: 'blind', depth: 5 }, 'add', false],             // along +z from the sketch plane z = 0: cap at z = 5
      [{ type: 'extrude', id: 'F4', op: 'add', sketch: 'F3', end: 'blind', depth: 5, flip: true }, 'add', true],  // cap at z = -5
      [{ type: 'extrude', id: 'F4', op: 'cut', sketch: 'F3', end: 'blind', depth: 5, flip: true }, 'cut', true],  // a cut with flip goes along +z, into the body (z 0..20)
    ];
    for (const [feat, op, flip] of cases) {
      const c = await open(doc(feat));
      const f = c.document()!.features;
      const frame = c.sketchFrameOf('F3')!;
      const centre = profileCentre(f[2] as never, undefined)!;
      const s = depthArrowSession({ id: 'F4', op, end: 'blind', depth: 5, flip, frame, centre, ops: (p) => [{ op: 'set', id: 'F4', path: 'depth', value: p.depth } as never] })!;
      const a = s.specs.find((x) => x.kind === 'arrow')!;
      const z = op === 'cut' || !flip ? 5 : -5;
      expect(a.origin[2], `${op} flip=${flip}`).toBeCloseTo(z, 6);
      expect(a.origin[0]).toBeCloseTo(2, 6);
      expect(a.axis[2]).toBe(Math.sign(z));
      // a drag previews through the controller and the body still builds; the committed depth puts the far end of a flipped boss there
      const r = await c.preview(s.preview('depth', 8, [0, 0, 0])!, 0);
      expect(r.ok, `${op} flip=${flip}`).toBe(true);
      await c.commit(s.preview('depth', 8, [0, 0, 0])!);
      if (op === 'add' && flip) expect(c.bodyBox()!.min[2]).toBeCloseTo(-8, 4);   // the flipped boss sticks out of the body: its far end is where the drag said
    }
  });
});
