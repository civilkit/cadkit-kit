// The frame drawing: numbering shared between the balloons and the table rows, table blocks, headless PDF, tables as CSV.
import { describe, expect, it } from 'vitest';
import type { ViewData } from '../drawing/model';
import { toCsv, type FrameReport } from './frameLib';
import { sanitizeDrawing } from '../drawing/model';
import { tablesCsv } from '../drawing/output';
import { TABLE_BOM, TABLE_CUT, drawingPdf, facePrefix, frameDrawing, memberAnchor, refreshTables, sheetModel } from './frameDrawing';

const member = (k: number, length: number, angles: [number, number], profile = 'shs-40x40x2') =>
  ({ segment: 'e' + k, body: `F2 M${k}`, profile, label: '', length, angles, ends: ['mitre', 'mitre'] as [string, string], volume: 304 * length });
// a 600 x 400 rectangle: two long and two short pieces (two cut-list rows, qty 2 each) plus one 300 mm post of another size
const frames: FrameReport[] = [{ id: 'F2', members: [
  member(1, 640, [45, 45]), member(2, 440, [45, 45]), member(3, 640, [45, 45]), member(4, 440, [45, 45]), member(5, 300, [0, 0], 'tslot-2020'),
] }];

/** A fake kernel reply: every member is a bar drawn as one visible edge, laid side by side in view coordinates. */
const fakeQuery = async (views: Array<Record<string, unknown>>): Promise<ViewData[]> => views.map(() => {
  const edges: ViewData['edges'] = [], lines: ViewData['lines'] = [];
  for (let k = 1; k <= 5; k++) {
    edges.push({ faces: [`F2.M${k}.side`, `F2.M${k}.top`], at: [0, 0, 0], mid: [0, 0], ends: [] });
    lines.push({ k: 'e', v: true, e: k - 1, p: [k * 100, 0, k * 100, 80 + k * 10] });
  }
  return { min: [0, 0], max: [600, 150], lines, edges };
});

describe('sheet model', () => {
  it('numbers each piece by its cut-list row and counts agree', () => {
    const m = sheetModel(frames);
    expect(m.cut.map((r) => [r[0], r[2], r[3], r[4]])).toEqual([['1', '640', '45 / 45', '2'], ['2', '440', '45 / 45', '2'], ['3', '300', '0 / 0', '1']]);
    expect(m.cut.map((r) => r[1])).toEqual(['SHS 40 x 40 x 2', 'SHS 40 x 40 x 2', 'T-slot 20 x 20']);
    expect(m.rowOf.get('F2 M1')).toBe(m.rowOf.get('F2 M3'));
    expect(m.rowOf.get('F2 M2')).toBe(m.rowOf.get('F2 M4'));
    expect(new Set([...m.rowOf.values()]).size).toBe(m.cut.length);
    expect(m.pieces).toBe(5);
    expect(m.cut.reduce((s, r) => s + Number(r[4]), 0)).toBe(m.pieces);
    expect(m.bom.length).toBeGreaterThan(0);
  });
  it('finds a member by its face prefix and ignores hidden edges', () => {
    expect(facePrefix('F2 M3')).toBe('F2.M3.');
    const g: ViewData = { min: [0, 0], max: [1, 1], edges: [{ faces: ['F2.M3.a'], at: [], mid: [], ends: [] }], lines: [{ k: 'e', v: false, e: 0, p: [0, 0, 10, 0] }] };
    expect(memberAnchor(g, 'F2 M3')).toBeNull();
    g.lines[0].v = true;
    expect(memberAnchor(g, 'F2 M3')).toEqual([5, 0]);
    expect(memberAnchor(g, 'F2 M1')).toBeNull();
  });
});

