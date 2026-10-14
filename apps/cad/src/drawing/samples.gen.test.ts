// Writes the sample drawings into the sample parts (`drawing` field). Run only on purpose:
//   DWG_SAMPLES=1 CK_WASM=... npx vitest run apps/cad/src/drawing/samples.gen.test.ts
import { describe, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { drawingQuery, holeInfos } from './kernel';
import { emptyDrawing, type DrawingDoc, type V2 } from './model';
import { addSection, standardViews } from './layout';
import { autoDims } from './geom';
import { densityOf, massText, massView } from '../inspect/mass';
import { sessionQuery } from '../inspect/kernel';

const on = process.env.DWG_SAMPLES ? describe : describe.skip;
const PITCH: Record<string, number> = { 'metric|M10': 1.5, 'metric|M8': 1.25 };

async function make(file: string, title: string, partNo: string, notes: Array<{ text: string; pos: V2 }>, section?: { view: string; dir: 'v' | 'h'; at: number | 'axis' }) {
  const path = `${process.cwd()}/apps/cad/public/samples/${file}.ckpart`;
  const part = JSON.parse(readFileSync(path, 'utf8')) as PartDoc & { drawing?: DrawingDoc; features: Array<Record<string, unknown>>; material?: string };
  delete part.drawing;
  const s = await Session.open(part);
  try {
    const q = drawingQuery(s);
    const mass = await sessionQuery<never>(s, { type: 'massProps' });
    const dens = densityOf(part.material);
    let doc = emptyDrawing(title, part.material ?? '');
    doc.title = { ...doc.title, partNo, author: 'Kit', date: '2026-10-15', mass: mass && dens !== null ? massText(massView(mass, dens).mass) : '' };
    const r = await standardViews(doc, q);
    doc = r.doc; const data = { ...r.data };
    const holes = holeInfos(part.features as never, (std, size) => PITCH[`${std}|${size}`] ?? null);
    doc = { ...doc, dims: doc.views.filter((v) => v.label !== 'Isometric').flatMap((v) => autoDims(data[v.id]!, v, holes)) };
    if (section) {
      const front = doc.views.find((v) => v.label === section.view)!;
      const axis = doc.dims.find((d) => d.kind === 'callout' && d.r !== undefined)?.a[0] ?? 0;
      const sec = await addSection(doc, q, data, front.id, section.dir, section.at === 'axis' ? axis : section.at);
      if (sec) { doc = sec.doc; Object.assign(data, sec.data); }
    }
    doc.notes = notes.map((n, i) => ({ id: `N${i + 1}`, text: n.text, pos: n.pos }));
    part.drawing = doc;
    writeFileSync(path, JSON.stringify(part, null, 1) + '\n');
  } finally { await s.close(); }
}

on('sample drawings', () => {
  it('mounting plate', async () => { await make('mounting-plate', 'Mounting plate', 'MP-001', [{ text: 'MATERIAL: STEEL', pos: [25, 255] }, { text: 'BREAK SHARP EDGES 0.2 MAX', pos: [25, 261] }], { view: 'Front', dir: 'v', at: 0 }); }, 60000);
  it('threaded bolt', async () => { await make('threaded-bolt', 'Threaded bolt and tapped block', 'TB-010', [{ text: 'THREAD M10x1.5 6g', pos: [25, 255] }], { view: 'Front', dir: 'v', at: 'axis' }); }, 60000);
});
