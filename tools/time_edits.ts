// Time edits on a live session (one kernel instance, as in the GUI): cold open, then edits of the last, a middle and an early feature. REPRO_DOC=path
import { readFileSync } from 'node:fs';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
const doc = JSON.parse(readFileSync(process.env.REPRO_DOC!, 'utf8'));
const s = await Session.open(doc as PartDoc);
const lap = async (tag: string, f: () => Promise<unknown>) => { const t = performance.now(); const r = await f(); console.log(`${tag.padEnd(46)} ${((performance.now() - t) / 1000).toFixed(2)} s`); return r; };
await lap('cold regen (first load)', () => s.regenReport());
await lap('same document again', () => s.regenReport());
const e1 = await lap('edit LAST feature (F49 fillet radius 0.5 -> 0.6)', () => s.edit([{ op: 'set', id: 'F49', path: 'radius', value: 0.6 }]));
await lap('edit F48 fillet radius 2 -> 1.9', () => s.edit([{ op: 'set', id: 'F48', path: 'radius', value: 1.9 }]));
await lap('edit F42 revolve (outer wall) angle 360 -> 359.9', () => s.edit([{ op: 'set', id: 'F42', path: 'angle', value: 359.9 }]).catch((e) => ({ err: String(e) })));
await lap('edit EARLY feature F5 (hole diameter 3.1 -> 3.2)', () => s.edit([{ op: 'set', id: 'F5', path: 'diameter', value: 3.2 }]).catch((e) => ({ err: String(e) })));
console.log('errors after:', JSON.stringify((e1 as { errors?: unknown }).errors ?? 'n/a').slice(0, 200));
await s.close().catch(() => {});
