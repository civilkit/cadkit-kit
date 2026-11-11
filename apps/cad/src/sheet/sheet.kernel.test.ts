// The Sheet metal tab against the real kernel: the commands build a base flange and an edge flange through the controller, and the flat
// pattern, the bend table and the DXF come back as the kernel's reference numbers (t 2, k-factor 0.44, radius 2, 100 x 60 plate).
import { afterEach, describe, expect, it } from 'vitest';
import { Session, type EditResult } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import type { Ctx } from '../featureCommands';
import { sheetCommands, type SheetActions } from './sheetCommands';
import { bendTableRequest, dxfRequest, DEFAULT_DXF, type BendTableReply, type DxfReply } from './exportSheet';
import { panelEdge, patchCornerMode } from './options';
import { hasSheetBase, isUnfolded, lastFlat, panelCount, panelInfo, type SheetEntry } from './model';

type Wire = Record<string, unknown>;
const lines = (ids: string[][]) => ids.map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b }));
const rect = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: lines([['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']]), constraints: [],
});
const chain = (id: string, pts: Array<[number, number]>) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...pts.map(([x, y], i) => ({ id: 'q' + i, x, y }))],
  entities: pts.slice(1).map((_, i) => ({ id: 'l' + (i + 1), type: 'line', p1: 'q' + i, p2: 'q' + (i + 1) })), constraints: [],
});
const partOf = (features: Wire[]): PartDoc => ({ ...emptyPart('Plate'), features, seq: features.length + 1 }) as unknown as PartDoc;
const STEEL = { type: 'sheetRules', id: 'R1', name: 'Steel2', thickness: 2, kFactor: 0.44, bendRadius: 2, active: true };

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world(doc: PartDoc) {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc);
  const results: EditResult[] = [];
  const edited: string[] = [];
  const notes: string[] = [];
  const pending: Promise<unknown>[] = [];
  const run = (ops: Parameters<SheetActions['create']>[0]) => { pending.push(controller.edit(ops).then((r) => { results.push(r); })); };
  const actions: SheetActions = {
    context: (): Ctx => ({ doc: controller.document(), selection: store.selection.value, mode: store.mode.value, box: controller.bodyBox(), edges: controller.bodyEdges(), selectedId: null }),
    create: run, apply: run, edit: (id) => { edited.push(id); }, notify: (text) => { notes.push(text); },
    flatView() {}, exportDxf() {}, exportBends() {},
  };
  const cmds = sheetCommands(actions);
  const cmd = (id: string) => cmds.find((c) => c.id === id)!;
  const go = async (id: string) => { cmd(id).run(); await Promise.all(pending.splice(0)); return results.at(-1); };
  /** Pick the edge of the body whose middle is near `at` (edge mode, as a click would). */
  const pick = (...at: number[][]) => {
    const edges = controller.bodyEdges();
    const keys = at.map((p) => edges.find((e) => e.mid && Math.hypot(e.mid[0] - p[0], e.mid[1] - p[1], e.mid[2] - p[2]) < 1e-3)?.key).filter((k): k is string => !!k);
    store.mode.value = 'edge'; store.select(keys);
    return keys;
  };
  const flat = async (): Promise<SheetEntry> => lastFlat(await controller.sheetMetal())!;
  return { controller, store, cmd, go, pick, flat, edited, notes, results };
}

