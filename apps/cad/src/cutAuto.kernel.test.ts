// Cut direction 'auto' and the refused-first-try draft, against the real kernel (needs CK_WASM).
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { autoCutFlip, editorFixes } from './editorFixes';

type Wire = Record<string, unknown>;
const rect = (id: string, plane: Wire, w: number): Wire => ({ type: 'sketch', id, plane, points: [{ id: 'a', x: -w, y: -w }, { id: 'b', x: w, y: -w }, { id: 'c', x: w, y: w }, { id: 'd', x: -w, y: w }], entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']].map(([i, p1, p2]) => ({ type: 'line', id: i, p1, p2 })), constraints: [] });
const plane = (id: string, offset: number): Wire => ({ type: 'plane', id, mode: 'offset', base: { kind: 'std', id: 'front' }, offset });
// a 40 x 40 x 20 block on the Front plane, z from 0 to 20
const BLOCK: Wire[] = [rect('F1', { kind: 'std', id: 'front' }, 20), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 20 }];

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function world(features: Wire[]) {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load({ ...emptyPart('t'), features, seq: 40 } as unknown as PartDoc);
  return controller;
}
const probeFor = (c: Controller, sketch: string, depth: number) => async (flip: boolean) => {
  const r = await c.preview([{ op: 'add', feature: { type: 'extrude', op: 'cut', sketch, end: 'blind', depth, ...(flip ? { flip: true } : {}) } as never }], 0);
  return { ok: r.ok, codes: (r.errors ?? []).map((e) => String((e as unknown as [string, { code?: string }])[1]?.code ?? '')) };
};

describe('cut direction auto', { skip: !process.env.CK_WASM }, () => {
  it('a plane above the body: the cut goes down to the body; below it: up', async () => {
    const above = await world([...BLOCK, plane('P', 25), rect('F4', { kind: 'feature', id: 'P' }, 5)]);
    const a = await autoCutFlip(false, probeFor(above, 'F4', 10));
    expect(a.ok).toBe(true);
    const below = await world([...BLOCK, plane('P', -5), rect('F4', { kind: 'feature', id: 'P' }, 5)]);
    const b = await autoCutFlip(false, probeFor(below, 'F4', 10));
    expect(b).toEqual({ flip: true, ok: true });
    const bFirst = await autoCutFlip(true, probeFor(below, 'F4', 10));
    expect(bFirst).toEqual({ flip: true, ok: true });
  }, 60000);
  it('a plane too far away for the depth: neither direction touches the body', async () => {
    const far = await world([...BLOCK, plane('P', 80), rect('F4', { kind: 'feature', id: 'P' }, 5)]);
    const r = await autoCutFlip(false, probeFor(far, 'F4', 10));
    expect(r.ok).toBe(false);
  }, 60000);
  it('a refused cut is kept as a draft and Flip + a longer depth make it real', async () => {
    const c = await world([...BLOCK, plane('P', 80), rect('F4', { kind: 'feature', id: 'P' }, 5)]);
    const cut: Wire = { type: 'extrude', op: 'cut', sketch: 'F4', end: 'blind', depth: 10 };
    const bad = await c.edit([{ op: 'add', feature: cut as never }]);
    expect(bad.ok).toBe(false);
    const root = c.rejection()?.diagnosis.roots[0];
    expect(root?.code).toBe('cutNoEffect');
    expect(editorFixes(root, cut).fixes[0]).toMatchObject({ key: 'flip', value: true });
    expect((await c.edit([{ op: 'add', feature: { ...cut, suppressed: true, draftNew: true } as never }])).ok).toBe(true);
    const id = c.document()!.features.at(-1)!.id;
    const live = { ...cut, id, depth: 70 };
    expect((await c.edit([{ op: 'replace', id, feature: live as never }])).ok).toBe(true);
  }, 60000);
});

describe('a shell the kernel refuses', { skip: !process.env.CK_WASM }, () => {
  it('too thick: refused with a structured code; a draft keeps the editor open and a thinner wall builds', async () => {
    const c = await world(BLOCK);
    const shell: Wire = { type: 'shell', faces: ['F2.C1'], thickness: 30 };
    expect((await c.edit([{ op: 'add', feature: shell as never }])).ok).toBe(false);
    const root = c.rejection()?.diagnosis.roots[0];
    expect(root?.code).toBe('shellTooThick');
    expect((await c.edit([{ op: 'add', feature: { ...shell, suppressed: true, draftNew: true } as never }])).ok).toBe(true);
    const id = c.document()!.features.at(-1)!.id;
    expect((await c.edit([{ op: 'replace', id, feature: { ...shell, id, thickness: 2 } as never }])).ok).toBe(true);
  }, 60000);
});
