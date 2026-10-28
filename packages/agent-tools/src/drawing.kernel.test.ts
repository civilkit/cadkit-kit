import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentSession, callTool, createTools } from './index';
import { placeholderSnapshot } from './testing/placeholder-snapshot';

const tools = createTools();
let a: AgentSession;
beforeAll(async () => { a = await AgentSession.open({ wasmPath: process.env.CK_WASM, snapshotFn: placeholderSnapshot as never }); }, 60000);
afterAll(async () => { await a.close(); });
const call = async (name: string, args: unknown = {}) => {
  const r = await callTool(a, tools, name, args);
  const text = r.content.find((c) => c.type === 'text' && c.text.trim().startsWith('{')) as { text: string } | undefined;
  return { r, json: text ? JSON.parse(text.text) : null };
};

const PLATE = `part('Plate').sketch('front', (s) => s.rect(80, 50)).extrude(10)
  .sketch(face('>Z'), (s) => s.circle(20, [0, 0])).cut(through())
  .holes.points(face('>Z'), [[-30, -18], [30, -18], [-30, 18], [30, 18]], { size: 'M2.5', kind: 'tapped', depth: 4 });`;

describe('drawing tool', () => {
  it('fails clearly on an empty document', async () => {
    const { r, json } = await call('drawing', {});
    expect(r.isError).toBe(true);
    expect(json.error.code).toBe('no_body');
  });

  it('draws views, dimensions, hole callouts and a section; writes PDF / DXF / SVG; the PDF prints DEPTH, not the glyph', async () => {
    expect((await call('run_script', { code: PLATE, mode: 'new' })).json.ok).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), 'ckdrawing-'));
    const { r, json } = await call('drawing', { views: ['front', 'top', 'right', 'iso'], sheet: 'A3', section: true, path: join(dir, 'plate') });
    expect(r.isError).toBeFalsy();
    expect(json.views).toEqual(['Front', 'Top', 'Right', 'Isometric', 'Section']);
    expect(json.section).toBe(true);
    expect(json.dimensions).toBeGreaterThan(3);
    expect(json.callouts.length).toBeGreaterThan(0);
    expect(json.callouts.join(' ')).toMatch(/M2\.5/);
    expect(json.written.map((w: { path: string }) => w.path.split('.').pop()).sort()).toEqual(['dxf', 'pdf', 'svg']);
    for (const w of json.written) { expect(existsSync(w.path)).toBe(true); expect(w.bytes).toBeGreaterThan(500); }
    const pdf = Buffer.from(readFileSync(join(dir, 'plate.pdf'))).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('DEPTH');
    expect(pdf).not.toContain('↧');
    expect(readFileSync(join(dir, 'plate.dxf'), 'utf8')).toContain('ENTITIES');
    expect(readFileSync(join(dir, 'plate.svg'), 'utf8')).toContain('SECTION A-A');
    expect(json.svg).toBeUndefined();   // a path was given: the SVG text is not repeated in the result
  });

  it('returns the SVG when no path is given; options: scale, hidden lines, first angle, dimensions off', async () => {
    const { json } = await call('drawing', { views: ['front', 'top'], sheet: 'A4', scale: '1:2', projection: 'first', dimensions: false, hidden: true });
    expect(json.svg).toContain('<svg');
    expect(json.scale).toBe('1:2');
    expect(json.dimensions).toBe(0);
    expect(json.sheet).toContain('A4');
  });

  it('tidy: callout leaders point away from the view centre and tiny diameters are dropped', async () => {
    const { tidyDims } = await import('@kit/cad-drawing');
    const g = { min: [0, 0], max: [100, 60], lines: [], edges: [] } as never;
    const dims = [
      { id: 'D1', view: 'V1', kind: 'callout', a: [90, 30], r: 2, offset: 14, angle: 0.7 },
      { id: 'D2', view: 'V1', kind: 'diameter', a: [50, 30], r: 3, offset: 14 },
      { id: 'D3', view: 'V1', kind: 'diameter', a: [50, 30], r: 20, offset: 14 },
    ] as never;
    const out = tidyDims(dims, g, 10);
    expect(out.map((d) => d.id)).toEqual(['D1', 'D3']);
    expect(out[0].angle).toBeCloseTo(0, 6);   // to the right of the centre (50, 30): straight out
    expect(out[0].offset).toBe(12);
  });

  it('rejects a bad view list or sheet with a clear message', async () => {
    const bad = await call('drawing', { views: ['top'] });
    expect(bad.r.isError).toBe(true);
    expect(bad.json.error.message).toMatch(/first view must be 'front'/);
    const bad2 = await call('drawing', { sheet: 'A9' });
    expect(bad2.r.isError).toBe(true);
  });
});
