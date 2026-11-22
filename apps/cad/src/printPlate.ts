// Pure 3D-printing Print-Plate layout engine: printer bed presets, auto-lay-flat onto -Z,
// deterministic 2D skyline bin-packing for multi-body parts, and plate .3mf export via @kit/io.
// No DOM, no kernel, no platform dependencies.
import { meshToThreeMf, type MeshBody } from '@kit/io';
import { fileStem, type ExportNotice, type ExportResult } from './exportFiles';

export interface PrinterBedPreset {
  id: string;
  name: string;
  widthMm: number;
  depthMm: number;
}

export const PRINTER_BED_PRESETS: readonly PrinterBedPreset[] = [
  { id: 'bambu-x1c', name: 'Bambu X1C / P1S', widthMm: 256, depthMm: 256 },
  { id: 'bambu-a1-mini', name: 'Bambu A1 Mini', widthMm: 180, depthMm: 180 },
  { id: 'prusa-mk4', name: 'Prusa MK4', widthMm: 250, depthMm: 210 },
  { id: 'voron-350', name: 'Voron 350', widthMm: 350, depthMm: 350 },
  { id: 'creality-k1-max', name: 'Creality K1 Max', widthMm: 300, depthMm: 300 },
  { id: 'custom', name: 'Custom', widthMm: 220, depthMm: 220 },
] as const;

export type PrinterBedPresetId = (typeof PRINTER_BED_PRESETS)[number]['id'];

export function findBedPreset(id: string): PrinterBedPreset | undefined {
  return PRINTER_BED_PRESETS.find((p) => p.id === id);
}

export interface MeshBox3 {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

export type Vec3 = [number, number, number];
export type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

const IDENTITY_MAT3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Axis-aligned bounding box of a triangle soup (`positions`: 3 floats per vertex). */
export function computeMeshBounds(positions: ArrayLike<number>): MeshBox3 | null {
  const n = Math.floor(positions.length / 3);
  if (n === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    minX, minY, minZ,
    maxX, maxY, maxZ,
    sizeX: maxX - minX,
    sizeY: maxY - minY,
    sizeZ: maxZ - minZ,
  };
}

/**
 * Find the unit normal of the largest coplanar flat face in a triangle soup.
 * Coplanar triangles are bucketed by quantized `(nx, ny, nz, planeD)` in O(N) time.
 * Ties (within 1% area) prefer the face already closest to `-Z` to avoid needless flips.
 */
export function findLargestFlatFaceNormal(positions: ArrayLike<number>): Vec3 | null {
  const triCount = Math.floor(positions.length / 9);
  if (triCount === 0) return null;

  interface PlaneBucket {
    area: number;
    wx: number;
    wy: number;
    wz: number;
  }

  const buckets = new Map<string, PlaneBucket>();
  const qNorm = (v: number): number => Math.round(v * 50); // ~1.1 deg resolution
  const qDist = (v: number): number => Math.round(v * 10); // 0.1 mm resolution

  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2];
    const ux = positions[o + 3] - ax, uy = positions[o + 4] - ay, uz = positions[o + 5] - az;
    const vx = positions[o + 6] - ax, vy = positions[o + 7] - ay, vz = positions[o + 8] - az;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const len = Math.hypot(cx, cy, cz);
    if (len < 1e-9) continue;
    const area = 0.5 * len;
    const nx = cx / len, ny = cy / len, nz = cz / len;
    const d = nx * ax + ny * ay + nz * az;
    const key = `${qNorm(nx)},${qNorm(ny)},${qNorm(nz)},${qDist(d)}`;
    let b = buckets.get(key);
    if (!b) {
      b = { area: 0, wx: 0, wy: 0, wz: 0 };
      buckets.set(key, b);
    }
    b.area += area;
    b.wx += nx * area;
    b.wy += ny * area;
    b.wz += nz * area;
  }

  let bestArea = 0;
  let bestNormal: Vec3 | null = null;
  let bestNegZDot = -2;

  for (const b of buckets.values()) {
    const l = Math.hypot(b.wx, b.wy, b.wz);
    if (l < 1e-12) continue;
    const n: Vec3 = [b.wx / l, b.wy / l, b.wz / l];
    const negZDot = -n[2];
    const significantlyLarger = b.area > bestArea * 1.01;
    const tiedAndBetterAligned = b.area >= bestArea * 0.99 && negZDot > bestNegZDot + 1e-6;
    if (bestNormal === null || significantlyLarger || tiedAndBetterAligned) {
      bestArea = b.area;
      bestNormal = n;
      bestNegZDot = negZDot;
    }
  }

  return bestNormal;
}

