import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { readFileSync, readdirSync } from 'node:fs';
import '../i18n';
import { drawingStrings } from '../locales/drawing';
import { DrawingWorkspace, type DrawingHost } from './DrawingWorkspace';
import { emptyDrawing, type DrawingDoc } from './model';

afterEach(cleanup);

const box = (w: number, h: number) => ({
  min: [0, 0] as [number, number], max: [w, h] as [number, number],
  lines: [[0, 0, w, 0], [w, 0, w, h], [w, h, 0, h], [0, h, 0, 0]].map((p, i) => ({ k: 'e' as const, v: true, p, e: i })),
  edges: [0, 1, 2, 3].map((i) => ({ faces: [`F2.A${i}`, `F2.B${i}`], at: [i, i, 0], mid: [0, 0], ends: [[0, 0], [1, 1]] })),
});
const host = (over: Partial<DrawingHost> = {}): DrawingHost => ({
  partName: 'Plate', material: 'steel', stored: undefined, features: [], revision: 'r1', hasBody: true,
  query: async (views) => views.map(() => box(60, 40)),
  pitches: async () => ({}), mass: async () => 142.6, bom: async () => [],
  onChange: () => {}, save: async () => {}, notify: () => {}, close: () => {}, ...over,
});

describe('DrawingWorkspace', () => {
  it('starts from the part: title and material in the title block, no views, the sheet panel', () => {
    render(<DrawingWorkspace host={host()} />);
    expect((document.querySelector('input[data-field=title]') as HTMLInputElement).value).toBe('Plate');
    expect((document.querySelector('input[data-field=material]') as HTMLInputElement).value).toBe('steel');
    expect(screen.getByText('The sheet has no views yet.')).toBeTruthy();
  });
  it('Standard views fills the sheet and reports the drawing to the host', async () => {
    const onChange = vi.fn();
    render(<DrawingWorkspace host={host({ onChange })} />);
    fireEvent.click(screen.getByText('Standard views'));
    await waitFor(() => expect(document.querySelector('.dwg-sheet svg')?.innerHTML).toContain('FRONT'));
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as DrawingDoc;
    expect(last.views.map((v) => v.label)).toEqual(['Front', 'Top', 'Right', 'Isometric']);
    expect(last.dims.length).toBeGreaterThan(0);
  });
  it('a stored drawing is shown again, and an edited title block field is saved', async () => {
    const onChange = vi.fn();
    const stored = { ...emptyDrawing('Plate'), title: { ...emptyDrawing('Plate').title, partNo: 'MP-1' } };
    render(<DrawingWorkspace host={host({ onChange, stored })} />);
    const f = document.querySelector('input[data-field=partNo]') as HTMLInputElement;
    expect(f.value).toBe('MP-1');
    fireEvent.input(f, { target: { value: 'MP-2' } });
    expect((onChange.mock.calls[onChange.mock.calls.length - 1][0] as DrawingDoc).title.partNo).toBe('MP-2');
    fireEvent.change(document.querySelector('.dwg-props select') as HTMLSelectElement, { target: { value: 'A4' } });
    const d = onChange.mock.calls[onChange.mock.calls.length - 1][0] as DrawingDoc;
    expect(d.sheet.size).toBe('A4');
    await waitFor(() => expect(document.querySelector('.dwg-sheet svg')?.getAttribute('viewBox')).toBe('0 0 297 210'));
  });
  it('with no body the view tools say so instead of calling the kernel', async () => {
    const notify = vi.fn(); const query = vi.fn();
    render(<DrawingWorkspace host={host({ hasBody: false, notify, query })} />);
    expect((screen.getByText('Standard views') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Auto dimension'));
    expect(query).not.toHaveBeenCalled();
  });
});

describe('drawing strings', () => {
  it('every key used by the drawing code exists', () => {
    const dir = `${process.cwd()}/apps/cad/src/drawing`;
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /\.tsx?$/.test(x) && !/\.test\./.test(x))) {
      const text = readFileSync(`${dir}/${f}`, 'utf8');
      for (const m of text.matchAll(/\bt\('([A-Za-z0-9_.-]+)'/g)) if (!(m[1] in drawingStrings) && !(m[1] in (globalThis as never))) bad.push(`${f}: ${m[1]}`);
      for (const m of text.matchAll(/t\('(drawing\.(?:field|kind|sheet)\.)' \+/g)) void m;
    }
    expect(bad.filter((b) => !b.endsWith('.') && !/'drawing\.(field|kind)\.'/.test(b))).toEqual([]);
    for (const k of ['title', 'partNo', 'material', 'author', 'date', 'revision', 'mass', 'company']) expect(drawingStrings['drawing.field.' + k]).toBeTruthy();
    for (const k of ['std', 'proj', 'section', 'detail', 'aux']) expect(drawingStrings['drawing.kind.' + k]).toBeTruthy();
  });
});
