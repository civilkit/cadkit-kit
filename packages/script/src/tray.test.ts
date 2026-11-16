import { describe, expect, it } from 'vitest';
import { trayEditOps, trayGeometry, magnetPoints, footCells, baseplateGeometry, splitUnits } from './index';

// gridTray(): the ops it emits and its checks; the kernel behaviour (volumes, validity) is in tray.kernel.test.ts
const feats = (o: Parameters<typeof trayEditOps>[0]) => trayEditOps(o, 1).filter((x) => x.op === 'add').map((x) => (x as { feature: Record<string, unknown> }).feature);
const BASE = { widthUnits: 1, lengthUnits: 4, heightUnits: 4 };
const err = (o: Record<string, unknown>) => { try { trayEditOps({ ...BASE, ...o } as never, 1); return ''; } catch (e) { return (e as Error).message; } };

describe('gridTray() numbers', () => {
  it('the defaults: 41.5 x 167.5 x 28 mm, wall and floor 1.2, scoop 8, 3.75 corners, open ends', () => {
    expect(trayGeometry(BASE)).toMatchObject({ width: 41.5, length: 167.5, height: 28, wall: 1.2, floor: 1.2, scoop: 8, corner: 3.75, ends: 'none', magnets: false, innerWidth: 39.1, cavityDepth: 26.8 });
  });
  it('a half unit is half a pitch, less the tolerance once', () => {
    expect(trayGeometry({ ...BASE, widthUnits: 1.5 }).width).toBe(62.5);
    expect(trayGeometry({ ...BASE, pitch: 50, tolerance: 1 }).width).toBe(49);
  });
  it('magnets: four holes 26 mm apart around the centre of every whole unit, none for a half unit', () => {
    const pts = magnetPoints(trayGeometry({ ...BASE, widthUnits: 1.5, lengthUnits: 2 }));
    expect(pts).toHaveLength(8);   // 1 whole unit across x 2 along
    expect(new Set(pts.map((p) => p[0])).size).toBe(2);
    expect(Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]))).toBe(26);
  });
});

describe('gridTray() ops', () => {
  it('emits an own-body extrude and one cavity cut limited to that body, and no other cut without magnets', () => {
    const f = feats(BASE);
    const ex = f.filter((x) => x.type === 'extrude');
    expect(ex).toHaveLength(2);
    expect(ex[0]).toMatchObject({ op: 'newBody', body: 'Tray', depth: 28 });
    expect(ex[1]).toMatchObject({ op: 'cut', target: [{ body: 'Tray' }] });
  });
  it('an open tray cuts from outside the front to outside the back; end walls start and stop a wall inside', () => {
    const depth = (o: Record<string, unknown>) => (feats({ ...BASE, ...o }).filter((x) => x.type === 'extrude')[1] as { depth: number }).depth;
    expect(depth({})).toBeCloseTo(169.5, 6);   // 167.5 + 1 + 1
    expect(depth({ endWalls: 'front' })).toBeCloseTo(167.5 - 1.2 + 1, 6);
    expect(depth({ endWalls: 'both' })).toBeCloseTo(167.5 - 2.4, 6);
  });
  it('magnets add a third extrude cutting 2 mm', () => {
    const ex = feats({ ...BASE, magnets: true, floor: 3 }).filter((x) => x.type === 'extrude');
    expect(ex).toHaveLength(3);
    expect(ex[2]).toMatchObject({ op: 'cut', depth: 2, target: [{ body: 'Tray' }] });
  });
});