describe('frame drawing', () => {
  it('has balloons whose numbers match the cut-list rows, in every view, one per piece', async () => {
    const sh = Object.assign(await frameDrawing(frames, fakeQuery, { name: 'Test frame', date: '2026-11-07' }), {});
    expect(sh.doc.views.map((v) => v.label)).toEqual(['Isometric', 'Front', 'Top']);
    const rows = sh.model.rowOf;
    for (const v of sh.doc.views) {
      const bs = sh.doc.balloons.filter((b) => b.view === v.id);
      expect(bs).toHaveLength(5);
      const counts = new Map<number, number>();
      bs.forEach((b) => counts.set(b.n, (counts.get(b.n) ?? 0) + 1));
      // a row of qty q shows q balloons numbered with its row
      expect([...counts].sort()).toEqual(sh.model.cut.map((r) => [Number(r[0]), Number(r[4])]).sort());
    }
    expect(new Set([...rows.values()])).toEqual(new Set(sh.doc.balloons.map((b) => b.n)));
  });
  it('writes a valid PDF with the tables, the title block and the balloon numbers', async () => {
    const sh = Object.assign(await frameDrawing(frames, fakeQuery, { name: 'Test frame', date: '2026-11-07' }), {});
    const bytes = drawingPdf(sh.doc, sh.data).pdf;
    const txt = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    expect(bytes.length).toBeGreaterThan(1500);
    expect(txt.startsWith('%PDF-1.4')).toBe(true);
    expect(txt.trimEnd().endsWith('%%EOF')).toBe(true);
    // xref offsets point at "n 0 obj"
    const xref = Number(/startxref\n(\d+)/.exec(txt)![1]);
    expect(txt.slice(xref, xref + 4)).toBe('xref');
    const offs = [...txt.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    offs.forEach((o, i) => expect(txt.slice(o, o + 8)).toBe(`${i + 1} 0 obj\n`));
    for (const s of ['(Test frame)', '(2026-11-07)', '(Cut list)', '(Bill of materials)', '(Profile)', '(Length \\(mm\\))', '(640)', '(45 / 45)', '(UNITS: MM)', '(ISOMETRIC', '(FRONT', '(TOP']) expect(txt, s).toContain(s);
    expect(txt).toContain('(SHS 40 x 40 x 2)');
    expect(txt).toContain('(T-slot 20 x 20)');
  });
  it('without a kernel view it still makes the tables', async () => {
    const sh = await frameDrawing(frames, null, { name: 'x' });
    expect(sh.doc.balloons).toHaveLength(0);
    expect(Array.from(drawingPdf(sh.doc, sh.data).pdf, (b) => String.fromCharCode(b)).join('')).toContain('(Cut list)');
  });
  it('moves to a bigger sheet when there are many rows', async () => {
    const many: FrameReport[] = [{ id: 'F2', members: Array.from({ length: 60 }, (_, i) => member(i + 1, 100 + i, [0, 0])) }];
    expect((await frameDrawing(many, null)).doc.sheet.size).not.toBe('A3');
  });
});

describe('csv still has the same rows as the sheet', () => {
  it('lists one row per cut-list line', () => {
    const lines = toCsv(frames).trim().split('\r\n');
    const m = sheetModel(frames);
    expect(lines.slice(1, 1 + m.cut.length).map((l) => l.split(',')[0])).toEqual(m.cut.map((r) => r[0]));
    expect(lines[1]).toContain('640,45,45,2');
  });
});

describe('drawing content', () => {
  it('holds the cut list and BOM as table blocks that survive a save / load, and exports as CSV', async () => {
    const { doc, model } = await frameDrawing(frames, fakeQuery, { name: 'T' });
    expect(doc.tables?.map((x) => x.id)).toEqual([TABLE_CUT, TABLE_BOM]);
    expect(doc.tables![0].rows).toEqual(model.cut);
    expect(doc.tables![1].rows).toEqual(model.bom);
    const back = sanitizeDrawing(JSON.parse(JSON.stringify(doc)));
    expect(back.tables).toEqual(doc.tables);
    expect(back.balloons).toHaveLength(15);
    const csv = tablesCsv(doc.tables!).trim().split('\r\n');
    expect(csv[1]).toBe(['#', ...model.head.slice(1)].map((c) => (/[",]/.test(c) ? `"${c}"` : c)).join(','));
    expect(csv[2].split(',')[0]).toBe('1');
  });
  it('refreshing keeps a sheet the user has and replaces only the frame tables', async () => {
    const { doc } = await frameDrawing(frames, null, { name: 'T' });
    const mine = { ...doc, tables: [{ id: 'mine', x: 1, y: 1, cols: [10], head: ['a'], rows: [] }, { ...doc.tables![0], rows: [] }], notes: [{ id: 'N1', text: 'hi', pos: [1, 1] as [number, number] }] };
    const r = refreshTables(mine, doc);
    expect(r.tables?.map((x) => x.id)).toEqual(['mine', TABLE_CUT, TABLE_BOM]);
    expect(r.tables![1].rows.length).toBe(3);
    expect(r.notes).toHaveLength(1);
  });
});
