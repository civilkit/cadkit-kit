import { describe, expect, it, vi } from 'vitest';
import { resolveLayout, type Command } from '@kit/ui';
import type { EditOp } from '@ck/session';
import type { Ctx } from '../featureCommands';
import { RIBBON_LAYOUT, MODEL_COMMANDS, RAIL_SECTIONS, idleDuringEdit } from '../toolbarModel';
import { buildCommands } from '../commands';
import { fullActions } from '../testActions';
import { SHEET_COMMANDS, SHEET_TAB, cornerPicks, cutSketch, foldLine, registerSheetCommand, rulesTarget, sheetCommands, sheetReady, type SheetActions, type SheetCommandDef } from './sheetCommands';
import '../i18n';

const line = (id: string) => ({ id, type: 'line' });
const closed = { type: 'sketch', id: 'S1', entities: [line('e1'), line('e2'), line('e3'), line('e4')].map((e, i) => ({ ...e, p1: 'p' + i, p2: 'p' + ((i + 1) % 4) })) };
const open = { type: 'sketch', id: 'S3', entities: [{ id: 'l1', type: 'line', p1: 'a', p2: 'b' }, { id: 'l2', type: 'line', p1: 'b', p2: 'c' }] };
const fold = { type: 'sketch', id: 'S2', entities: [{ id: 'f1', type: 'line', p1: 'a', p2: 'b' }] };
const ctx = (features: unknown[], over: Partial<Ctx> = {}): Ctx => ({ doc: { features } as never, selection: [], mode: 'face', box: null, edges: [], ...over });
const sheet = [closed, { type: 'sheetRules', id: 'R1', name: 'Steel2', thickness: 3 }, { type: 'baseFlange', id: 'B1', sketch: 'S1' }];
const edge = { key: 'A|B#0', faces: ['A', 'B'], mid: [50, 0, 3] };

const actions = (c: Ctx): SheetActions & { calls: Record<string, unknown[][]> } => {
  const calls: Record<string, unknown[][]> = {};
  const rec = (k: string) => (...a: unknown[]) => { (calls[k] ??= []).push(a); };
  return { context: () => c, create: rec('create'), apply: rec('apply'), edit: rec('edit'), notify: rec('notify'), flatView: rec('flatView'), exportDxf: rec('exportDxf'), exportBends: rec('exportBends'), calls };
};
const make = (c: Ctx) => { const a = actions(c); const cmds = sheetCommands(a); return { a, cmd: (id: string) => cmds.find((x) => x.id === id)! }; };