/**
 * 3x3 right-handed rotation matrix (det = +1) that maps `normal` to `[0, 0, -1]`.
 * Preserves triangle winding order.
 */
export function rotationMatrixToNegZ(normal: readonly [number, number, number]): Mat3 {
  const l = Math.hypot(normal[0], normal[1], normal[2]);
  if (l < 1e-12) return [...IDENTITY_MAT3];
  const nx = normal[0] / l;
  const ny = normal[1] / l;
  const nz = normal[2] / l;

  // Target t = [0, 0, -1]; dot = n . t = -nz
  const c = -nz;
  if (c > 1 - 1e-9) return [...IDENTITY_MAT3];
  if (c < -1 + 1e-9) {
    // 180-degree rotation around X axis: (x, y, z) -> (x, -y, -z)
    return [1, 0, 0, 0, -1, 0, 0, 0, -1];
  }

  // Axis k = normalize(n x t) = normalize([-ny, nx, 0])
  const kLen = Math.hypot(nx, ny);
  const kx = -ny / kLen;
  const ky = nx / kLen;
  // kz = 0
  const s = kLen; // sin(theta) = |n x t| = sqrt(nx^2 + ny^2)
  const oneMinusC = 1 - c;

  // Rodrigues formula for kz = 0:
  // R = I + s*K + (1-c)*K^2
  return [
    1 - oneMinusC * ky * ky,       oneMinusC * kx * ky,           s * ky,
    oneMinusC * kx * ky,           1 - oneMinusC * kx * kx,      -s * kx,
    -s * ky,                       s * kx,                        c,
  ];
}

/** Shift mesh vertices so `minZ = 0` without rotating. */
export function dropToPlate(positions: ArrayLike<number>): Float32Array {
  const out = new Float32Array(positions.length);
  const b = computeMeshBounds(positions);
  if (!b) return out;
  const dz = -b.minZ;
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = positions[i];
    out[i + 1] = positions[i + 1];
    out[i + 2] = positions[i + 2] + dz;
  }
  return out;
}

/**
 * Rotate a mesh so its largest flat face (or `pickedNormal`, if given) points along `-Z`,
 * then translate vertically so its lowest vertex sits at `z = 0`.
 */
export function layFlatPositions(
  positions: ArrayLike<number>,
  pickedNormal?: readonly [number, number, number] | null,
): { positions: Float32Array; normal: Vec3 | null; rotated: boolean } {
  const n = positions.length;
  if (n < 9) return { positions: new Float32Array(n), normal: null, rotated: false };

  let target: Vec3 | null = null;
  if (pickedNormal && Math.hypot(pickedNormal[0], pickedNormal[1], pickedNormal[2]) > 1e-9) {
    const l = Math.hypot(pickedNormal[0], pickedNormal[1], pickedNormal[2]);
    target = [pickedNormal[0] / l, pickedNormal[1] / l, pickedNormal[2] / l];
  } else {
    target = findLargestFlatFaceNormal(positions);
  }

  if (!target) {
    return { positions: dropToPlate(positions), normal: null, rotated: false };
  }

  const m = rotationMatrixToNegZ(target);
  const rotated = -target[2] < 1 - 1e-6;
  const out = new Float32Array(n);
  let minZ = Infinity;

  for (let i = 0; i < n; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    const rx = m[0] * x + m[1] * y + m[2] * z;
    const ry = m[3] * x + m[4] * y + m[5] * z;
    const rz = m[6] * x + m[7] * y + m[8] * z;
    out[i] = rx;
    out[i + 1] = ry;
    out[i + 2] = rz;
    if (rz < minZ) minZ = rz;
  }

  if (Number.isFinite(minZ) && minZ !== 0) {
    for (let i = 2; i < n; i += 3) out[i] -= minZ;
  }

  return { positions: out, normal: target, rotated };
}

export interface PlateBodyInput {
  id: string;
  name: string;
  positions: ArrayLike<number>;
  normals?: ArrayLike<number>;
  color?: string;
  opacity?: number;
  /** Whether this body is included on the plate (default true). */
  included?: boolean;
  /** Whether to auto-lay-flat onto -Z before packing (default true). */
  layFlat?: boolean;
  /** Optional picked face normal to orient downward (-Z) when layFlat is true. */
  faceNormal?: readonly [number, number, number] | null;
}

export interface PackPlateOptions {
  bedWidthMm: number;
  bedDepthMm: number;
  /** Minimum gap between adjacent parts in mm (default 4). */
  spacingMm?: number;
  /** Margin around the bed perimeter in mm (default 5). */
  marginMm?: number;
  /** Allow 90-degree Z-rotation for tighter packing (default true). */
  allowRotate90?: boolean;
  /** Center the packed footprint group on the bed (default true). */
  centerOnBed?: boolean;
}