describe('sheet metal commands against the kernel', { skip: !process.env.CK_WASM }, () => {
  it('builds a base flange (adding the default rule) and an edge flange, and the flat pattern matches the reference', async () => {
    const w = await world(partOf([rect('S1', 0, 0, 100, 60)]));
    expect(w.cmd('add-base-flange').enabled?.()).toBe(true);
    expect(w.cmd('add-edge-flange').enabled?.()).toBe(false);          // no plate yet
    expect(w.cmd('add-edge-flange').why?.()).toMatch(/base flange/i);
    const r = await w.go('add-base-flange');
    expect(r?.ok).toBe(true);
    const doc = w.controller.document()!;
    expect(doc.features.map((f) => f.type)).toEqual(['sketch', 'sheetRules', 'baseFlange']);
    expect(hasSheetBase(doc)).toBe(true);
    expect((await w.flat()).flatPattern.flatSize).toEqual([100, 60, 2]);
    expect(w.cmd('add-base-flange').enabled?.()).toBe(false);          // one base flange per part

    // the top edge of the wall along y = 0 (the cap side bends the flange up)
    expect(w.pick([50, 0, 2])).toHaveLength(1);
    expect(w.cmd('add-edge-flange').enabled?.()).toBe(true);
    const e = await w.go('add-edge-flange');
    expect(e?.ok).toBe(true);
    const fp = (await w.flat()).flatPattern;
    expect(fp.bends).toHaveLength(1);
    expect(fp.flatSize[0]).toBeCloseTo(100, 6);
    expect(fp.flatSize[1]).toBeCloseTo(76.5238934, 6);       // height 20 (10 x thickness) from the outer sharp, 90 degrees
    expect(fp.bends[0]).toMatchObject({ direction: 'up', angleDeg: 90, radius: 2 });
    expect(fp.bends[0].allowance).toBeCloseTo(4.523893421, 6);
    expect(fp.bends[0].length).toBeCloseTo(100, 6);

    // a second flange on the opposite edge: the reference plate with two 20 mm flanges is 100 x 93.04778684
    w.pick([50, 60, 2]);
    expect((await w.go('add-edge-flange'))?.ok).toBe(true);
    const two = (await w.flat()).flatPattern;
    expect(two.bends).toHaveLength(2);
    expect(two.flatSize[1]).toBeCloseTo(93.04778684, 6);
  });

  it('a rule field may be an expression of the rule\'s own thickness', async () => {
    const w = await world(partOf([rect('S1', 0, 0, 100, 60), { ...STEEL, bendRadius: '=Thickness*2' }, { type: 'baseFlange', id: 'B1', sketch: 'S1' }]));
    w.pick([50, 0, 2]);
    expect((await w.go('add-edge-flange'))?.ok).toBe(true);
    expect((await w.flat()).flatPattern.bends[0].radius).toBeCloseTo(4, 9);
  });

  it('keeps a rule you gave and edits it with the Rules command', async () => {
    const w = await world(partOf([rect('S1', 0, 0, 100, 60), STEEL]));
    await w.go('add-base-flange');
    expect(w.controller.document()!.features.map((f) => f.type)).toEqual(['sketch', 'sheetRules', 'baseFlange']);   // no second rule
    await w.go('sheet-rules');
    expect(w.edited).toEqual(['R1']);                                    // opens the rule's editor; adds nothing
    const none = await world(partOf([rect('S1', 0, 0, 100, 60)]));
    expect((await none.go('sheet-rules'))?.ok).toBe(true);
    expect(none.controller.document()!.features.map((f) => f.type)).toEqual(['sketch', 'sheetRules']);
  });

  it('unfolds and refolds, and refuses flanges while the sheet is flat', async () => {
    const w = await world(partOf([rect('S1', 0, 0, 100, 60), STEEL, { type: 'baseFlange', id: 'B1', sketch: 'S1' }]));
    w.pick([50, 0, 2]);
    await w.go('add-edge-flange');
    expect(w.cmd('sheet-refold').enabled?.()).toBe(false);
    expect((await w.go('sheet-unfold'))?.ok).toBe(true);
    expect(isUnfolded(w.controller.document())).toBe(true);
    expect((await w.flat()).flatPattern.unfolded).toBe(true);
    expect(w.cmd('sheet-unfold').enabled?.()).toBe(false);
    expect(w.cmd('add-edge-flange').enabled?.()).toBe(false);
    expect(w.cmd('add-edge-flange').why?.()).toMatch(/refold/i);
    const vol = (await w.controller.massProps())?.volume;
    expect(vol).toBeCloseTo(100 * 76.5238934 * 2, 2);                    // the flat blank extruded by the thickness
    expect((await w.go('sheet-refold'))?.ok).toBe(true);
    expect(isUnfolded(w.controller.document())).toBe(false);
    expect((await w.flat()).flatPattern.unfolded).toBe(false);
  });

  it('makes a fold along a sketch line, a hem, and a contour flange', async () => {
    const fold = await world(partOf([rect('S1', 0, 0, 100, 60), STEEL, { type: 'baseFlange', id: 'B1', sketch: 'S1' }, chain('S2', [[40, -5], [40, 65]])]));
    expect(fold.cmd('add-fold').enabled?.()).toBe(true);
    expect((await fold.go('add-fold'))?.ok).toBe(true);
    const f = (await fold.flat()).flatPattern;
    expect(f.bends).toHaveLength(1);
    expect(f.bendZones[0][0]).toBeCloseTo(37.738053, 5);                 // fold 90 at x = 40, line in the middle of the bend
    expect(f.bendZones[0][1]).toBeCloseTo(42.261947, 5);

    const hem = await world(partOf([rect('S1', 0, 0, 100, 60), STEEL, { type: 'baseFlange', id: 'B1', sketch: 'S1' }]));
    hem.pick([50, 0, 2]);
    expect((await hem.go('add-hem'))?.ok).toBe(true);
    expect((await hem.flat()).flatPattern.flatSize[1]).toBeCloseTo(70.786017, 5);   // hem length 10 (5 x thickness)

    const contour = await world(partOf([chain('S1', [[0, 0], [0, 20], [30, 20]])]));
    expect(contour.cmd('add-contour-flange').enabled?.()).toBe(true);
    expect(contour.cmd('add-base-flange').enabled?.()).toBe(false);      // the chain is open
    expect((await contour.go('add-contour-flange'))?.ok).toBe(true);
    expect(contour.controller.document()!.features.map((x) => x.type)).toEqual(['sketch', 'sheetRules', 'contourFlange']);
    const c = (await contour.flat()).flatPattern;
    expect(c.bends).toHaveLength(1);
    expect(c.flatSize[1]).toBeCloseTo(50, 6);                            // the default extrusion distance
  });

  it('writes the DXF and the bend table of the flat pattern', async () => {
    const w = await world(partOf([rect('S1', 0, 0, 100, 60), STEEL, { type: 'baseFlange', id: 'B1', sketch: 'S1' }]));
    w.pick([50, 0, 2]);
    await w.go('add-edge-flange');
    const fp = (await w.flat()).flatPattern;
    const d = await w.controller.sheetRequest<DxfReply>(dxfRequest(fp, { ...DEFAULT_DXF, bendNotes: true }));
    expect(d.bends).toBe(1);
    expect(d.dxf).toContain('CUT_OUTER');
    expect(d.dxf).toContain('BEND_UP');
    expect(d.dxf).toContain('B1 UP 90');
    expect(d.entities.BEND_UP).toBe(1);
    expect(d.bounds[2] - d.bounds[0]).toBeCloseTo(100, 4);
    const csv = await w.controller.sheetRequest<BendTableReply>(bendTableRequest(fp, 'csv', 'Plate'));
    expect(csv.text.split('\r\n')[0]).toMatch(/^body,rule,thickness_mm,k_factor,bend,angle_deg/);
    expect(csv.bends).toBe(1);
    const json = await w.controller.sheetRequest<BendTableReply>(bendTableRequest(fp, 'json'));
    expect(JSON.parse(json.text).bends).toHaveLength(1);
    await expect(w.controller.sheetRequest({ type: 'sheetDxf', flatPattern: fp, units: 'furlongs' })).rejects.toThrow(/units/);
  });

  it('Corner rounds a free corner of a flanged plate: the volume drops by the corner area times the thickness', async () => {
    const w = await world(partOf([rect('S1', 0, 0, 100, 60), STEEL, { type: 'baseFlange', id: 'B1', sketch: 'S1' }]));
    w.pick([50, 0, 2]);
    expect((await w.go('add-edge-flange'))?.ok).toBe(true);
    const before = ((await w.controller.massProps())?.volume ?? NaN);
    expect(w.cmd('add-sheet-corner').enabled?.()).toBe(false);                                // nothing selected
    expect(w.cmd('add-sheet-corner').why?.()).toMatch(/corner/i);
    w.store.mode.value = 'vertex'; w.store.select(['v:100,60,2']);                            // the far corner of the plate, on the cap face
    expect(w.cmd('add-sheet-corner').enabled?.()).toBe(true);
    const r = await w.go('add-sheet-corner');
    expect(r?.ok, JSON.stringify(r)).toBe(true);
    expect(w.controller.document()!.features.at(-1)).toMatchObject({ type: 'sheetCorner', mode: 'round', radius: 6, corners: [[100, 60, 2]] });
    const after = ((await w.controller.massProps())?.volume ?? NaN);
    expect(before - after).toBeCloseTo(2 * 36 * (1 - Math.PI / 4), 2);                        // (1 - pi/4) r^2 t, r = 3 x 2 mm
    expect((await w.flat()).flatPattern.bends).toHaveLength(1);                               // the bend is untouched
  });
  it('Corner next to a bend is refused and the kernel names the wall', async () => {
    const w = await world(partOf([rect('S1', 0, 0, 100, 60), STEEL, { type: 'baseFlange', id: 'B1', sketch: 'S1' }]));
    w.pick([50, 0, 2]);
    await w.go('add-edge-flange');
    w.store.mode.value = 'vertex'; w.store.select(['v:100,0,2']);
    const r = await w.go('add-sheet-corner');
    expect(r?.ok).toBe(false);
    expect(JSON.stringify(r)).toContain('touches the bend side');
  });
  it('Corner volume: a plate corner rounded with a radius of 6 loses (1 - pi/4) r^2 t', async () => {
    const w = await world(partOf([rect('S1', 0, 0, 100, 60), STEEL, { type: 'baseFlange', id: 'B1', sketch: 'S1' }]));
    const before = ((await w.controller.massProps())?.volume ?? NaN);
    expect(before).toBeCloseTo(12000, 3);
    w.store.mode.value = 'vertex'; w.store.select(['v:100,60,2']);
    const r = await w.go('add-sheet-corner');
    expect(r?.ok, JSON.stringify(r)).toBe(true);
    const after = ((await w.controller.massProps())?.volume ?? NaN);
    expect(before - after).toBeCloseTo(2 * 36 * (1 - Math.PI / 4), 2);
    const fp = (await w.flat()).flatPattern;
    expect(fp.outline[0].length).toBeGreaterThan(4);                                         // the arc is in the outline
    expect((await w.flat()).type).toBe('sheetCorner');
  });
  it('Corner as a chamfer, edited the way the form does (mode and distance)', async () => {
    const w = await world(partOf([rect('S1', 0, 0, 100, 60), STEEL, { type: 'baseFlange', id: 'B1', sketch: 'S1' }]));
    w.store.mode.value = 'vertex'; w.store.select(['v:100,60,2']);
    await w.go('add-sheet-corner');
    const id = (w.controller.document()!.features.at(-1) as unknown as { id: string }).id;
    const next: Record<string, unknown> = { ...(w.controller.document()!.features.at(-1) as unknown as Record<string, unknown>), ...patchCornerMode({ mode: 'round', radius: 6 }, 'chamfer'), distance: 5 };
    for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
    const r = await w.controller.edit([{ op: 'replace', id, feature: next } as never]);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const vol = ((await w.controller.massProps())?.volume ?? NaN);
    expect(12000 - vol).toBeCloseTo(2 * 12.5, 2);                                            // a 5 x 5 triangle, 2 mm thick
  });

  it('Cut across a bend: the flat pattern gains a hole, the DXF a cut layer, the solid loses material', async () => {
    const w = await world(partOf([rect('S1', 0, 0, 100, 60), STEEL, { type: 'baseFlange', id: 'B1', sketch: 'S1' }]));
    w.pick([50, 0, 2]);
    expect((await w.go('add-edge-flange'))?.ok).toBe(true);
    const flat0 = (await w.flat()).flatPattern;
    const zone = flat0.bendZones[0];                                                         // [x0, x1, y0, y1]
    const dxf0 = await w.controller.sheetRequest<DxfReply>(dxfRequest(flat0, DEFAULT_DXF));
    expect(dxf0.entities.CUT_INNER ?? 0).toBe(0);
    const v0 = ((await w.controller.massProps())?.volume ?? NaN);
    expect(w.cmd('add-sheet-cut').enabled?.()).toBe(false);                                   // no sketch to cut with yet
    // a slot 20 wide that crosses the bend zone (drawn on the plane of the base: flat coordinates)
    const mid = (zone[2] + zone[3]) / 2;
    const add = await w.controller.edit([{ op: 'add', feature: rect('S2', 40, mid - 4, 60, mid + 4) } as never]);
    expect(add.ok).toBe(true);
    expect(w.cmd('add-sheet-cut').enabled?.()).toBe(true);
    const r = await w.go('add-sheet-cut');
    expect(r?.ok, JSON.stringify(r)).toBe(true);
    expect((w.controller.document()!.features.at(-1) as unknown as Record<string, unknown>)).toMatchObject({ type: 'sheetCut', sketch: 'S2' });
    const e = await w.flat();
    expect(e.type).toBe('sheetCut');
    expect(e.flatPattern.outline.length).toBe(flat0.outline.length + 1);                      // one more loop: the slot
    expect(e.flatPattern.bends).toHaveLength(1);                                              // the bend line is kept in the table
    const dxf = await w.controller.sheetRequest<DxfReply>(dxfRequest(e.flatPattern, DEFAULT_DXF));
    expect(dxf.entities.CUT_INNER).toBeGreaterThan(0);
    expect(dxf.dxf).toContain('CUT_INNER');
    const v1 = ((await w.controller.massProps())?.volume ?? NaN);
    expect(v1).toBeLessThan(v0 - 1);
    expect(w.cmd('add-sheet-cut').enabled?.()).toBe(false);                                   // that sketch is cut already
  });
  it('Cut: a region that removes a whole panel is refused and the kernel says why', async () => {
    const w = await world(partOf([rect('S1', 0, 0, 100, 60), STEEL, { type: 'baseFlange', id: 'B1', sketch: 'S1' }, rect('S2', -10, -10, 110, 70)]));
    const r = await w.go('add-sheet-cut');
    expect(r?.ok).toBe(false);
    const text = JSON.stringify(r);
    expect(text).toContain('the cut removes the whole panel P0');                              // the kernel's own reason, which the editor's card shows
  });

  it('Convert turns a bent plate solid into a sheet, and the panels it finds can be picked by role', async () => {
    // an L section, 2 mm thick, inner radius 2 (outer 4), extruded 40 mm
    const L = {
      type: 'sketch', id: 'S1', plane: { kind: 'std', id: 'front' },
      points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a1', x: 0, y: 20 }, { id: 'a2', x: 0, y: 4 }, { id: 'a3', x: 4, y: 0 }, { id: 'a4', x: 30, y: 0 }, { id: 'a5', x: 30, y: 2 },
        { id: 'a6', x: 4, y: 2 }, { id: 'a7', x: 2, y: 4 }, { id: 'a8', x: 2, y: 20 }, { id: 'c1', x: 4, y: 4 }],
      entities: [{ id: 'e1', type: 'line', p1: 'a1', p2: 'a2' }, { id: 'e2', type: 'arc', c: 'c1', p1: 'a2', p2: 'a3' }, { id: 'e3', type: 'line', p1: 'a3', p2: 'a4' }, { id: 'e4', type: 'line', p1: 'a4', p2: 'a5' },
        { id: 'e5', type: 'line', p1: 'a5', p2: 'a6' }, { id: 'e6', type: 'arc', c: 'c1', p1: 'a7', p2: 'a6' }, { id: 'e7', type: 'line', p1: 'a7', p2: 'a8' }, { id: 'e8', type: 'line', p1: 'a8', p2: 'a1' }],
      constraints: [],
    };
    const w = await world(partOf([L, { type: 'extrude', id: 'F1', sketch: 'S1', op: 'add', end: 'blind', depth: 40 }]));
    expect(w.cmd('add-sheet-convert').enabled?.()).toBe(true);
    const solid = ((await w.controller.massProps())?.volume ?? NaN);
    const r = await w.go('add-sheet-convert');
    expect(r?.ok, JSON.stringify(r)).toBe(true);
    expect((w.controller.document()!.features.at(-1) as unknown as Record<string, unknown>).type).toBe('sheetConvert');
    expect(hasSheetBase(w.controller.document())).toBe(true);
    expect(w.cmd('add-sheet-convert').enabled?.()).toBe(false);
    expect(w.cmd('add-sheet-convert').why?.()).toMatch(/already/i);
    const e = await w.flat();
    expect(e.type).toBe('sheetConvert');
    expect(e.flatPattern.thickness).toBeCloseTo(2, 6);
    expect(e.flatPattern.bends).toHaveLength(1);
    expect(e.flatPattern.bends[0]).toMatchObject({ angleDeg: 90 });
    const ba = (2 + 0.44 * 2) * Math.PI / 2;
    expect([...e.flatPattern.flatSize].slice(0, 2).sort((a, b) => a - b)[0]).toBeCloseTo(40, 4);
    expect([...e.flatPattern.flatSize].slice(0, 2).sort((a, b) => a - b)[1]).toBeCloseTo(16 + 26 + ba, 3);
    expect(((await w.controller.massProps())?.volume ?? NaN)).toBeCloseTo(solid, 1);
    expect(panelCount(e)).toBe(2);                                                           // the two legs: the Panel list shows
    // the walls of the second leg as the Panel list offers them; an edge flange on one of them, by the role the list writes
    const walls = panelInfo(e).walls;
    expect(walls[1].length).toBe(3);
    const results: boolean[] = [];
    for (const wall of walls[1]) {
      const probe = await w.controller.preview([{ op: 'add', feature: { type: 'edgeFlange', id: 'E9', edges: [panelEdge(1, wall)], height: 10 } } as never]);
      results.push(probe.ok);
    }
    expect(results.filter(Boolean).length).toBeGreaterThan(0);                               // the free end takes a flange
    const free = walls[1][results.indexOf(true)];
    const fl = await w.controller.edit([{ op: 'add', feature: { type: 'edgeFlange', id: 'E1', edges: [panelEdge(1, free)], height: 10 } } as never]);
    expect(fl.ok, JSON.stringify(fl)).toBe(true);
    expect((await w.flat()).type).toBe('edgeFlange');                                         // the entries come in feature order (E1 sorts before F3 by id)
    expect((await w.flat()).flatPattern.bends).toHaveLength(2);
    expect(panelCount(await w.flat())).toBe(3);
    // a name the panel does not have is refused with the kernel's hint
    const bad = await w.controller.edit([{ op: 'add', feature: { type: 'edgeFlange', id: 'E2', edges: ['P1.tip'], height: 10 } } as never]);
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).toContain('has no wall');
  });
  it('Convert refuses a sharp-cornered solid and says what a bent plate needs', async () => {
    const sharp = { type: 'sketch', id: 'S1', plane: { kind: 'std', id: 'front' },
      points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 30, y: 0 }, { id: 'p3', x: 30, y: 2 }, { id: 'p4', x: 2, y: 2 }, { id: 'p5', x: 2, y: 20 }, { id: 'p6', x: 0, y: 20 }],
      entities: lines([['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p5'], ['e5', 'p5', 'p6'], ['e6', 'p6', 'p1']]), constraints: [] };
    const w = await world(partOf([sharp, { type: 'extrude', id: 'F1', sketch: 'S1', op: 'add', end: 'blind', depth: 40 }]));
    const r = await w.go('add-sheet-convert');
    expect(r?.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/sheetMetalUnsupported|sharp|bend radius/i);
  });
});
