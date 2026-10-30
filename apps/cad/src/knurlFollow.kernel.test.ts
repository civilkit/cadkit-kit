// A knurl band the wizard cuts on a cylinder stays at the same distance from the end face when the part is edited: a 30 mm shaft with a band 5 mm from its far
// end is made 20, 40 and 30 mm long and the knurl keeps building and keeps its distance. Real kernel: the shaft is built and read by the Controller (the wizard's
// own source of faces and edges), the knurl ops are the wizard's, the length change is an edit of the extrude on a Session.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { DEFAULT_KNURL, knurlOps, knurlTarget, type KnurlParams } from './knurl';
import './i18n';
import { adviceOf, diagnose, summaryLine } from '@kit/viewdata';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const fail = (r: unknown) => JSON.stringify((r as { errors?: unknown; schemaError?: unknown }).errors ?? (r as { schemaError?: unknown }).schemaError ?? r);

const R = 10;
/** A shaft off the origin: a circle on a standard plane, extruded 30 mm along that plane's normal. */
function shaft(plane: 'front' | 'top' | 'right', len: number): PartDoc {
  return { ...emptyPart('Shaft'), features: [
    { type: 'sketch', id: 'F1', plane: { kind: 'std', id: plane }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 7, y: -4 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: R }], constraints: [] },
    { type: 'extrude', id: 'F2', name: 'Shaft', op: 'add', sketch: 'F1', end: 'blind', depth: len },
  ], seq: 3 } as unknown as PartDoc;
}

/** What the wizard knows when it opens on the shaft's round face: the target with its end faces, from the real faces and edges. */
async function wizardTarget(plane: 'front' | 'top' | 'right') {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const c = new Controller({ store, view, kernel });
  await c.load(shaft(plane, 30));
  const mesh = c.bodyFaces()!, edges = c.bodyEdges() as never;
  for (const f of mesh.faceIds) {
    const found = knurlTarget(f, edges, mesh);
    if ('target' in found) return found.target;
  }
  throw new Error('no cylinder face');
}

const params = (target: NonNullable<KnurlParams['target']>, o: Partial<KnurlParams>): KnurlParams =>
  ({ ...DEFAULT_KNURL, cosmetic: false, count: 24, depth: 0.5, target, range: [15, 25], ...o });

async function volume(s: Session): Promise<number> { return (await s.massProps()).volume ?? Number.NaN; }
const setLength = (s: Session, depth: number) => s.edit([{ op: 'set', id: 'F2', path: 'depth', value: depth } as never], 'length');
const cylinder = (len: number) => Math.PI * R * R * len;

describe('a knurl band cut from the end face follows it', { skip: !process.env.CK_WASM }, () => {
  const kinds: Array<[string, Partial<KnurlParams>]> = [
    ['straight grooves', { pattern: 'straight' }],
    ['pyramid (cut grooves and rings)', { pattern: 'pyramid', method: 'boolean', count: 24, depth: 0.4 }],
    ['diamond (two twisted sweeps)', { pattern: 'diamond', method: 'boolean', count: 8, depth: 0.4, helixAngle: 20 }],
  ];
  for (const plane of ['front', 'top', 'right'] as const) {
    for (const [label, over] of kinds) {
      if (plane !== 'front' && label !== 'straight grooves' && !label.startsWith('pyramid')) continue;   // every axis for straight and pyramid; the diamond on one
      it(`${label}, shaft along the ${plane} normal: 30 mm, then 20, 40 and 30 again`, async () => {
        const target = await wizardTarget(plane);
        expect(target.ends?.length, 'the wizard sees both flat ends').toBe(2);
        const s = await Session.open(shaft(plane, 30)); sessions.push(s);
        const plain30 = await volume(s);
        const ops = knurlOps(s.document as never, params(target, over));
        const r = await s.edit(ops, 'knurl');
        expect(r.ok, fail(r)).toBe(true);
        const removed = plain30 - (await volume(s));
        expect(removed, 'the band cut something').toBeGreaterThan(0.5);
        for (const len of [20, 40, 30]) {
          const e = await setLength(s, len);
          expect(e.ok, `length ${len}: ${fail(e)}`).toBe(true);
          // the same band, 5 mm from the far end: the same amount of material is gone at every length
          expect(cylinder(len) - (await volume(s)), `removed at ${len}`).toBeCloseTo(removed, 1);
          expect((await s.validate()).ok).toBe(true);
        }
      }, 400000);
    }
  }

  it('a band typed nearer the near end (the .C0 face) is built from that end and does not move when the far end does', async () => {
    const target = await wizardTarget('front');
    const s = await Session.open(shaft('front', 30)); sessions.push(s);
    const plain30 = await volume(s);
    const r = await s.edit(knurlOps(s.document as never, params(target, { range: [4, 14] })), 'knurl');
    expect(r.ok, fail(r)).toBe(true);
    const removed = plain30 - (await volume(s));
    for (const len of [20, 40, 30]) {
      expect((await setLength(s, len)).ok).toBe(true);
      expect(cylinder(len) - (await volume(s))).toBeCloseTo(removed, 1);
    }
  }, 240000);

  it('the old behaviour, without end faces: the band stays at its numbers, so a shorter shaft loses part of it and a much shorter one the whole band', async () => {
    const target = await wizardTarget('front');
    const { ends: _ends, ...bare } = target;
    const s = await Session.open(shaft('front', 30)); sessions.push(s);
    const plain30 = await volume(s);
    expect((await s.edit(knurlOps(s.document as never, params(bare, {})), 'knurl')).ok).toBe(true);
    const removed = plain30 - (await volume(s));
    expect((await setLength(s, 20)).ok).toBe(true);
    expect(cylinder(20) - (await volume(s))).toBeLessThan(removed * 0.75);   // only 5 of the 10 mm are left on the shaft
    const gone = await setLength(s, 12);
    expect(gone.ok).toBe(false);   // the band is past the end: the cut finds nothing
    const d = diagnose((gone.errors ?? []).map(([id, e]) => ({ id, code: e.code, params: e.params })), s.document.features as never);
    expect(d.roots[0].knurl).toBe('fixed');
    expect(summaryLine(d)).toMatch(/the knurl band no longer touches the part, it was placed at fixed positions/);
    expect(adviceOf(d.roots[0])).toMatch(/Cut grooves/);
  }, 240000);

  it('a faceted diamond band is built at its numbers: it builds while it touches the part and says what happened when it does not', async () => {
    const target = await wizardTarget('front');
    const s = await Session.open(shaft('front', 30)); sessions.push(s);
    const ops = knurlOps(s.document as never, params(target, { pattern: 'diamond', method: 'faceted', count: 12, depth: 0.4 }));
    expect(JSON.stringify(ops)).not.toContain('"kind":"face"');   // nothing derived from a face
    const made = await s.edit(ops, 'knurl');
    if (!made.ok && /unknownFeature/.test(fail(made))) return;   // a kernel build from before knurlBand: nothing to check here
    expect(made.ok, fail(made)).toBe(true);
    const gone = await setLength(s, 12);
    expect(gone.ok).toBe(false);
    const d = diagnose((gone.errors ?? []).map(([id, e]) => ({ id, code: e.code, params: e.params })), s.document.features as never);
    expect(d.roots[0].knurl).toBe('fixed');
  }, 240000);
});