describe('gridTray() checks say why', () => {
  it('half units, wall, floor, scoop, corner, ends, magnet floor and name', () => {
    expect(err({ widthUnits: 1.3 })).toMatch(/whole or half grid units/);
    expect(err({ widthUnits: 0 })).toMatch(/more than 0/);
    expect(err({ wall: 0.2 })).toMatch(/at least 0\.4/);
    expect(err({ wall: 25 })).toMatch(/two walls/);
    expect(err({ floor: 40 })).toMatch(/floor/);
    expect(err({ scoopRadius: 25 })).toMatch(/half the inside width/);
    expect(err({ heightUnits: 1, scoopRadius: 8 })).toMatch(/deeper than the cavity/);
    expect(err({ cornerRadius: 30 })).toMatch(/cornerRadius/);
    expect(err({ endWalls: 'left' })).toMatch(/endWalls is/);
    expect(err({ magnets: true })).toMatch(/floor.*magnet depth/);
    expect(err({ name: '  ' })).toMatch(/name must not be empty/);
  });
});

describe('gridTray() foot', () => {
  const FOOT = { ...BASE, foot: true };
  it('the foot is part of the height: the cavity starts above it and the volume counts the feet', () => {
    const g = trayGeometry(FOOT);
    expect(g).toMatchObject({ height: 28, footHeight: 4.75, cavityDepth: 28 - 4.75 - 1.2 });
    const noFoot = trayGeometry({ ...BASE, heightUnits: (28 - 4.75) / 7 });      // the same block above the foot and the same cavity, without feet
    const feet = g.volume - noFoot.volume;
    expect(feet).toBeLessThan(4 * 41.5 * 41.5 * 4.75);
    expect(feet).toBeGreaterThan(4 * 35.6 * 35.6 * 4.75);
  });
  it('cells: whole units of one pitch, a half unit as one cell of half a pitch, centred on the part', () => {
    expect(footCells(2, 42)).toEqual([{ size: 42, centre: -21 }, { size: 42, centre: 21 }]);
    expect(footCells(1.5, 42)).toEqual([{ size: 42, centre: -10.5 }, { size: 21, centre: 21 }]);
  });
  it('emits three lofts per cell (four cells: twelve) fused into the body, and the block starts at the top of the foot', () => {
    const f = feats(FOOT);
    expect(f.filter((x) => x.type === 'loft')).toHaveLength(12);
    expect(f.filter((x) => x.type === 'extrude')[0]).toMatchObject({ op: 'newBody', depth: 28 - 4.75 });
  });
  it('is refused with a small corner, in a tall-enough tray only, or with magnets that would break through', () => {
    expect(err({ foot: true, cornerRadius: 2 })).toMatch(/foot needs a plan corner radius/);
    expect(err({ foot: true, heightUnits: 1, scoopRadius: 0, floor: 3 })).toMatch(/foot \(4.75 mm\) and the floor/);
    expect(err({ foot: true, magnets: true, floor: 0.4 })).toBe('');   // 4.75 + 0.4 under 2 + 0.8 is fine: the foot is solid
  });
});

describe('baseplate split', () => {
  it('splitUnits: the fewest parts of at most max, as equal as half units allow', () => {
    expect(splitUnits(11, 6)).toEqual([{ at: 0, n: 5.5 }, { at: 5.5, n: 5.5 }]);
    expect(splitUnits(11, 5)).toEqual([{ at: 0, n: 4 }, { at: 4, n: 3.5 }, { at: 7.5, n: 3.5 }]);
    expect(splitUnits(4, 6)).toEqual([{ at: 0, n: 4 }]);
    expect(splitUnits(7.5, 4)).toEqual([{ at: 0, n: 4 }, { at: 4, n: 3.5 }]);
  });
  it('a plate within the bed is one piece; a bigger one is several, none over the bed, together the whole plate', () => {
    expect(baseplateGeometry({ widthUnits: 5, lengthUnits: 5, bed: 256 }).split).toBe(false);
    const g = baseplateGeometry({ widthUnits: 11, lengthUnits: 8, bed: 256 });
    expect(g.split).toBe(true);
    expect(g.pieces.every((p) => p.w * 42 <= 256 && p.l * 42 <= 256)).toBe(true);
    expect(g.pieces.reduce((a, p) => a + p.w * p.l, 0)).toBe(88);
  });
});