export interface PlacedPlateBody {
  id: string;
  name: string;
  /** Bottom-left X on the bed (mm). */
  x: number;
  /** Bottom-left Y on the bed (mm). */
  y: number;
  /** Footprint width along bed X (mm). */
  width: number;
  /** Footprint depth along bed Y (mm). */
  depth: number;
  /** Height along Z (mm). */
  height: number;
  rotated90: boolean;
  laidFlat: boolean;
  fits: boolean;
  overflowReason?: 'too-large' | 'overflow';
  color?: string;
  opacity?: number;
  /** Final mesh vertex positions in bed coordinates (mm, Z >= 0). */
  positions: Float32Array;
}

export interface PlateLayoutResult {
  bedWidthMm: number;
  bedDepthMm: number;
  spacingMm: number;
  marginMm: number;
  placed: PlacedPlateBody[];
  overflow: PlacedPlateBody[];
  fittedCount: number;
  overflowCount: number;
  totalIncluded: number;
  usedBounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; depth: number } | null;
  utilization: number;
}

interface SkylineSegment {
  x: number;
  y: number;
  width: number;
}

interface PreparedBody {
  input: PlateBodyInput;
  order: number;
  positions: Float32Array;
  bounds: MeshBox3;
  laidFlat: boolean;
}

function transformToBed(
  positions: Float32Array,
  rotated90: boolean,
  targetX: number,
  targetY: number,
): Float32Array {
  const n = positions.length;
  const out = new Float32Array(n);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  for (let i = 0; i < n; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const rx = rotated90 ? -y : x;
    const ry = rotated90 ? x : y;
    out[i] = rx;
    out[i + 1] = ry;
    out[i + 2] = z;
    if (rx < minX) minX = rx;
    if (ry < minY) minY = ry;
    if (z < minZ) minZ = z;
  }
  const dx = targetX - minX;
  const dy = targetY - minY;
  const dz = -minZ;
  for (let i = 0; i < n; i += 3) {
    out[i] += dx;
    out[i + 1] += dy;
    out[i + 2] += dz;
  }
  return out;
}

function findSkylinePosition(
  skyline: readonly SkylineSegment[],
  rectW: number,
  rectD: number,
  binW: number,
  binD: number,
): { index: number; x: number; y: number } | null {
  const eps = 1e-6;
  let bestIdx = -1;
  let bestX = Infinity;
  let bestY = Infinity;
  let bestTop = Infinity;

  for (let i = 0; i < skyline.length; i++) {
    const startX = skyline[i].x;
    if (startX + rectW > binW + eps) continue;

    let widthLeft = rectW;
    let maxY = skyline[i].y;
    let j = i;
    while (widthLeft > eps) {
      if (j >= skyline.length) { maxY = Infinity; break; }
      if (skyline[j].y > maxY) maxY = skyline[j].y;
      widthLeft -= skyline[j].width;
      j++;
    }

    const top = maxY + rectD;
    if (top > binD + eps) continue;

    if (
      top < bestTop - eps ||
      (Math.abs(top - bestTop) <= eps && maxY < bestY - eps) ||
      (Math.abs(top - bestTop) <= eps && Math.abs(maxY - bestY) <= eps && startX < bestX - eps)
    ) {
      bestIdx = i;
      bestX = startX;
      bestY = maxY;
      bestTop = top;
    }
  }

  return bestIdx >= 0 ? { index: bestIdx, x: bestX, y: bestY } : null;
}

function updateSkyline(skyline: SkylineSegment[], x: number, y: number, w: number, d: number): void {
  const eps = 1e-6;
  const xEnd = x + w;
  const newY = y + d;
  const next: SkylineSegment[] = [];

  for (const seg of skyline) {
    const segEnd = seg.x + seg.width;
    if (segEnd <= x + eps || seg.x >= xEnd - eps) {
      next.push(seg);
      continue;
    }
    if (seg.x < x - eps) {
      next.push({ x: seg.x, y: seg.y, width: x - seg.x });
    }
    if (segEnd > xEnd + eps) {
      next.push({ x: xEnd, y: seg.y, width: segEnd - xEnd });
    }
  }

  next.push({ x, y: newY, width: w });
  next.sort((a, b) => a.x - b.x);

  // Merge adjacent segments with matching height
  skyline.length = 0;
  for (const seg of next) {
    if (seg.width <= eps) continue;
    const prev = skyline[skyline.length - 1];
    if (prev && Math.abs(prev.y - seg.y) <= eps && Math.abs(prev.x + prev.width - seg.x) <= eps) {
      prev.width += seg.width;
    } else {
      skyline.push({ ...seg });
    }
  }
}

