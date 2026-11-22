import { describe, it, expect } from 'vitest';
import { parseThreeMf } from '@kit/io';
import {
  PRINTER_BED_PRESETS,
  computeMeshBounds,
  dropToPlate,
  exportPrintPlate3mf,
  findBedPreset,
  findLargestFlatFaceNormal,
  layFlatPositions,
  packPlate,
  rotationMatrixToNegZ,
  type PlateBodyInput,
} from './printPlate';

/** Build an axis-aligned closed box triangle soup [x0..x1, y0..y1, z0..z1] with outward CCW normals. */
function makeBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Float32Array {
  const tris: number[] = [];
  const quad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
  ) => {
    tris.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  // -Z (bottom)
  quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
  // +Z (top)
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  // -Y (front)
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  // +Y (back)
  quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
  // -X (left)
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  // +X (right)
  quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
  return new Float32Array(tris);
}

describe('printPlate presets & geometry helpers', () => {
  it('exposes the standard printer bed presets', () => {
    expect(findBedPreset('bambu-x1c')).toMatchObject({ widthMm: 256, depthMm: 256 });
    expect(findBedPreset('bambu-a1-mini')).toMatchObject({ widthMm: 180, depthMm: 180 });
    expect(findBedPreset('prusa-mk4')).toMatchObject({ widthMm: 250, depthMm: 210 });
    expect(findBedPreset('voron-350')).toMatchObject({ widthMm: 350, depthMm: 350 });
    expect(findBedPreset('creality-k1-max')).toMatchObject({ widthMm: 300, depthMm: 300 });
    expect(findBedPreset('custom')).toBeDefined();
    expect(PRINTER_BED_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it('lays a tall narrow slab flat onto its largest face and drops minZ to 0', () => {
    // 10 (X) x 40 (Y) x 80 (Z) standing upright at z = 15..95; largest face is 40x80 (+/-X normal)
    const upright = makeBox(0, 0, 15, 10, 40, 95);
    const normal = findLargestFlatFaceNormal(upright);
    expect(normal).not.toBeNull();
    expect(Math.abs(normal![0])).toBeCloseTo(1, 3);

    const laid = layFlatPositions(upright);
    expect(laid.rotated).toBe(true);
    const bounds = computeMeshBounds(laid.positions)!;
    expect(bounds.minZ).toBeCloseTo(0, 4);
    expect(bounds.sizeZ).toBeCloseTo(10, 3); // 10 mm thickness is now the height
  });

  it('respects a picked face normal when laying flat', () => {
    // 60 x 40 x 20 box; pick the +Z top face so it flips upside down cleanly
    const box = makeBox(0, 0, 5, 60, 40, 25);
    const laid = layFlatPositions(box, [0, 0, 1]);
    expect(laid.rotated).toBe(true);
    const b = computeMeshBounds(laid.positions)!;
    expect(b.minZ).toBeCloseTo(0, 4);
    expect(b.sizeZ).toBeCloseTo(20, 3);
  });

  it('rotationMatrixToNegZ has determinant +1 for arbitrary normals', () => {
    for (const n of [[0, 0, -1], [0, 0, 1], [1, 0, 0], [0, 1, 0], [1, 2, 3]] as const) {
      const m = rotationMatrixToNegZ(n);
      const det =
        m[0] * (m[4] * m[8] - m[5] * m[7]) -
        m[1] * (m[3] * m[8] - m[5] * m[6]) +
        m[2] * (m[3] * m[7] - m[4] * m[6]);
      expect(det).toBeCloseTo(1, 5);
    }
  });

  it('dropToPlate shifts minZ to 0 without changing XY', () => {
    const box = makeBox(10, 20, -12, 30, 50, 8);
    const dropped = dropToPlate(box);
    const b = computeMeshBounds(dropped)!;
    expect(b.minX).toBeCloseTo(10, 4);
    expect(b.minY).toBeCloseTo(20, 4);
    expect(b.minZ).toBeCloseTo(0, 4);
    expect(b.maxZ).toBeCloseTo(20, 4);
  });
});

describe('packPlate 2D skyline bin-packing', () => {
  it('packs multiple bodies with no overlap and respects spacing & bed margins', () => {
    const bodies: PlateBodyInput[] = [
      { id: 'b1', name: 'Base', positions: makeBox(0, 0, 0, 80, 60, 10), layFlat: false },
      { id: 'b2', name: 'Lid', positions: makeBox(0, 0, 0, 80, 60, 8), layFlat: false },
      { id: 'b3', name: 'Clip A', positions: makeBox(0, 0, 0, 30, 20, 6), layFlat: false },
      { id: 'b4', name: 'Clip B', positions: makeBox(0, 0, 0, 30, 20, 6), layFlat: false },
    ];
    const layout = packPlate(bodies, { bedWidthMm: 256, bedDepthMm: 256, spacingMm: 4, marginMm: 5 });
    expect(layout.fittedCount).toBe(4);
    expect(layout.overflowCount).toBe(0);
    expect(layout.usedBounds).not.toBeNull();

    // Check every pair does not overlap and maintains >= spacingMm separation on X or Y
    for (let i = 0; i < layout.placed.length; i++) {
      const a = layout.placed[i];
      expect(a.x).toBeGreaterThanOrEqual(5 - 1e-3);
      expect(a.y).toBeGreaterThanOrEqual(5 - 1e-3);
      expect(a.x + a.width).toBeLessThanOrEqual(251 + 1e-3);
      expect(a.y + a.depth).toBeLessThanOrEqual(251 + 1e-3);
      const b = computeMeshBounds(a.positions)!;
      expect(b.minZ).toBeCloseTo(0, 3);

      for (let j = i + 1; j < layout.placed.length; j++) {
        const c = layout.placed[j];
        const gapX = Math.max(c.x - (a.x + a.width), a.x - (c.x + c.width));
        const gapY = Math.max(c.y - (a.y + a.depth), a.y - (c.y + c.depth));
        expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(4 - 1e-2);
      }
    }
  });

  it('uses 90-degree Z-rotation when enabled to fit parts that otherwise would not fit', () => {
    // Bed 200 x 140 (usable 190 x 130). Part is 50 x 170 -> only fits when rotated 90 deg to 170 x 50.
    const longPart: PlateBodyInput = {
      id: 'long',
      name: 'Rail',
      positions: makeBox(0, 0, 0, 50, 170, 10),
      layFlat: false,
    };
    const withRot = packPlate([longPart], { bedWidthMm: 200, bedDepthMm: 140, allowRotate90: true });
    expect(withRot.fittedCount).toBe(1);
    expect(withRot.placed[0].rotated90).toBe(true);
    expect(withRot.placed[0].width).toBeCloseTo(170, 2);
    expect(withRot.placed[0].depth).toBeCloseTo(50, 2);

    const withoutRot = packPlate([longPart], { bedWidthMm: 200, bedDepthMm: 140, allowRotate90: false });
    expect(withoutRot.fittedCount).toBe(0);
    expect(withoutRot.overflowCount).toBe(1);
    expect(withoutRot.overflow[0].overflowReason).toBe('too-large');
  });

  it('reports overflow bodies when the bed is full and skips excluded bodies', () => {
    const bodies: PlateBodyInput[] = [
      { id: '1', name: 'Tile 1', positions: makeBox(0, 0, 0, 80, 80, 5), layFlat: false },
      { id: '2', name: 'Tile 2', positions: makeBox(0, 0, 0, 80, 80, 5), layFlat: false },
      { id: '3', name: 'Tile 3', positions: makeBox(0, 0, 0, 80, 80, 5), layFlat: false },
      { id: '4', name: 'Tile 4', positions: makeBox(0, 0, 0, 80, 80, 5), layFlat: false },
      { id: '5', name: 'Tile 5', positions: makeBox(0, 0, 0, 80, 80, 5), layFlat: false },
      { id: '6', name: 'Excluded', positions: makeBox(0, 0, 0, 20, 20, 5), included: false },
    ];
    // 180x180 A1 Mini (usable 170x170): fits 2x2 = 4 tiles of 80mm with 4mm spacing (80+4+80=164 <= 170), 5th overflows
    const layout = packPlate(bodies, { bedWidthMm: 180, bedDepthMm: 180, spacingMm: 4, marginMm: 5 });
    expect(layout.totalIncluded).toBe(5);
    expect(layout.fittedCount).toBe(4);
    expect(layout.overflowCount).toBe(1);
    expect(layout.overflow[0].overflowReason).toBe('overflow');
  });
});

describe('exportPrintPlate3mf', () => {
  it('writes a valid multi-body .3mf at packed bed coordinates', async () => {
    const bodies: PlateBodyInput[] = [
      { id: 'a', name: 'Housing', positions: makeBox(0, 0, 20, 60, 40, 35), color: '#3366cc' },
      { id: 'b', name: 'Cover', positions: makeBox(0, 0, 0, 50, 30, 8), color: '#cc6633' },
    ];
    const layout = packPlate(bodies, { bedWidthMm: 256, bedDepthMm: 256 });
    const res = await exportPrintPlate3mf(layout, 'Enclosure');
    expect(res.file).toBeDefined();
    expect(res.file!.name).toBe('Enclosure-plate.3mf');
    expect(res.file!.mime).toBe('model/3mf');

    const parsed = await parseThreeMf(res.file!.data as Uint8Array);
    expect(parsed.unit).toBe('millimeter');
    expect(parsed.objects.length).toBe(2);
    expect(parsed.objects.map((o) => o.name).sort()).toEqual(['Cover', 'Housing']);
    for (const obj of parsed.objects) {
      const b = computeMeshBounds(obj.positions)!;
      expect(b.minZ).toBeCloseTo(0, 3);
      expect(b.minX).toBeGreaterThanOrEqual(0);
      expect(b.maxX).toBeLessThanOrEqual(256);
    }
  });

  it('returns io.noBody when nothing fits on the plate', async () => {
    const layout = packPlate([], { bedWidthMm: 256, bedDepthMm: 256 });
    const res = await exportPrintPlate3mf(layout, 'Empty');
    expect(res.file).toBeUndefined();
    expect(res.notices).toEqual([{ level: 'error', key: 'io.noBody' }]);
  });
});
