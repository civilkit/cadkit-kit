// Does a direct regen request reuse the cache for an edit of the last feature? (counts, not times) REPRO_DOC=path
import { readFileSync } from 'node:fs';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
const doc = JSON.parse(readFileSync(process.env.REPRO_DOC!, 'utf8'));
const s = await Session.open(doc as PartDoc);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const k = (s as any).kernel;
const ask = async (tag: string, d: unknown) => {
  const t = performance.now();
  const r = await k.request({ type: 'regen', tag: 'probe', part: d, opts: { cacheStats: true } });
  const cs = r.result?.cacheStats;
  console.log(`${tag.padEnd(34)} ${((performance.now() - t) / 1000).toFixed(1).padStart(6)} s  reused ${cs?.reusedFeatures} ran ${cs?.ranFeatures} fullHit ${cs?.fullHit}`);
};
await ask('same document (warm from open)', doc);
const d2 = JSON.parse(JSON.stringify(doc)); d2.features.find((f: { id: string }) => f.id === 'F49').radius = 0.6;
await ask('edit last feature F49', d2);
const d3 = JSON.parse(JSON.stringify(doc)); d3.features.find((f: { id: string }) => f.id === 'F48').radius = 1.9;
await ask('edit F48', d3);
const d4 = JSON.parse(JSON.stringify(doc)); d4.features.find((f: { id: string }) => f.id === 'F42').angle = 359.9;
await ask('edit F42', d4);
await s.close().catch(() => {});
