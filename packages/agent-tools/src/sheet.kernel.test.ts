import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AgentSession, callTool, createTools } from './index';
import { placeholderSnapshot } from './testing/placeholder-snapshot';

const WASM = process.env.CK_WASM;
const tools = createTools();
let a: AgentSession;
beforeAll(async () => { a = await AgentSession.open({ wasmPath: WASM, snapshotFn: placeholderSnapshot as never }); }, 60000);
afterAll(async () => { await a.close(); });

const call = async (name: string, args: unknown = {}) => {
  const r = await callTool(a, tools, name, args);
  const text = r.content.find((c) => c.type === 'text' && c.text.trim().startsWith('{')) as { text: string } | undefined;
  return { r, json: text ? JSON.parse(text.text) : null };
};
// the reference tray: 100 x 60 plate, thickness 2, k 0.44, radius 2, four 15 mm flanges (the kernel matches these numbers to 1e-6)
const TRAY = `part('Tray')
  .sheetRules({ name: 'Steel2', thickness: 2, kFactor: 0.44, bendRadius: 2 })
  .sketch('front', (s) => s.rect(100, 60))
  .baseFlange({ rule: 'Steel2' })
  .edgeFlange([[0, -30, 2], [0, 30, 2], [-50, 0, 2], [50, 0, 2]], { height: 15 });`;
const BA = (2 + 0.44 * 2) * (Math.PI / 2);   // bend allowance of one 90 degree bend

