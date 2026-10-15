// Kernel request log of the dome_cap editing session the user timed: open the sample, add a sketch point on the top plane,
// add a Hole through the body, drag the hole's size box (12 -> 15 mm) with live preview, release, undo, redo.
// One line per kernel request (type, tag, opts, duration, reply size) goes to $EDITPERF_LOG (JSON) and the console.
// The asserts pin the request COUNT per user action, so a regression that sends a duplicate regen fails here.
import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { DEFAULT_SETTINGS, pointTool } from '@kit/sketch';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { HandleRunner } from './handles/runner';
import { planSizeBox } from './handles/sizeBox';

type Row = { step: string; type: string; tag: string; opts: string; ms: number; bytes: number };
const rows: Row[] = [];
let step = 'open';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const sample = (): PartDoc => JSON.parse(readFileSync(process.env.EDITPERF_PART ?? `${process.cwd()}/apps/cad/public/samples/bench-dome_cap.ckpart`, 'utf8')) as PartDoc;

function instrument(s: Session): void {
  const k = (s as unknown as { kernel: { request(m: Record<string, unknown>): Promise<{ result?: unknown; ok?: boolean }> } }).kernel;
  const orig = k.request.bind(k);
  k.request = async (m) => {
    const t0 = performance.now();
    const r = await orig(m);
    const ms = performance.now() - t0;
    let bytes = 0;
    try { bytes = JSON.stringify(r.result ?? null, (_k, v) => (ArrayBuffer.isView(v) ? { n: (v as Float32Array).byteLength } : v)).length; } catch { /* circular or huge */ }
    const mesh = (r.result as { body?: { mesh?: Record<string, { data?: { byteLength: number } }> } } | undefined)?.body?.mesh;
    if (mesh) for (const v of Object.values(mesh)) bytes += v?.data?.byteLength ?? 0;
    const opts = m.opts ? JSON.stringify(m.opts) : '';
    rows.push({ step, type: String(m.type), tag: String(m.tag ?? ''), opts: opts + (m.debug ? ' debug' : ''), ms: Math.round(ms), bytes });
    return r;
  };
}

const count = (st: string) => rows.filter((r) => r.step === st);
const report = () => {
  const out = [...new Set(rows.map((r) => r.step))].map((st) => {
    const rs = count(st);
    return `${st}: ${rs.length} requests, ${rs.reduce((a, r) => a + r.ms, 0)} ms kernel\n` + rs.map((r) => `    ${r.type.padEnd(10)} ${r.tag.padEnd(14)} ${String(r.ms).padStart(6)} ms ${String(r.bytes).padStart(9)} B ${r.opts}`).join('\n');
  }).join('\n');
  console.log(out);
  if (process.env.EDITPERF_LOG) writeFileSync(process.env.EDITPERF_LOG, JSON.stringify(rows, null, 1));
};

describe('dome_cap editing: kernel request log', { skip: !process.env.CK_WASM }, () => {
  it('add hole, drag the size box 12 -> 15, undo, redo', async () => {
    const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {}, setThreads() {} };
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); instrument(s); return s; } };
    const c = new Controller({ store: createStore(), view, kernel });
    const time = async (name: string, f: () => Promise<unknown>) => { step = name; const t0 = performance.now(); await f(); const ms = Math.round(performance.now() - t0); rows.push({ step: name, type: '(wall)', tag: '', opts: '', ms, bytes: 0 }); return ms; };

    await time('open', () => c.load(sample()));
    // a point on the top plane
    await time('sketch point', async () => {
      const v = (await c.beginNewSketch('top'))!;
      const out = pointTool.step(pointTool.start(), { type: 'click', at: { x: 20, y: 0 }, mods: { shift: false, ctrl: false, alt: false } }, c.sketchDraft()!, DEFAULT_SETTINGS);
      await c.applySketchDraft(out.draft);
      await c.commitSketch();
      expect(v.featureId).toBeTruthy();
    });
    const sketchId = c.document()!.features.at(-1)!.id;
    // Hole command: the feature is previewed (debounced) while the editor is open, OK commits
    const ops = [{ op: 'add' as const, feature: { type: 'hole', sketch: sketchId, kind: 'simple', diameter: 12, end: 'through' } as never }];
    await time('hole preview', () => c.preview(ops, 0));
    await time('hole OK', () => c.commit(ops));
    const hole = c.document()!.features.at(-1)! as unknown as { id: string };
    // size box handle on the hole: drag steps, then release
    const runner = new HandleRunner({ preview: (o) => c.preview(o, 0), cancelPreview: () => c.cancelPreview(), commit: async (cm) => { await c.commit(cm.ops); } });
    const plan = planSizeBox({ doc: c.document(), shapeId: hole.id, frameOf: (s) => c.sketchFrameOf(s), bodyBox: c.bodyBox(), mode: 'opposite' as never });
    if (plan) {
      const id = plan.specs.find((x) => x.id === 'u1')?.id ?? plan.specs[0].id;
      const sink = runner.sink(plan);
      await time('handle drag (3 steps)', async () => {
        sink.onStart!(id);
        // pointer moves arrive faster than the kernel answers; the user then holds still on 15 before releasing
        for (const q of [13, 14, 15]) { sink.onDrag(id, q, [0, 0, 0]); await new Promise((r) => setTimeout(r, 20)); }
        await new Promise((r) => setTimeout(r, 2500));
      });
      await time('handle release', () => runner.commit(plan.commit(id, 15, [0, 0, 0])));
    } else {
      const set = (d: number) => [{ op: 'set' as const, id: hole.id, path: 'size', value: null }, { op: 'set' as const, id: hole.id, path: 'diameter', value: d }];
      await time('diameter preview', () => c.preview(set(15), 0));
      await time('diameter OK', () => c.commit(set(15)));
    }
    await time('undo', () => c.undo());
    await time('redo', () => c.redo());
    report();
    // one edit = at most one regen request: the commit of what the preview showed only moves the kernel's tag
    if (process.env.EDITPERF_NOASSERT) return;
    const reqs = (st: string) => rows.filter((r) => r.step === st && r.type !== '(wall)');
    const heavy = (st: string) => reqs(st).filter((r) => r.type === 'regen' && !r.opts.includes('noView'));
    expect(reqs('hole OK').map((r) => r.type)).toEqual(['regen']);
    expect(heavy('hole OK')).toHaveLength(0);
    if (rows.some((r) => r.step === 'handle release')) {
      expect(reqs('handle release').filter((r) => r.type !== 'refDiff')).toHaveLength(1);
      expect(heavy('handle release')).toHaveLength(0);
    }
    expect(reqs('undo').filter((r) => r.type !== 'refDiff').map((r) => r.type)).toEqual(['regen']);
    expect(reqs('redo').filter((r) => r.type !== 'refDiff').map((r) => r.type)).toEqual(['regen']);
    expect(heavy('redo')).toHaveLength(0);
    expect(c.document()!.features.every((f) => /^F\d+$/.test(f.id))).toBe(true);
  }, 600_000);
});
