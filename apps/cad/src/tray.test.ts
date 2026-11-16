import { describe, expect, it } from 'vitest';
import './i18n';
import { DEFAULT_TRAY, drawerFit, fillDrawerLength, trayIssue, trayOps, traySummary, withChange, type TrayParams } from './tray';

const P = (patch: Partial<TrayParams> = {}): TrayParams => withChange(DEFAULT_TRAY, patch);
const doc = { features: [] as Array<{ id?: string }>, seq: 1 };

describe('tray defaults', () => {
  it('is a 1 x 4 x 4 open tray, 8 mm scoop, 1.2 mm walls, on a 256 mm bed', () => {
    expect(DEFAULT_TRAY).toMatchObject({ widthUnits: 1, lengthUnits: 4, heightUnits: 4, scoopRadius: 8, wall: 1.2, floor: 1.2, endWalls: 'none', magnets: false, pitch: 42, unitHeight: 7, tolerance: 0.5, bed: 256, printer: 'bambu-x1c' });
    expect(trayIssue(DEFAULT_TRAY)).toBeNull();
  });
  it('choosing a printer sets the bed; typing a bed that matches a preset picks it, otherwise Custom', () => {
    expect(P({ printer: 'creality-k1-max' }).bed).toBe(300);
    expect(P({ bed: 300 }).printer).toBe('creality-k1-max');
    expect(P({ bed: 220 }).printer).toBe('custom');
    expect(withChange(P({ bed: 220 }), { printer: 'custom' }).bed).toBe(220);
  });
});

describe('drawer fit', () => {
  it('is null until the drawer width and depth are given', () => {
    expect(drawerFit(DEFAULT_TRAY)).toBeNull();
    expect(drawerFit(P({ drawerWidth: 300 }))).toBeNull();
  });
  it('whole units: a part of n units is n x 42 less 0.5, so 480 mm takes 11 and leaves 18.5', () => {
    const f = drawerFit(P({ drawerWidth: 480, drawerDepth: 336, drawerHeight: 70, halfUnits: false }))!;
    expect(f).toMatchObject({ widthUnits: 11, lengthUnits: 8, heightUnits: 10, leftHeight: 0 });
    expect(f.leftWidth).toBeCloseTo(480 - (11 * 42 - 0.5), 6);
    expect(f.leftDepth).toBe(0.5);   // 8 x 42 - 0.5 = 335.5
  });
  it('half units fill more of the drawer', () => {
    const w = drawerFit(P({ drawerWidth: 460, drawerDepth: 300, halfUnits: false }))!;
    const h = drawerFit(P({ drawerWidth: 460, drawerDepth: 300, halfUnits: true }))!;
    expect(w.widthUnits).toBe(10); expect(h.widthUnits).toBe(10.5);   // 11 x 42 - 0.5 = 461.5 does not fit 460; 10.5 x 42 - 0.5 = 440.5 does
  });
  it('fits exactly when the drawer is the part: 41.5 mm takes one unit', () => {
    expect(drawerFit(P({ drawerWidth: 41.5, drawerDepth: 41.5 }))).toMatchObject({ widthUnits: 1, lengthUnits: 1, leftWidth: 0 });
  });
  it('Fill the length takes the drawer depth (and the height when given), keeping the width', () => {
    const n = fillDrawerLength(P({ drawerWidth: 480, drawerDepth: 336, drawerHeight: 70 }));
    expect(n).toMatchObject({ widthUnits: 1, lengthUnits: 8, heightUnits: 10 });
    expect(fillDrawerLength(DEFAULT_TRAY)).toBe(DEFAULT_TRAY);
  });
});

describe('trayIssue', () => {
  const code = (patch: Partial<TrayParams>) => trayIssue(P(patch))?.code ?? null;
  it('sizes and half units', () => {
    expect(code({ widthUnits: 0 })).toBe('size');
    expect(code({ lengthUnits: 2.3 })).toBe('half');
    expect(code({ widthUnits: 1.5 })).toBeNull();
  });
  it('wall, floor, scoop and corner', () => {
    expect(code({ wall: 0.3 })).toBe('wall');
    expect(code({ wall: 25 })).toBe('wallThick');
    expect(code({ floor: 0.2 })).toBe('floor');
    expect(code({ scoopRadius: 25 })).toBe('scoop');
    expect(code({ heightUnits: 1, scoopRadius: 8 })).toBe('scoopDeep');
    expect(code({ cornerRadius: 30 })).toBe('corner');
  });
  it('the foot: the floor and the scoop are measured above it, and a small corner is refused', () => {
    expect(DEFAULT_TRAY.foot).toBe(true);
    expect(code({ heightUnits: 1, scoopRadius: 0, floor: 3 })).toBe('floor');
    expect(code({ heightUnits: 2, scoopRadius: 8.5 })).toBe('scoopDeep');   // 14 - 4.75 - 1.2 = 8.05 deep
    expect(code({ heightUnits: 2, scoopRadius: 8 })).toBeNull();
    expect(code({ cornerRadius: 3 })).toBe('footCorner');
    expect(code({ cornerRadius: 3, foot: false })).toBeNull();
  });
  it('magnets need a floor thick enough', () => {
    expect(code({ magnets: true, foot: false })).toBe('magnetFloor');
    expect(code({ magnets: true, foot: false, floor: 3 })).toBeNull();
    expect(code({ magnets: true })).toBeNull();     // the foot is solid under the holes
  });
  it('an empty name and the helper checks', () => {
    expect(code({ name: ' ' })).toBe('name');
  });
});

