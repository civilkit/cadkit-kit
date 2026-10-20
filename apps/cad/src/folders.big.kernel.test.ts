// Grouping rows into a folder is a label change: on the 612-feature heavy sample the edit, its undo and redo, a rename and an ungroup must
// not re-run one feature in the kernel (every regen reply reports ranFeatures 0) and finish fast. Needs CK_WASM (a kernel that keeps
// cosmetic keys out of its regen cache key); the first load takes about a minute.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import * as sessionModule from '@ck/session';
import { Session } from '@ck/session';
import { LABEL_BUSY_MS } from './cosmeticOps';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import type { FeatureRow } from '@kit/ui';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { groupPlan, renameFolderPlan, ungroupPlan } from './treeFolders';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const sample = (): PartDoc => JSON.parse(readFileSync(`${process.cwd()}/apps/cad/public/samples/heavy/matx-case.ckpart`, 'utf8')) as PartDoc;

type Feat = { id: string; type: string; group?: string; sketch?: string };
/** The sample with its first `n` reference planes moved to the front: twelve planes in a row, the way a QA part has them. */
function withPlanesFirst(doc: PartDoc, n: number): PartDoc {
  const fs = doc.features as unknown as Feat[];
  const planes = fs.filter((f) => f.type === 'plane').slice(0, n);
  const rest = fs.filter((f) => !planes.includes(f));
  return { ...doc, features: [...planes, ...rest] } as unknown as PartDoc;
}

type Call = { type: string; ms: number; ran?: number; reused?: number; full?: boolean };

describe('folders on the heavy sample (matx-case)', { skip: !process.env.CK_WASM }, () => {
  it('group 12 planes, undo, redo, rename, ungroup: no feature re-runs, each step is quick', async () => {
    const calls: Call[] = [];
    const kernel: KernelFactory = {
      async open(d) {
        const s = await Session.open(d); sessions.push(s);
        const k = (s as unknown as { kernel: { request(m: Record<string, unknown>): Promise<{ result?: { cacheStats?: Record<string, number | boolean> } }> } }).kernel;
        (s as unknown as { kernel: unknown }).kernel = {
          ...k,
          request: async (m: Record<string, unknown>) => {
            const t0 = performance.now();
            const asks = m.type === 'regen';
            const r = await k.request(asks ? { ...m, opts: { ...((m.opts as object) ?? {}), cacheStats: true } } : m);
            const st = r?.result?.cacheStats;
            calls.push({ type: String(m.type), ms: performance.now() - t0, ...(st ? { ran: st.ranFeatures as number, reused: st.reusedFeatures as number, full: st.fullHit as boolean } : {}) });
            return r;
          },
        };
        return s;
      },
    };
    const store = createStore();
    const busy: number[] = [];
    let busySince = 0;
    store.busy.subscribe((b) => { if (b) busySince = performance.now(); else if (busySince) { busy.push(performance.now() - busySince); busySince = 0; } });
    const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {}, setThreads() {} };
    const c = new Controller({ store, view, kernel });
    const t0 = performance.now();
    await c.load(withPlanesFirst(sample(), 12));
    console.log(`folders: ${c.document()!.features.length} features, load ${Math.round(performance.now() - t0)} ms`);
    const feats = () => c.document()!.features as unknown as Feat[];
    const rows = (): FeatureRow[] => feats().map((f) => ({ id: f.id, type: f.type, group: f.group, uses: f.sketch ? [f.sketch] : undefined }) as FeatureRow);
    const planes = feats().slice(0, 12).map((f) => f.id);
    expect(feats().slice(0, 12).every((f) => f.type === 'plane')).toBe(true);

    /** Run one step and report it: wall time, the kernel requests it made, the features they ran. */
    const step = async (name: string, go: () => Promise<unknown>, expectGroup?: (f: Feat[]) => void) => {
      calls.length = 0; busy.length = 0;
      const t = performance.now();
      await go();
      const ms = performance.now() - t;
      const regens = calls.filter((x) => x.ran !== undefined);
      const ran = regens.reduce((a, x) => a + (x.ran ?? 0), 0);
      console.log(`folders: ${name}: ${Math.round(ms)} ms, busy ${busy.map(Math.round).join('/')} ms, ${calls.length} kernel requests (${regens.length} regens, ${ran} features run): ${calls.map((x) => `${x.type} ${Math.round(x.ms)}`).join(', ')}`);
      expectGroup?.(feats());
      if (process.env.FOLDER_BASELINE) return ms;   // numbers only, for a kernel without the cosmetic keys
      expect(busy, `${name}: the Rebuilding panel is never raised`).toEqual([]);
      expect(ran, `${name}: features re-run`).toBe(0);
      expect(regens.every((x) => x.full), `${name}: every regen a full hit`).toBe(true);
      return ms;
    };

    const plan = groupPlan(rows(), feats(), planes, 'Planes');
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.order).toBeUndefined();                                 // contiguous rows are not reordered
    expect(plan.ops).toHaveLength(12);
    const before = c.document()!.features.map((f) => f.id);
    const times = [
      await step('group 12', () => c.edit(plan.ops), (f) => expect(f.slice(0, 12).every((x) => x.group === 'Planes')).toBe(true)),
      await step('undo', () => c.undo(), (f) => expect(f.some((x) => x.group)).toBe(false)),
      await step('redo', () => c.redo(), (f) => expect(f.slice(0, 12).every((x) => x.group === 'Planes')).toBe(true)),
      await step('rename folder', () => { const p = renameFolderPlan(feats(), 'Planes', 'Datums'); if (!p.ok) throw new Error(p.reason); return c.edit(p.ops); }, (f) => expect(f[0].group).toBe('Datums')),
      await step('ungroup', () => { const p = ungroupPlan(feats(), 'Datums'); if (!p.ok) throw new Error(p.reason); return c.edit(p.ops); }, (f) => expect(f.some((x) => x.group)).toBe(false)),
    ];
    expect(c.document()!.features.map((f) => f.id)).toEqual(before);   // no reorder anywhere
    if (process.env.FOLDER_BASELINE) return;
    for (const ms of times) expect(ms).toBeLessThan(Math.min(LABEL_BUSY_MS, Number(process.env.FOLDER_MAX_MS ?? 1900)));
    // the deferred reference check starts after the session has been idle: for labels the session (kernel main from the commit that
    // adds isCosmeticOp on) does not schedule it at all, an older one runs it and the kernel answers it from the same cache
    calls.length = 0;
    await new Promise((r) => setTimeout(r, 4000));
    const refDiffs = calls.filter((x) => x.type === 'refDiff');
    console.log(`folders: ${refDiffs.length} reference checks after the edits (${refDiffs.map((x) => Math.round(x.ms)).join(', ')} ms)`);
    if ('isCosmeticOp' in sessionModule) expect(refDiffs).toHaveLength(0);
  }, 900_000);
});