/**
 * Deterministic 2D skyline bin-packer for multi-body print plates.
 * Prepares each included body (auto-lay-flat or drop-to-plate), sorts by descending footprint,
 * packs within `bedWidthMm x bedDepthMm` respecting `marginMm` and `spacingMm`, and optionally
 * centers the packed group on the build plate.
 */
export function packPlate(
  bodies: readonly PlateBodyInput[],
  options: PackPlateOptions,
): PlateLayoutResult {
  const bedWidthMm = Math.max(1, Number.isFinite(options.bedWidthMm) ? options.bedWidthMm : 256);
  const bedDepthMm = Math.max(1, Number.isFinite(options.bedDepthMm) ? options.bedDepthMm : 256);
  const spacingMm = Math.max(0, Number.isFinite(options.spacingMm) ? options.spacingMm! : 4);
  const marginMm = Math.max(0, Number.isFinite(options.marginMm) ? options.marginMm! : 5);
  const allowRotate90 = options.allowRotate90 ?? true;
  const centerOnBed = options.centerOnBed ?? true;

  const usableW = Math.max(0, bedWidthMm - 2 * marginMm);
  const usableD = Math.max(0, bedDepthMm - 2 * marginMm);

  const prepared: PreparedBody[] = [];
  bodies.forEach((b, order) => {
    if (b.included === false) return;
    if (!b.positions || b.positions.length < 9) return;
    const doLayFlat = b.layFlat !== false;
    const mesh = doLayFlat
      ? layFlatPositions(b.positions, b.faceNormal)
      : { positions: dropToPlate(b.positions), normal: null, rotated: false };
    const bounds = computeMeshBounds(mesh.positions);
    if (!bounds) return;
    prepared.push({
      input: b,
      order,
      positions: mesh.positions,
      bounds,
      laidFlat: doLayFlat && mesh.rotated,
    });
  });

  // Deterministic descending sort: largest max-side first, then area, then original index
  prepared.sort((a, b) => {
    const maxA = Math.max(a.bounds.sizeX, a.bounds.sizeY);
    const maxB = Math.max(b.bounds.sizeX, b.bounds.sizeY);
    if (Math.abs(maxB - maxA) > 1e-6) return maxB - maxA;
    const areaA = a.bounds.sizeX * a.bounds.sizeY;
    const areaB = b.bounds.sizeX * b.bounds.sizeY;
    if (Math.abs(areaB - areaA) > 1e-6) return areaB - areaA;
    return a.order - b.order;
  });

  // Expand bin by spacingMm so each item of size (w + spacing, d + spacing) gets exact gap
  // between neighbours without wasting spacing on the outer edges.
  const effW = usableW + spacingMm;
  const effD = usableD + spacingMm;
  const skyline: SkylineSegment[] = [{ x: 0, y: 0, width: effW }];

  const placed: PlacedPlateBody[] = [];
  const overflow: PlacedPlateBody[] = [];

  for (const item of prepared) {
    const w0 = item.bounds.sizeX;
    const d0 = item.bounds.sizeY;
    const h0 = item.bounds.sizeZ;

    const cand0 = findSkylinePosition(skyline, w0 + spacingMm, d0 + spacingMm, effW, effD);
    const cand90 =
      allowRotate90 && Math.abs(w0 - d0) > 1e-6
        ? findSkylinePosition(skyline, d0 + spacingMm, w0 + spacingMm, effW, effD)
        : null;

    let chosen: { pos: { x: number; y: number }; rotated90: boolean; w: number; d: number } | null = null;
    if (cand0 && cand90) {
      const top0 = cand0.y + d0 + spacingMm;
      const top90 = cand90.y + w0 + spacingMm;
      if (top90 < top0 - 1e-6 || (Math.abs(top90 - top0) <= 1e-6 && cand90.y < cand0.y - 1e-6)) {
        chosen = { pos: cand90, rotated90: true, w: d0, d: w0 };
      } else {
        chosen = { pos: cand0, rotated90: false, w: w0, d: d0 };
      }
    } else if (cand0) {
      chosen = { pos: cand0, rotated90: false, w: w0, d: d0 };
    } else if (cand90) {
      chosen = { pos: cand90, rotated90: true, w: d0, d: w0 };
    }

    if (chosen) {
      updateSkyline(skyline, chosen.pos.x, chosen.pos.y, chosen.w + spacingMm, chosen.d + spacingMm);
      const bedX = marginMm + chosen.pos.x;
      const bedY = marginMm + chosen.pos.y;
      placed.push({
        id: item.input.id,
        name: item.input.name,
        x: r3(bedX),
        y: r3(bedY),
        width: r3(chosen.w),
        depth: r3(chosen.d),
        height: r3(h0),
        rotated90: chosen.rotated90,
        laidFlat: item.laidFlat,
        fits: true,
        color: item.input.color,
        opacity: item.input.opacity,
        positions: transformToBed(item.positions, chosen.rotated90, bedX, bedY),
      });
    } else {
      const fitsAlone =
        (w0 <= usableW + 1e-6 && d0 <= usableD + 1e-6) ||
        (allowRotate90 && d0 <= usableW + 1e-6 && w0 <= usableD + 1e-6);
      overflow.push({
        id: item.input.id,
        name: item.input.name,
        x: r3(marginMm),
        y: r3(marginMm),
        width: r3(w0),
        depth: r3(d0),
        height: r3(h0),
        rotated90: false,
        laidFlat: item.laidFlat,
        fits: false,
        overflowReason: fitsAlone ? 'overflow' : 'too-large',
        color: item.input.color,
        opacity: item.input.opacity,
        positions: transformToBed(item.positions, false, marginMm, marginMm),
      });
    }
  }

  let usedBounds: PlateLayoutResult['usedBounds'] = null;
  if (placed.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of placed) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x + p.width > maxX) maxX = p.x + p.width;
      if (p.y + p.depth > maxY) maxY = p.y + p.depth;
    }

    if (centerOnBed) {
      const usedW = maxX - minX;
      const usedD = maxY - minY;
      const shiftX = (bedWidthMm - usedW) / 2 - minX;
      const shiftY = (bedDepthMm - usedD) / 2 - minY;
      if (Math.abs(shiftX) > 1e-6 || Math.abs(shiftY) > 1e-6) {
        for (const p of placed) {
          p.x = r3(p.x + shiftX);
          p.y = r3(p.y + shiftY);
          for (let i = 0; i < p.positions.length; i += 3) {
            p.positions[i] += shiftX;
            p.positions[i + 1] += shiftY;
          }
        }
        minX += shiftX;
        maxX += shiftX;
        minY += shiftY;
        maxY += shiftY;
      }
    }

    usedBounds = {
      minX: r3(minX),
      minY: r3(minY),
      maxX: r3(maxX),
      maxY: r3(maxY),
      width: r3(maxX - minX),
      depth: r3(maxY - minY),
    };
  }

  const placedArea = placed.reduce((sum, p) => sum + p.width * p.depth, 0);
  const bedArea = bedWidthMm * bedDepthMm;

  return {
    bedWidthMm,
    bedDepthMm,
    spacingMm,
    marginMm,
    placed,
    overflow,
    fittedCount: placed.length,
    overflowCount: overflow.length,
    totalIncluded: prepared.length,
    usedBounds,
    utilization: bedArea > 0 ? Math.min(1, placedArea / bedArea) : 0,
  };
}