describe('traySummary', () => {
  it('the outside size, the cavity and the bed check', () => {
    const s = traySummary(DEFAULT_TRAY);
    expect(s).toMatchObject({ width: 41.5, length: 167.5, height: 28, inner: 39.1, depth: 22.05, tooLong: false, longest: 167.5, fit: null, fitsDrawer: null });
    expect(s.volume).toBeGreaterThan(10000);
    expect(traySummary(P({ lengthUnits: 7 })).tooLong).toBe(true);   // 293.5 > 256
    expect(traySummary(P({ lengthUnits: 7, printer: 'creality-k1-max' })).tooLong).toBe(false);   // 293.5 <= 300
    expect(traySummary(P({ lengthUnits: 7, bed: 0 })).tooLong).toBe(false);   // no bed given
  });
  it('whether it fits the drawer', () => {
    expect(traySummary(P({ drawerWidth: 100, drawerDepth: 100 })).fitsDrawer).toBe(false);
    expect(traySummary(P({ drawerWidth: 100, drawerDepth: 200, drawerHeight: 30 })).fitsDrawer).toBe(true);
    expect(traySummary(P({ drawerWidth: 100, drawerDepth: 200, drawerHeight: 20 })).fitsDrawer).toBe(false);
  });
});

describe('trayOps', () => {
  it('appends one folder of ops numbered from the next feature id, with the body named after the tray', () => {
    const ops = trayOps({ features: [{ id: 'F7' }], seq: 1 }, P({ name: 'Rods' }));
    const adds = ops.filter((o) => o.op === 'add').map((o) => (o as unknown as { feature: Record<string, unknown> }).feature);
    expect(String(adds[0].id)).toBe('F8');
    expect(adds.find((f) => f.type === 'extrude')).toMatchObject({ body: 'Rods' });
    expect(adds.every((f) => typeof f.group === 'string')).toBe(true);
  });
  it('throws with the helper message when the numbers cannot work', () => {
    expect(() => trayOps(doc, P({ scoopRadius: 50 }))).toThrow(/half the inside width/);
  });
});

describe('baseplate', () => {
  const plate = (patch: Partial<TrayParams> = {}) => P({ kind: 'baseplate', ...patch });
  it('switching the kind renames the default name only', () => {
    expect(plate().name).toBe('Baseplate');
    expect(withChange(plate(), { kind: 'tray' }).name).toBe('Tray');
    expect(withChange(P({ name: 'Mine' }), { kind: 'baseplate' }).name).toBe('Mine');
  });
  it('checks: sizes, a thin plate, a clearance that leaves no ridge, a corner under the foot minimum', () => {
    expect(trayIssue(plate())).toBeNull();
    expect(trayIssue(plate({ widthUnits: 1.3 }))?.code).toBe('half');
    expect(trayIssue(plate({ base: 0.2 }))?.code).toBe('wall');
    expect(trayIssue(plate({ clearance: 0.3 }))?.code).toBe('kernel');
    expect(trayIssue(plate({ cornerRadius: 2 }))?.code).toBe('kernel');
  });
  it('the summary is whole units, 4.75 mm of pocket plus the plate; the drawer fit has no tolerance', () => {
    expect(traySummary(plate({ widthUnits: 3, lengthUnits: 4 }))).toMatchObject({ width: 126, length: 168, height: 5.95 });
    expect(drawerFit(plate({ drawerWidth: 126, drawerDepth: 84 }))).toMatchObject({ widthUnits: 3, lengthUnits: 2, leftWidth: 0 });
  });
  it('the ops are a baseplate folder: one body and three cuts per cell', () => {
    const ops = trayOps(doc, plate({ widthUnits: 2, lengthUnits: 1 }));
    const adds = ops.filter((o) => o.op === 'add').map((o) => (o as { feature: Record<string, unknown> }).feature);
    expect(adds.filter((f) => f.type === 'loft')).toHaveLength(6);
    expect(adds.find((f) => f.type === 'extrude')).toMatchObject({ body: 'Baseplate' });
    expect(adds.every((f) => typeof f.group === 'string')).toBe(true);
  });
  it('split: a drawer-sized plate becomes bed-sized pieces, one body each, and the summary counts them', () => {
    const p = plate({ widthUnits: 11, lengthUnits: 4, bed: 256, printer: 'bambu-x1c' });
    expect(traySummary(p)).toMatchObject({ pieces: 2, pieceWidth: 231, tooLong: false });
    expect(traySummary({ ...p, split: false })).toMatchObject({ pieces: 1, tooLong: true });
    const bodies = trayOps(doc, p).filter((o) => o.op === 'add').map((o) => (o as { feature: Record<string, unknown> }).feature).filter((f) => f.type === 'extrude').map((f) => f.body);
    expect(bodies).toEqual(['Baseplate 1-1', 'Baseplate 2-1']);
  });
});