describe('sheet commands', () => {
  it('are on the Sheet tab in the four groups of the ribbon', () => {
    const cmds = sheetCommands(actions(ctx([])));
    expect(new Set(cmds.map((c) => c.tab))).toEqual(new Set([SHEET_TAB]));
    expect(new Set(cmds.map((c) => c.id)).size).toBe(cmds.length);
    expect(RIBBON_LAYOUT.Sheet.map((g) => g.id)).toEqual(['Rules', 'Create', 'Flatten', 'FlatExport']);
    const placed = RIBBON_LAYOUT.Sheet.flatMap((g) => g.entries).map(String);
    for (const c of cmds) expect(placed).toContain(c.id);                      // nothing falls back to an unplaced slot
    expect(RIBBON_LAYOUT.Sheet.find((g) => g.id === 'Create')!.entries).toEqual(['add-base-flange', 'add-edge-flange', 'add-contour-flange', 'add-sheet-convert', 'add-hem', 'add-fold', 'add-sheet-cut', 'add-sheet-corner']);
    expect(RIBBON_LAYOUT.Sheet.find((g) => g.id === 'Flatten')!.entries).toEqual(['sheet-unfold', 'sheet-refold', 'sheet-flat']);
  });
  it('are in the command search with translated names', () => {
    const all = buildCommands(fullActions());
    for (const id of ['sheet-rules', 'add-base-flange', 'add-edge-flange', 'add-contour-flange', 'add-sheet-convert', 'add-sheet-cut', 'add-sheet-corner', 'add-hem', 'add-fold', 'sheet-unfold', 'sheet-refold', 'sheet-flat', 'sheet-dxf', 'sheet-bends-csv', 'sheet-bends-json']) {
      const c = all.find((x) => x.id === id);
      expect(c, id).toBeTruthy();
      expect(c!.label).not.toMatch(/^cmd\./);
    }
    expect(all.find((c) => c.id === 'add-edge-flange')!.label).toBe('Edge flange');
  });
  it('the model commands are greyed during an edit, but the flat view and the exports are not', () => {
    for (const id of ['sheet-rules', 'add-base-flange', 'add-edge-flange', 'add-hem', 'add-fold', 'add-sheet-convert', 'add-sheet-cut', 'add-sheet-corner', 'sheet-unfold', 'sheet-refold']) expect(idleDuringEdit(id), id).toBe(true);
    for (const id of ['sheet-flat', 'sheet-dxf', 'sheet-bends-csv', 'sheet-bends-json']) expect(MODEL_COMMANDS.has(id), id).toBe(false);
    expect(RAIL_SECTIONS.find((s) => s.id === 'sheet')).toBeTruthy();
  });
  it('a base flange needs a closed sketch and no plate yet; it adds the default rule when the part has none', () => {
    const none = make(ctx([]));
    expect(none.cmd('add-base-flange').enabled?.()).toBe(false);
    expect(none.cmd('add-base-flange').why?.()).toMatch(/closed sketch/i);
    const m = make(ctx([closed]));
    expect(m.cmd('add-base-flange').enabled?.()).toBe(true);
    m.cmd('add-base-flange').run();
    const ops = m.a.calls.create[0][0] as EditOp[];
    expect(ops.map((o) => (o as unknown as { feature: { type: string } }).feature.type)).toEqual(['sheetRules', 'baseFlange']);
    expect((ops[1] as { feature: Record<string, unknown> }).feature).toEqual({ type: 'baseFlange', sketch: 'S1' });
    const withRule = make(ctx([closed, { type: 'sheetRules', id: 'R1', name: 'A' }]));
    withRule.cmd('add-base-flange').run();
    expect((withRule.a.calls.create[0][0] as EditOp[]).length).toBe(1);
    const done = make(ctx(sheet));
    expect(done.cmd('add-base-flange').enabled?.()).toBe(false);
    expect(done.cmd('add-base-flange').why?.()).toMatch(/already/i);
  });
  it('a contour flange needs an open chain', () => {
    expect(make(ctx([closed])).cmd('add-contour-flange').enabled?.()).toBe(false);
    const m = make(ctx([open]));
    expect(m.cmd('add-contour-flange').enabled?.()).toBe(true);
    m.cmd('add-contour-flange').run();
    const ops = m.a.calls.create[0][0] as Array<{ feature: Record<string, unknown> }>;
    expect(ops.at(-1)!.feature).toMatchObject({ type: 'contourFlange', sketch: 'S3', distance: 50 });
  });
  it('edge flange and hem take the selected edges, sized from the thickness of the active rule', () => {
    const c = ctx(sheet, { mode: 'edge', selection: ['A|B#0'], edges: [edge] });
    const m = make(c);
    expect(m.cmd('add-edge-flange').enabled?.()).toBe(true);
    m.cmd('add-edge-flange').run();
    m.cmd('add-hem').run();
    const [flange, hem] = m.a.calls.create.map((a) => (a[0] as Array<{ feature: Record<string, unknown> }>)[0].feature);
    expect(flange).toMatchObject({ type: 'edgeFlange', height: 30, edges: [{ faces: ['A', 'B'], at: [50, 0, 3] }] });   // 10 x 3 mm
    expect(hem).toMatchObject({ type: 'hem', length: 15 });                                                          // 5 x 3 mm
    const off = make(ctx(sheet, { mode: 'edge', selection: [], edges: [edge] }));
    expect(off.cmd('add-edge-flange').enabled?.()).toBe(true);   // nothing picked: the editor opens with its edge list active
    off.cmd('add-edge-flange').run();
    expect((off.a.calls.create[0][0] as Array<{ feature: Record<string, unknown> }>)[0].feature).toMatchObject({ type: 'edgeFlange', edges: [] });
    expect(make(ctx([closed], { mode: 'edge', selection: ['A|B#0'], edges: [edge] })).cmd('add-edge-flange').why?.()).toMatch(/base flange/i);
  });
  it('a fold follows the last line of a sketch other than the sheet\'s own outline', () => {
    expect(foldLine(ctx(sheet))).toBeNull();                       // only the outline sketch
    expect(foldLine(ctx([...sheet, fold]))).toEqual({ sketch: 'S2', curve: 'f1' });
    const m = make(ctx([...sheet, fold]));
    expect(m.cmd('add-fold').enabled?.()).toBe(true);
    m.cmd('add-fold').run();
    expect((m.a.calls.create[0][0] as Array<{ feature: Record<string, unknown> }>)[0].feature).toEqual({ type: 'fold', line: { sketch: 'S2', curve: 'f1' }, angle: 90 });
  });
  it('Convert needs a solid and no sheet yet; it names the active rule and opens its editor', () => {
    const body = { min: [0, 0, 0], max: [10, 10, 10] };
    const none = make(ctx([]));
    expect(none.cmd('add-sheet-convert').enabled?.()).toBe(false);
    const noSolid = make(ctx([{ type: 'extrude', id: 'F1' }]));
    expect(noSolid.cmd('add-sheet-convert').why?.()).toMatch(/solid/i);
    const m = make(ctx([{ type: 'sheetRules', id: 'R1', name: 'Steel2', thickness: 2 }, { type: 'extrude', id: 'F1' }], { box: body }));
    expect(m.cmd('add-sheet-convert').enabled?.()).toBe(true);
    m.cmd('add-sheet-convert').run();
    expect((m.a.calls.create[0][0] as Array<{ feature: Record<string, unknown> }>)[0].feature).toEqual({ type: 'sheetConvert', rule: 'Steel2' });
    const plain = make(ctx([{ type: 'extrude', id: 'F1' }], { box: body }));
    plain.cmd('add-sheet-convert').run();
    expect((plain.a.calls.create[0][0] as Array<{ feature: Record<string, unknown> }>)[0].feature).toEqual({ type: 'sheetConvert' });
    const done = make(ctx([{ type: 'sheetConvert', id: 'V1' }], { box: body }));
    expect(done.cmd('add-sheet-convert').enabled?.()).toBe(false);
    expect(done.cmd('add-sheet-convert').why?.()).toMatch(/already/i);
    expect(sheetReady(ctx([{ type: 'sheetConvert', id: 'V1' }]))).toBe(true);        // a converted solid is a sheet: flanges, cuts and corners work on it
  });
  it('Cut takes the selected or last closed sketch that is not a plate outline or a cut already', () => {
    const cutSk = { ...closed, id: 'S4' };
    expect(cutSketch(ctx(sheet))).toBeNull();                          // only the outline of the base flange
    expect(cutSketch(ctx([...sheet, cutSk]))?.id).toBe('S4');
    expect(cutSketch(ctx([...sheet, cutSk, { type: 'sheetCut', id: 'X1', sketch: 'S4' }]))).toBeNull();
    const off = make(ctx(sheet));
    expect(off.cmd('add-sheet-cut').enabled?.()).toBe(false);
    expect(off.cmd('add-sheet-cut').why?.()).toMatch(/closed sketch/i);
    expect(make(ctx([cutSk])).cmd('add-sheet-cut').why?.()).toMatch(/base flange/i);
    const m = make(ctx([...sheet, cutSk]));
    expect(m.cmd('add-sheet-cut').enabled?.()).toBe(true);
    m.cmd('add-sheet-cut').run();
    expect((m.a.calls.create[0][0] as Array<{ feature: Record<string, unknown> }>)[0].feature).toEqual({ type: 'sheetCut', sketch: 'S4' });
  });
  it('Corner rounds the selected vertices with a radius of three thicknesses', () => {
    const sel = ['v:10,0,3', 'v:10,60,3', 'A|B#0'];
    expect(cornerPicks(ctx(sheet, { selection: sel }))).toEqual([[10, 0, 3], [10, 60, 3]]);
    const off = make(ctx(sheet, { selection: [] }));
    expect(off.cmd('add-sheet-corner').enabled?.()).toBe(true);   // nothing picked: the editor opens with its corner field active
    off.cmd('add-sheet-corner').run();
    expect((off.a.calls.create[0][0] as Array<{ feature: Record<string, unknown> }>)[0].feature).toMatchObject({ type: 'sheetCorner', corners: [] });
    const m = make(ctx(sheet, { mode: 'vertex', selection: sel }));
    expect(m.cmd('add-sheet-corner').enabled?.()).toBe(true);
    m.cmd('add-sheet-corner').run();
    expect((m.a.calls.create[0][0] as Array<{ feature: Record<string, unknown> }>)[0].feature).toEqual({ type: 'sheetCorner', corners: [[10, 0, 3], [10, 60, 3]], mode: 'round', radius: 9 });   // t 3
    expect(make(ctx([closed], { selection: sel })).cmd('add-sheet-corner').why?.()).toMatch(/base flange/i);
  });
  it('unfold and refold apply without an editor and follow the state of the sheet', () => {
    const flat = make(ctx(sheet));
    expect(flat.cmd('sheet-unfold').enabled?.()).toBe(true);
    expect(flat.cmd('sheet-refold').enabled?.()).toBe(false);
    flat.cmd('sheet-unfold').run();
    expect(flat.a.calls.apply).toHaveLength(1);
    expect(flat.a.calls.create).toBeUndefined();
    const unfolded = make(ctx([...sheet, { type: 'unfold', id: 'U1' }]));
    expect(unfolded.cmd('sheet-unfold').enabled?.()).toBe(false);
    expect(unfolded.cmd('sheet-refold').enabled?.()).toBe(true);
    expect(sheetReady(ctx([...sheet, { type: 'unfold', id: 'U1' }]))).toBe(false);
  });
  it('the Rules command edits the selected, else the active, else the last rule; with none it adds one', () => {
    const rules = [{ type: 'sheetRules', id: 'R1', name: 'A' }, { type: 'sheetRules', id: 'R2', name: 'B', active: false }];
    expect(rulesTarget(ctx(rules))?.id).toBe('R1');
    expect(rulesTarget(ctx(rules, { selectedId: 'R2' }))?.id).toBe('R2');
    expect(rulesTarget(ctx([{ ...rules[1] }]))?.id).toBe('R2');
    expect(rulesTarget(ctx([]))).toBeNull();
    const m = make(ctx(rules, { selectedId: 'R2' }));
    m.cmd('sheet-rules').run();
    expect(m.a.calls.edit[0]).toEqual(['R2']);
    const none = make(ctx([closed]));
    none.cmd('sheet-rules').run();
    expect((none.a.calls.create[0][0] as Array<{ feature: Record<string, unknown> }>)[0].feature).toMatchObject({ type: 'sheetRules', thickness: 2 });
  });
  it('the flat view and the exports run their actions once there is a plate', () => {
    expect(make(ctx([closed])).cmd('sheet-dxf').enabled?.()).toBe(false);
    const m = make(ctx(sheet));
    m.cmd('sheet-flat').run(); m.cmd('sheet-dxf').run(); m.cmd('sheet-bends-csv').run(); m.cmd('sheet-bends-json').run();
    expect(m.a.calls.flatView).toHaveLength(1);
    expect(m.a.calls.exportDxf).toHaveLength(1);
    expect(m.a.calls.exportBends).toEqual([['csv'], ['json']]);
  });
  it('a command registered later joins the table, the tab and the search without touching the layout', () => {
    const run = vi.fn();
    const def: SheetCommandDef = { id: 'test-sheet-extra', group: 'Create', enabled: () => true, run };
    registerSheetCommand(def);
    try {
      const cmds: Command[] = sheetCommands(actions(ctx([])));
      expect(cmds.some((c) => c.id === 'test-sheet-extra')).toBe(true);
      const layout = resolveLayout(cmds, RIBBON_LAYOUT as never);
      expect(layout.Sheet.find((g) => g.id === 'Create')!.entries).toContain('test-sheet-extra');
      registerSheetCommand({ ...def, group: 'Flatten' });              // replaces by id
      expect(SHEET_COMMANDS.filter((d) => d.id === 'test-sheet-extra')).toHaveLength(1);
    } finally {
      SHEET_COMMANDS.splice(SHEET_COMMANDS.findIndex((d) => d.id === 'test-sheet-extra'), 1);
    }
  });
});