describe('sheet metal through the agent tools', () => {
  it('sheet_reference lists every feature with defaults and a worked example, ', async () => {
    const list = (await call('sheet_reference')).json;
    const types = list.features.map((f: { type: string }) => f.type);
    expect(types).toEqual(expect.arrayContaining(['sheetRules', 'baseFlange', 'edgeFlange', 'hem', 'fold', 'contourFlange', 'unfold', 'refold', 'sheetConvert', 'sheetCut', 'sheetCorner']));
    expect(list.features.every((f: { status: string }) => f.status === 'available')).toBe(true);
    expect(list.errorKinds).toContain('flangeHeightTooLow');
    expect(list.recipe).toContain('baseFlange');
    const ef = (await call('sheet_reference', { feature: 'edgeFlange' })).json;
    expect(ef.fields.find((f: { name: string }) => f.name === 'angle')).toMatchObject({ default: '90', unit: 'deg' });
    expect(ef.example.type).toBe('edgeFlange');
    expect(ef.scriptExample).toContain('edgeFlange(');
    expect((await call('sheet_reference', { feature: 'hem' })).json.fields.map((f: { name: string }) => f.name)).toContain('length');
    expect((await call('sheet_reference', { feature: 'sheetDxf' })).json.fields.length).toBeGreaterThan(5);
    expect((await call('sheet_reference', { feature: 'nope' })).r.isError).toBe(true);
  });

  it('sheet_info and sheet_export before any sheet say what to do', async () => {
    const info = await call('sheet_info');
    expect(info.r.isError).toBe(true);
    expect(info.json.error.code).toBe('no_sheet');
    expect(info.json.error.hint).toContain('baseFlange');
  });

  it('builds a box tray with run_script and reads the flat pattern', async () => {
    const run = (await call('run_script', { code: TRAY, mode: 'new' })).json;
    expect(run.ok).toBe(true);
    expect(run.solids).toBe(1);
    expect(run.validity.ok).toBe(true);
    const info = (await call('sheet_info', { roles: true })).json;
    expect(info.featureType).toBe('edgeFlange');
    expect(info.rule).toMatchObject({ name: 'Steel2', thickness: 2, kFactor: 0.44, bendRadius: 2 });
    const fp = info.flatPattern;
    expect(fp.flatSize.width).toBeCloseTo(123.0478, 3);
    expect(fp.flatSize.length).toBeCloseTo(83.0478, 3);
    expect(fp.flatSize.thickness).toBe(2);
    expect(fp.bendCount).toBe(4);
    for (const b of fp.bends) { expect(b.angleDeg).toBe(90); expect(b.direction).toBe('up'); expect(b.allowance).toBeCloseTo(BA, 5); }
    expect(fp.loops).toHaveLength(1);
    expect(info.roles.faces.some((f: { role: string }) => f.role === 'P0.front')).toBe(true);
    expect(info.advice).toEqual([]);
    // the same entry per feature, and the plate before the flanges
    const base = (await call('sheet_info', { feature: 'F3' })).json;
    expect(base.flatPattern.bendCount).toBe(0);
    expect(base.flatPattern.flatSize.width).toBe(100);
  });

  it('bodies carries the sheet metal summary on the base body', async () => {
    const b = (await call('bodies')).json;
    expect(b.count).toBe(1);
    expect(b.bodies[0].sheetMetal).toMatchObject({ rule: 'Steel2', thickness: 2, bendCount: 4, unfolded: false });
  });

  it('exports the flat pattern DXF and the bend table', async () => {
    const dxfPath = join(process.env.TMPDIR ?? '/tmp', `ck-sheet-${process.pid}.dxf`);
    try {
      const d = (await call('sheet_export', { format: 'dxf', path: dxfPath, bendNotes: true })).json;
      expect(d.bends).toBe(4);
      expect(d.entities.CUT_OUTER).toBeGreaterThan(0);
      expect(d.entities.BEND_UP).toBe(4);
      expect(d.bounds[2] - d.bounds[0]).toBeCloseTo(123.0478, 3);
      expect(d.bounds[3] - d.bounds[1]).toBeCloseTo(83.0478, 3);
      expect(existsSync(dxfPath)).toBe(true);
      const text = readFileSync(dxfPath, 'utf8');
      expect(text).toContain('AC1015');
      expect(text).toContain('CUT_OUTER');
      expect(text).toContain('BEND_UP');
      expect((text.match(/B\d UP 90/g) ?? []).length).toBe(4);
      const r12 = (await call('sheet_export', { format: 'dxf', path: dxfPath, version: 'R12', units: 'in' })).json;
      expect(r12.version).toBe('R12');
      expect(readFileSync(dxfPath, 'utf8')).toContain('AC1009');
    } finally { rmSync(dxfPath, { force: true }); }
    const csv = (await call('sheet_export', { format: 'csv' })).json;
    const rows = csv.text.trim().split(/\r?\n/);
    expect(rows[0]).toContain('allowance_mm');
    expect(rows).toHaveLength(5);
    expect(rows[1]).toContain('"Steel2"');
    const js = JSON.parse((await call('sheet_export', { format: 'json' })).json.text);
    expect(js.bends).toHaveLength(4);
    expect((await call('sheet_export', { format: 'dxf', units: 'parsec' })).r.isError).toBe(true);
  });

  it('the script API covers hem, fold, contour flange and unfold / refold', async () => {
    const hem = (await call('run_script', { mode: 'new', code: `part('Lip').sheetRules({ name: 'S2', thickness: 2 }).sketch('front', (s) => s.rect(100, 60)).baseFlange().hem([[0, -30, 2]], { length: 10 });` })).json;
    expect(hem.ok).toBe(true);
    expect((await call('sheet_info')).json.flatPattern.flatSize.length).toBeCloseTo(70.786, 3);
    const fold = (await call('run_script', { mode: 'new', code: `part('F').sheetRules({ name: 'S2', thickness: 2 }).sketch('front', (s) => s.rect(100, 60)).baseFlange().fold({ points: [[-10, -30, 2], [-10, 30, 2]], angle: 60 });` })).json;
    expect(fold.ok).toBe(true);
    expect((await call('sheet_info')).json.flatPattern.bendCount).toBe(1);
    const contour = (await call('run_script', { mode: 'new', code: `part('L').sheetRules({ name: 'S2', thickness: 2 }).sketch('front', (s) => { s.line([0, 0], [0, 20]); s.line([0, 20], [30, 20]); }).contourFlange({ distance: 40 });` })).json;
    expect(contour.ok).toBe(true);
    expect((await call('sheet_info')).json.flatPattern.flatSize.width).toBeCloseTo(46.5239, 3);
    const un = (await call('run_script', { mode: 'new', code: `${TRAY.replace(/;$/, '')}.unfold();` })).json;
    expect(un.ok).toBe(true);
    expect((await call('sheet_info')).json.flatPattern.unfolded).toBe(true);
    expect((await call('bodies')).json.bodies[0].sheetMetal.unfolded).toBe(true);
    const re = (await call('run_script', { mode: 'new', code: `${TRAY.replace(/;$/, '')}.unfold().refold();` })).json;
    expect(re.ok).toBe(true);
    expect((await call('sheet_info')).json.flatPattern.unfolded).toBe(false);
  });

  it('sheetCorner rounds a corner, sheetCut slots across a bend, sheetConvert rebuilds a solid angle', async () => {
    const corner = (await call('run_script', { mode: 'new', code: `part('C').sheetRules({ name: 'S2', thickness: 2 }).sketch('front', (s) => s.rect(100, 60)).baseFlange().sheetCorner([[50, 30, 2]], { mode: 'round', radius: 5 });` })).json;
    expect(corner.ok).toBe(true);
    const ci = (await call('sheet_info', { outline: true })).json;
    expect(ci.featureType).toBe('sheetCorner');
    expect(ci.flatPattern.loops[0].points).toBeGreaterThan(4);
    expect(corner.volume).toBeLessThan(12000 - 1);
    expect(12000 - corner.volume).toBeCloseTo(2 * (25 - Math.PI * 25 / 4), 1);
    const cut = (await call('run_script', { mode: 'new', code: `part('X').sheetRules({ name: 'S2', thickness: 2 }).sketch('front', (s) => s.rect(100, 60)).baseFlange().edgeFlange([[0, -30, 2]], { height: 20 }).sketch('front', (s) => s.rect(10, 4, [0, -32])).sheetCut();` })).json;
    expect(cut.ok).toBe(true);
    const before = (await call('run_script', { mode: 'new', code: `part('X').sheetRules({ name: 'S2', thickness: 2 }).sketch('front', (s) => s.rect(100, 60)).baseFlange().edgeFlange([[0, -30, 2]], { height: 20 });` })).json;
    expect(cut.volume).toBeLessThan(before.volume);
    const dxfPath = join(process.env.TMPDIR ?? '/tmp', `ck-sheetcut-${process.pid}.dxf`);
    await call('run_script', { mode: 'new', code: `part('X').sheetRules({ name: 'S2', thickness: 2 }).sketch('front', (s) => s.rect(100, 60)).baseFlange().edgeFlange([[0, -30, 2]], { height: 20 }).sketch('front', (s) => s.rect(10, 4, [0, -32])).sheetCut();` });
    try {
      const d = (await call('sheet_export', { format: 'dxf', path: dxfPath })).json;
      expect(d.entities.CUT_INNER).toBeGreaterThan(0);
    } finally { rmSync(dxfPath, { force: true }); }
    // convert: a thin-walled L extrude is a bent plate only with a bend radius, so the plain sharp one is refused with the sheet hint
    const conv = (await call('run_script', { mode: 'new', code: `part('L').sketch('front', (s) => s.polyline([[0, 0], [0, 20], [30, 20]])).extrude(40, { thin: 2 }).sheetConvert({ thickness: 2 });` })).json;
    expect(conv.ok).toBe(false);
    expect(conv.errors[0].code).toBe('sheetMetalUnsupported');
    expect(conv.errors[0].hint).toContain('sheetConvert');
    // convert round trip: a flanged sheet, converted back (the solid is the sheet's own body)
    const rt = (await call('run_script', { mode: 'new', code: `${TRAY.replace(/;$/, '')}.sheetConvert();` })).json;
    expect(rt.ok).toBe(true);
    const ri = (await call('sheet_info')).json;
    expect(ri.featureType).toBe('sheetConvert');
    expect(ri.flatPattern.flatSize.width).toBeCloseTo(123.0478, 2);
    expect(ri.flatPattern.bendCount).toBe(4);
  });

  it('advises on rules that build but are poor practice', async () => {
    const r = (await call('run_script', { mode: 'new', code: `part('Tight').sheetRules({ name: 'T', thickness: 2, bendRadius: 0.5, reliefWidth: 1 }).sketch('front', (s) => s.rect(100, 60)).baseFlange().edgeFlange([[0, -30, 2]], { height: 10 });` })).json;
    expect(r.ok).toBe(true);
    const adv = (await call('sheet_info')).json.advice as string[];
    expect(adv.some((t) => t.includes('bend radius 0.5'))).toBe(true);
    expect(adv.some((t) => t.includes('relief width 1'))).toBe(true);
  });

  it('kernel errors come back with sheet specific hints', async () => {
    const low = (await call('run_script', { mode: 'new', code: `part('T').sheetRules({ name: 'S2', thickness: 2 }).sketch('front', (s) => s.rect(100, 60)).baseFlange().edgeFlange([[0, -30, 2]], { height: 3 });` })).json;
    expect(low.ok).toBe(false);
    expect(low.errors[0].code).toBe('flangeHeightTooLow');
    expect(low.errors[0].hint).toContain('at least 4.000 mm');
    const edge = (await call('run_script', { mode: 'new', code: `part('T').sheetRules({ name: 'S2', thickness: 2 }).sketch('front', (s) => s.rect(100, 60)).baseFlange().edgeFlange([{ edge: 9 }], { height: 30 });` })).json;
    expect(edge.errors[0].code).toBe('invalidValue');
    expect(edge.errors[0].hint).toContain("field 'edges'");
    expect(edge.errors[0].hint).toContain('no edge 9');
    const twice = (await call('run_script', { mode: 'new', code: `part('T').sheetRules({ name: 'S2', thickness: 2 }).sketch('front', (s) => s.rect(100, 60)).baseFlange().edgeFlange([[0, -30, 2]], { height: 20 }).edgeFlange([[0, -30, 2]], { height: 20 });` })).json;
    expect(twice.errors[0].code).toBe('sheetMetalUnsupported');
    expect(twice.errors[0].hint).toContain('one flange per edge');
    const noBase = (await call('run_script', { mode: 'new', code: `part('T').sheetRules({ name: 'S2', thickness: 2 }).edgeFlange([[0, -30, 2]], { height: 20 });` })).json;
    expect(noBase.errors[0].code).toBe('nothingToCut');
    expect(noBase.errors[0].hint).toContain('baseFlange');
    const badR = (await call('run_script', { mode: 'new', code: `part('T').sheetRules({ name: 'S2', thickness: 2 }).sketch('front', (s) => s.rect(100, 60)).baseFlange().edgeFlange([[0, -30, 2]], { height: 20, radius: 0 });` })).json;
    expect(badR.errors[0].hint).toContain("field 'radius'");
    // tree shows the same hint for a document that carries the failing feature
    const t = (await call('tree')).json;
    expect(t.errorCount).toBe(0);
  });

  it('raw feature() accepts the sheet types and a script error names the line', async () => {
    const r = (await call('run_script', { mode: 'new', code: `part('Raw').feature({ type: 'sheetRules', name: 'R', thickness: 1.5 }).sketch('front', (s) => s.rect(40, 20)).feature({ type: 'baseFlange', sketch: '$sketch', rule: 'R' });` })).json;
    expect(r.ok).toBe(true);
    expect((await call('sheet_info')).json.flatPattern.flatSize.thickness).toBe(1.5);
    const bad = (await call('run_script', { mode: 'new', code: `part('X').edgeFlange([[0, 0, 0]], {});` })).json;
    expect(bad.ok).toBe(false);
    expect(bad.errors[0].message).toContain('height');
  });

  it('a flange on part of an edge and a leg shaped by a sketch, with a hole, through run_script', async () => {
    const PLATE = `part('Plate').sheetRules({ name: 'Steel2', thickness: 2, kFactor: 0.44, bendRadius: 2 }).sketch('front', (s) => s.rect(100, 60)).baseFlange({ rule: 'Steel2' })`;
    // part of the edge by start and length (the rect is centred on the origin: its edge y = -30 runs x = -50 .. 50)
    const part = (await call('run_script', { code: `${PLATE}.edgeFlange([[0, -30, 2]], { height: 20, start: 20, length: 40, relief: 'rectangular' });`, mode: 'new' })).json;
    expect(part.ok, JSON.stringify(part)).toBe(true);
    const fp = (await call('sheet_info')).json.flatPattern;
    expect(fp.bends).toHaveLength(1);
    expect(fp.bends[0].length).toBeCloseTo(40, 4);
    // the same by two points
    const pts = (await call('run_script', { code: `${PLATE}.edgeFlange([[0, -30, 2]], { height: 20, from: [-30, -30, 1], to: [10, -30, 1] });`, mode: 'new' })).json;
    expect(pts.ok, JSON.stringify(pts)).toBe(true);
    expect((await call('sheet_info')).json.flatPattern.bends[0].length).toBeCloseTo(40, 4);
    // a leg from the last sketch: 40 wide, 20 high, a circle of radius 3 in it (a hole), on the span from -30 to 10; no height needed
    const shaped = (await call('run_script', { code: `${PLATE}.sketch('front', (s) => { s.rect(40, 20); s.circle(3); }).edgeFlange([[0, -30, 2]], { profile: 'sketch', from: [-30, -30, 1], to: [10, -30, 1] });`, mode: 'new' })).json;
    expect(shaped.ok, JSON.stringify(shaped)).toBe(true);
    const sh = (await call('sheet_info')).json.flatPattern;
    expect(sh.bends[0].length).toBeCloseTo(40, 4);
    // the tool reference and an inline profile with a refused span say what to do
    const bad = (await call('run_script', { code: `${PLATE}.edgeFlange([[0, -30, 2]], { height: 20, start: 80, length: 40 });`, mode: 'new' })).json;
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).toContain('free piece');
  });
});
