// Size and time of a part with a 500,000 triangle reference mesh and a mid-size imported STEP, saved and opened through the app's own paths.
// Prints a table (and writes it as JSON to $BENCH_OUT when set). The browser run of the same numbers is tools/bench/assetsBrowser.md.
import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { meshToStl } from '@kit/io';
import { takeEmbedded } from '@kit/viewdata';
import { headLike } from '../../../../packages/io/src/testmesh';
import { Controller, type KernelFactory } from '../controller';
import { buildRecord } from '../meshes/meshImport';
import { MESH_KEY, decode } from '../meshes/meshDoc';
import { clearAssetCaches, unpackDoc } from './assets';
import { stripThumbnail } from './docThumb';
import { FileManager, type FilePlatform } from './fileManager';
import { partOfStep } from './sldprtImport';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); clearAssetCaches(); });
const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };

function plate(n: number): PartDoc {
  const pts: unknown[] = [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 200, y: 0 }, { id: 'p3', x: 200, y: 200 }, { id: 'p4', x: 0, y: 200 }];
  const ents: unknown[] = [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b }));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { pts.push({ id: `c${i}_${j}`, x: (200 / (n + 1)) * (i + 1), y: (200 / (n + 1)) * (j + 1) }); ents.push({ id: `h${i}_${j}`, type: 'circle', c: `c${i}_${j}`, r: 3 }); }
  return { ...emptyPart('Plate'), features: [
    { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: pts, entities: ents, constraints: [] },
    { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 12 },
  ], seq: 3 } as unknown as PartDoc;
}

describe('assets bench', { skip: !process.env.CK_WASM }, () => {
  it('500k triangles + a mid-size STEP: size, save, open, and the longest stall of the main thread', async () => {
    const stl = meshToStl({ positions: headLike(500, 500) }).data as Uint8Array;
    const s0 = await Session.open(plate(15)); sessions.push(s0);
    const step = await s0.step();
    const part = await partOfStep(step, 'Bench', 'plate.step');
    const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
    await c.load(part);
    const { rec } = buildRecord(stl, 'head.stl', 'mm', [], null);
    c.setUndoableExtra(MESH_KEY, [rec]);
    const d = decode(rec);
    // what the first mesh version wrote (base64 of raw arrays) and what JSON number arrays would be
    const rawBase64 = rec.v.length + rec.i.length;
    const naive = JSON.stringify(Array.from(d.mesh.vertices)).length + JSON.stringify(Array.from(d.mesh.indices)).length + step.length;
    // the longest gap between two turns of the event loop while the work runs
    let last = performance.now(), worst = 0;
    const tick = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n; }, 2);
    const writes: string[] = [];
    const platform: FilePlatform = { canOverwrite: () => false, saveFile: async (_n, data) => { writes.push(String(data)); } };
    clearAssetCaches();
    const doc = c.document()!;
    const t0 = performance.now();
    const r = await new FileManager(platform, null).save(doc, { fileName: 'bench.ckpart' });
    const saveMs = performance.now() - t0;
    expect(r.ok).toBe(true);
    const text = writes[0];
    const t1 = performance.now();
    const { doc: plain } = stripThumbnail(JSON.parse(text) as PartDoc);
    const { doc: opened, problems } = await unpackDoc(takeEmbedded(plain).doc);
    const unpackMs = performance.now() - t1;
    const t2 = performance.now();
    const c2 = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
    await c2.load(opened);
    const loadMs = performance.now() - t2;
    clearInterval(tick);
    expect(problems).toEqual([]);
    const f0 = await (await Session.open(c.document()!)).facts(), f1 = await (await Session.open(c2.document()!)).facts();
    expect(f1.volume).toBe(f0.volume);
    expect(f1.faces).toEqual(f0.faces);
    const out = {
      triangles: rec.tris, stepBytes: step.length, stepFaces: f0.faces.length,
      naiveJsonBytes: naive, firstVersionBase64Bytes: rawBase64 + step.length, fileBytes: text.length, ratioToNaive: +(text.length / naive).toFixed(4),
      saveMs: Math.round(saveMs), unpackMs: Math.round(unpackMs), kernelLoadMs: Math.round(loadMs), longestStallMs: Math.round(worst),
    };
    console.log('ASSETS BENCH ' + JSON.stringify(out));
    if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify(out, null, 1));
    expect(text.length).toBeLessThan(naive * 0.25);
  }, 180_000);
});