/**
 * Export the packed print plate as a single ready-to-slice `.3mf` file via `@kit/io`.
 * Each fitted body is written at its packed bed coordinates (mm, Z >= 0).
 */
export async function exportPrintPlate3mf(
  layout: PlateLayoutResult,
  partName: string | undefined,
): Promise<ExportResult> {
  if (!layout.placed.length) {
    return { notices: [{ level: 'error', key: 'io.noBody' }] };
  }
  const stem = fileStem(partName);
  const meshBodies: MeshBody[] = layout.placed.map((b) => ({
    name: b.name,
    positions: b.positions,
    ...(b.color ? { color: b.color } : {}),
    ...(b.opacity !== undefined ? { opacity: b.opacity } : {}),
  }));
  const r = await meshToThreeMf(meshBodies, { title: `${partName || stem} (Print Plate)` });
  if (!r.triangles) {
    return { notices: [{ level: 'error', key: 'io.noBody' }] };
  }
  const name = `${stem}-plate.3mf`;
  const notices: ExportNotice[] = [
    { level: 'info', key: 'io.done3mf', params: { name, triangles: r.triangles, bodies: r.bodies } },
  ];
  if (layout.overflowCount > 0) {
    notices.push({
      level: 'warn',
      key: 'printPlate.overflowNotice',
      params: { count: layout.overflowCount },
    });
  }
  return { file: { name, data: r.data, mime: 'model/3mf' }, notices };
}
