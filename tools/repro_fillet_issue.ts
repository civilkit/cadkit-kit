// Scratch repro for the hand-test document ~/Downloads/fillet_issue.ckpart (REPRO_DOC=path): lists edges near the pipe foot and tries fillets.
import { readFileSync } from 'node:fs';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../apps/cad/src/controller';

const doc = JSON.parse(readFileSync(process.env.REPRO_DOC!, 'utf8'));
const sessions: Session[] = [];
async function open(d: unknown) {
  const store = createStore();
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const c = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(d as PartDoc);
  return c;
}
async function report(tag: string, d: unknown) {
  const s = await Session.open(d as PartDoc); sessions.push(s);
  const errs = (await s.regenReport()).errors.map((e) => JSON.stringify(e).slice(0, 220));
  const v = await s.validate(); const mp = (await s.massProps()) as { volume: number };
  console.log(`${tag}: errors=${JSON.stringify(errs)} valid=${v.ok} issues=${v.issues.length} volume=${mp.volume.toFixed(3)}`);
}
const c = await open(doc);
await report('original', doc);
const edges = c.bodyEdges() ?? [];
for (const e of edges as Array<{ key?: string; pts?: number[][] }>) {
  const p = e.pts?.[0]; if (!p) continue;
  const r = Math.hypot(p[0], p[2]);
  const q = e.pts![e.pts!.length - 1]; if (p[1] < 8 && r < 20 && r > 9) console.log('edge', e.key, 'start', p.map((x) => +x.toFixed(2)).join(','), 'end', q.map((x) => +x.toFixed(2)).join(','), 'n', e.pts!.length);
}
for (const [tag, at] of [] as Array<[string, number[]]>) {
  for (const R of [1, 2]) {
    const d = JSON.parse(JSON.stringify(doc));
    d.features.push({ type: 'fillet', id: 'F99', radius: R, edges: [{ faces: ['F10.W0', 'F9.S.e1~2'], at }] });
    await report(`${tag} R${R}`, d);
  }
}
for (const s of sessions) await s.close().catch(() => {});
