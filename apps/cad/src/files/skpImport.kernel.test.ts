import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Session } from '@ck/session';
import { emptyPart } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { importSkpView } from './skpImport';

// needs a kernel built with the `skp` feature; CK_WASM points at it, CK_REBUILD at the kernel checkout (fixtures)
const FIX = process.env.CK_REBUILD ? `${process.env.CK_REBUILD}/crates/ck-skp/tests/fixtures` : '';
const fixture = (n: string) => new Uint8Array(readFileSync(`${FIX}/${n}`));
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const open = async () => { const s = await Session.open(emptyPart('Skp')); sessions.push(s); return s; };

describe('SketchUp import against the real kernel', { skip: !process.env.CK_WASM || !process.env.CK_REBUILD }, () => {
  it('chair_and_table: faces, pieces, open edges and the material colours', async () => {
    const r = await importSkpView(await open(), fixture('chair_and_table.skp'), 'chair');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.faces).toBe(128);
    expect(r.summary).toMatchObject({ faces: 128, pieces: 28, materials: 6, closed: false });
    expect(r.summary.openEdges).toBeGreaterThan(0);
    expect(r.view.mesh.triFace.length).toBeGreaterThan(128);
    expect(Object.keys(r.look.faces).length + r.look.bodies.reduce((n, b) => n + b.faces.length, 0)).toBe(128);
    expect(r.look.faces['skp.F0']).toEqual({ color: '#5c402a' });   // material 0 is (92, 64, 42)
    expect(new Set(Object.values(r.look.faces).map((l) => l.color)).size).toBeGreaterThan(1);
  });
  it.each(['SU_File.skp', 'circle.skp'])('%s imports with a mesh and a colour for every face', async (n) => {
    const r = await importSkpView(await open(), fixture(n), n);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.faces).toBeGreaterThan(0);
    expect(r.view.mesh.faceIds.length).toBe(r.faces);
    expect(Object.keys(r.look.faces).length + r.look.bodies.reduce((m, b) => m + b.faces.length, 0)).toBe(r.faces);
    expect(r.view.box.max[0]).toBeGreaterThan(r.view.box.min[0]);
  });
  it('a model with no visible faces is refused with body.empty and the kernel message', async () => {
    const r = await importSkpView(await open(), fixture('blank_v17.skp'), 'blank');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('body.empty');
    expect(r.message).toMatch(/no visible faces/);
  });
  it('maxFaces refuses with limit.faces', async () => {
    const r = await importSkpView(await open(), fixture('chair_and_table.skp'), 'chair', { maxFaces: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('limit.faces');
  });
  it('junk bytes are refused with a structured code, not a trap', async () => {
    const r = await importSkpView(await open(), new TextEncoder().encode('this is not a sketchup file'), 'junk');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).not.toBe('trap');
  });
  it('through the controller: shown, coloured, busy while it runs, gone after an edit', async () => {
    const bodies: unknown[] = [];
    const view: ViewSink = { setBody: (b) => { bodies.push(b); }, setHighlight() {}, setSketchEdit() {} };
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
    const store = createStore();
    const c = new Controller({ store, view, kernel });
    await c.load(emptyPart('Skp'));
    const seenBusy: boolean[] = [];
    const p = c.importSkp(fixture('chair_and_table.skp'), 'chair');
    seenBusy.push(store.busy.value);
    const r = await p;
    expect(r.ok).toBe(true);
    expect(seenBusy).toEqual([true]);
    expect(store.busy.value).toBe(false);
    expect(c.hasImportedBody()).toBe(true);
    expect(Object.keys(c.importedLook()!.faces).length).toBe(128);
    await c.load(emptyPart('Other'));
    expect(c.hasImportedBody()).toBe(false);
    expect(c.importedLook()).toBeNull();
  });
  it('a refused file leaves the screen alone', async () => {
    const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
    const c = new Controller({ store: createStore(), view, kernel });
    await c.load(emptyPart('Skp'));
    const r = await c.importSkp(fixture('blank_v17.skp'), 'blank');
    expect(r).toMatchObject({ ok: false, code: 'body.empty' });
    expect(c.hasImportedBody()).toBe(false);
  });
});
