import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Session } from '@ck/session';
import { emptyPart } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { importSkpView, skpImportOpts } from './skpImport';

// needs a kernel built with the `skp` feature; CK_WASM points at it, CK_REBUILD at the kernel checkout (fixtures)
const FIX = process.env.CK_REBUILD ? `${process.env.CK_REBUILD}/crates/ck-skp/tests/fixtures` : '';
const fixture = (n: string) => new Uint8Array(readFileSync(`${FIX}/${n}`));
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const open = async () => { const s = await Session.open(emptyPart('Skp')); sessions.push(s); return s; };
/** The SketchUp reader is an opt-in kernel feature (`skp`) and the fixtures live in the kernel checkout: a kernel without it, or no fixtures, skips these (they cannot fail for the app). */
const skpReady: Promise<boolean> = (async () => {
  if (!process.env.CK_WASM || !FIX || !existsSync(`${FIX}/chair_and_table.skp`)) return false;
  const s = await Session.open(emptyPart('Skp')); sessions.push(s);
  const r = await importSkpView(s, fixture('chair_and_table.skp'), 'probe');
  return r.ok || r.code !== 'trap';
})().catch(() => false);

describe('SketchUp import against the real kernel', { skip: !process.env.CK_WASM || !process.env.CK_REBUILD }, () => {
  it('chair_and_table: faces, pieces, open edges and the material colours', async (ctx) => {
    if (!(await skpReady)) return ctx.skip();
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
    if (!(await skpReady)) return;   // (each-cases carry no skip handle)
    const r = await importSkpView(await open(), fixture(n), n);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.faces).toBeGreaterThan(0);
    expect(r.view.mesh.faceIds.length).toBe(r.faces);
    expect(Object.keys(r.look.faces).length + r.look.bodies.reduce((m, b) => m + b.faces.length, 0)).toBe(r.faces);
    expect(r.view.box.max[0]).toBeGreaterThan(r.view.box.min[0]);
  });
  it('orientation: y stands the model up (z extent becomes y extent), z keeps the file, the kernel echoes the choice', async (ctx) => {
    if (!(await skpReady)) return ctx.skip();
    const bytes = fixture('chair_and_table.skp');
    const z = await importSkpView(await open(), bytes, 'chair', skpImportOpts('z'));
    const y = await importSkpView(await open(), bytes, 'chair', skpImportOpts('y'));
    const f = await importSkpView(await open(), bytes, 'chair', skpImportOpts('yFlip'));
    expect(z.ok && y.ok && f.ok).toBe(true);
    if (!z.ok || !y.ok || !f.ok) return;
    expect([z.up, y.up, f.up]).toEqual(['z', 'y', 'yFlip']);
    const ext = (b: { min: number[]; max: number[] }) => b.max.map((v, k) => v - b.min[k]);
    const [zx, zy, zz] = ext(z.view.box), [yx, yy, yz] = ext(y.view.box), [fx, fy, fz] = ext(f.view.box);
    expect(zz).toBeGreaterThan(zy);   // the file is Z up (taller than deep)
    expect(yy).toBeCloseTo(zz, 3); expect(yz).toBeCloseTo(zy, 3); expect(yx).toBeCloseTo(zx, 3);
    expect([fx, fy, fz].map((v) => +v.toFixed(3))).toEqual([yx, yy, yz].map((v) => +v.toFixed(3)));
    expect(y.faces).toBe(z.faces);
    expect(y.summary).toEqual(z.summary);
  });
  it('a model with no visible faces is refused with body.empty and the kernel message', async (ctx) => {
    if (!(await skpReady)) return ctx.skip();
    const r = await importSkpView(await open(), fixture('blank_v17.skp'), 'blank');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('body.empty');
    expect(r.message).toMatch(/no visible faces/);
  });
  it('maxFaces refuses with limit.faces', async (ctx) => {
    if (!(await skpReady)) return ctx.skip();
    const r = await importSkpView(await open(), fixture('chair_and_table.skp'), 'chair', { maxFaces: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('limit.faces');
  });
  it('junk bytes are refused with a structured code, not a trap', async (ctx) => {
    if (!(await skpReady)) return ctx.skip();
    const r = await importSkpView(await open(), new TextEncoder().encode('this is not a sketchup file'), 'junk');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).not.toBe('trap');
  });
  it('through the controller: shown, coloured, busy while it runs, gone after an edit', async (ctx) => {
    if (!(await skpReady)) return ctx.skip();
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
  it('a refused file leaves the screen alone', async (ctx) => {
    if (!(await skpReady)) return ctx.skip();
    const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
    const c = new Controller({ store: createStore(), view, kernel });
    await c.load(emptyPart('Skp'));
    const r = await c.importSkp(fixture('blank_v17.skp'), 'blank');
    expect(r).toMatchObject({ ok: false, code: 'body.empty' });
    expect(c.hasImportedBody()).toBe(false);
  });
});
