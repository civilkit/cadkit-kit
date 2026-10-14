import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { drawingQuery, holeInfos } from './kernel';
import { emptyDrawing, sheetSize } from './model';
import { standardViews, addSection, addDetail, addAux, addProjected } from './layout';
import { autoDims } from './geom';
import { renderSheet, toSvg, dataOf } from './render';
import { toPdf, toDxf } from './output';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const sample = (n: string) => JSON.parse(readFileSync(`${process.cwd()}/apps/cad/public/samples/${n}.ckpart`, 'utf8')) as PartDoc & { features: Array<Record<string, unknown>> };
async function open(doc: PartDoc) { const s = await Session.open(doc); sessions.push(s); return s; }
const OUT = process.env.DWG_OUT;

describe('drawing against the kernel', () => {
  it('mounting plate: standard views, dimensions, section, outputs', async () => {
    const part = sample('mounting-plate');
    const s = await open(part);
    const q = drawingQuery(s);
    let doc = emptyDrawing('Mounting plate', 'steel');
    const r = await standardViews(doc, q);
    doc = r.doc; const data = r.data;
    expect(doc.views.map((v) => v.label)).toEqual(['Front', 'Top', 'Right', 'Isometric']);
    expect(Object.keys(data).length).toBe(4);
    const front = doc.views[0];
    const [sw, sh] = sheetSize(doc.sheet);
    for (const v of doc.views) { expect(v.pos[0]).toBeGreaterThan(0); expect(v.pos[0]).toBeLessThan(sw); expect(v.pos[1]).toBeLessThan(sh); }
    // holes from the features
    const holes = holeInfos(part.features as never);
    expect(holes.length).toBeGreaterThan(0);
    const dims = doc.views.slice(0, 3).flatMap((v) => autoDims(data[v.id]!, v, holes));
    expect(dims.some((d) => d.kind === 'linear')).toBe(true);
    expect(dims.some((d) => d.kind === 'callout' || d.kind === 'diameter')).toBe(true);
    doc = { ...doc, dims };
    const sec = await addSection(doc, q, data, front.id, 'v', 0);
    expect(sec).not.toBeNull();
    doc = sec!.doc; Object.assign(data, sec!.data);
    expect(sec!.data[sec!.view.id].lines.some((l) => l.k === 'h')).toBe(true);
    const d = addDetail(doc, front.id, [20, 15], 8, undefined, data);
    doc = d!.doc;
    const prims = renderSheet({ doc, data, callout: (f) => holes.find((h) => h.feature === f)?.text ?? null });
    const svg = toSvg(prims, sheetSize(doc.sheet));
    expect(svg).toContain('SECTION A-A');
    const pdf = toPdf(prims, sheetSize(doc.sheet));
    expect(new TextDecoder().decode(pdf.subarray(0, 8))).toBe('%PDF-1.4');
    expect(toDxf(prims, sheetSize(doc.sheet))).toContain('ENTITIES');
    if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/plate.svg`, svg); writeFileSync(`${OUT}/plate.pdf`, pdf); writeFileSync(`${OUT}/plate.dxf`, toDxf(prims, sheetSize(doc.sheet))); writeFileSync(`${OUT}/plate.json`, JSON.stringify(doc)); }
  }, 60000);

  it('threaded bolt: thread callouts and auxiliary / projected views', async () => {
    const part = sample('threaded-bolt');
    const s = await open(part);
    const q = drawingQuery(s);
    const r = await standardViews(emptyDrawing('Bolt', 'steel'), q);
    let doc = r.doc; const data = r.data;
    const pitch = (_: string, size: string) => (size === 'M10' ? 1.5 : size === 'M8' ? 1.25 : null);
    const holes = holeInfos(part.features as never, pitch);
    expect(holes.map((h) => h.text).join('|')).toMatch(/M10x1\.5/);
    expect(holes.map((h) => h.text).join('|')).toMatch(/M8x1\.25/);
    doc = { ...doc, dims: doc.views.slice(0, 3).flatMap((v) => autoDims(data[v.id]!, v, holes)) };
    const a = await addAux(doc, q, data, doc.views[0].id, 0.6);
    expect(a).not.toBeNull();
    const p = await addProjected(a!.doc, q, doc.views[0].id, 'left', [30, 100]);
    expect(p).not.toBeNull();
    doc = p!.doc; Object.assign(data, a!.data, p!.data);
    const prims = renderSheet({ doc, data, callout: (f) => holes.find((h) => h.feature === f)?.text ?? null });
    if (OUT) writeFileSync(`${OUT}/bolt.svg`, toSvg(prims, sheetSize(doc.sheet)));
    expect(dataOf({ doc, data }, doc.views[0])).toBeTruthy();
  }, 60000);
});
