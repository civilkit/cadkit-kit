// Geometry, 3D placement transforms, STEP faceted B-rep generation, and CadKit PartBuilder for @kit/aec.

import type {
  AecElementSummary,
  AecLayer,
  AecLook,
  AecMeshBody,
  AecParameter,
  AecPart,
  AecSatBody,
  AecStepBody,
  AecStorey,
  AecWarning,
  Transform3D,
  V2,
  V3,
} from './types';

export const EPS = 1e-6;

export const clean = (v: number): number => {
  if (!Number.isFinite(v)) return 0;
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};

export const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross3 = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const norm3 = (v: V3, fallback: V3 = [0, 0, 1]): V3 => {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len <= 1e-12) return [...fallback] as V3;
  return [v[0] / len, v[1] / len, v[2] / len];
};

export const IDENTITY_TRANSFORM: Transform3D = {
  o: [0, 0, 0],
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

/**
 * Construct a right-handed orthonormal 3D placement from origin, Z axis (`axis`), and X reference direction (`refDir`),
 * following ISO 10303-42 / IFC `IfcAxis2Placement3D` rules.
 */
export function makeTransform3D(origin?: V3, axis?: V3, refDir?: V3): Transform3D {
  const o: V3 = origin ? [clean(origin[0]), clean(origin[1]), clean(origin[2])] : [0, 0, 0];
  const z = norm3(axis ?? [0, 0, 1], [0, 0, 1]);
  let r = norm3(refDir ?? [1, 0, 0], [1, 0, 0]);
  // Project refDir orthogonal to z
  const d = dot3(r, z);
  let xRaw: V3 = [r[0] - d * z[0], r[1] - d * z[1], r[2] - d * z[2]];
  if (Math.hypot(xRaw[0], xRaw[1], xRaw[2]) <= 1e-9) {
    // Fallback when refDir is parallel to z
    const alt: V3 = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const d2 = dot3(alt, z);
    xRaw = [alt[0] - d2 * z[0], alt[1] - d2 * z[1], alt[2] - d2 * z[2]];
  }
  const x = norm3(xRaw, [1, 0, 0]);
  const y = norm3(cross3(z, x), [0, 1, 0]);
  return { o, x, y, z };
}

/** Transform a local 3D direction vector by `t`. */
export function transformDirection(t: Transform3D, d: V3): V3 {
  return [
    t.x[0] * d[0] + t.y[0] * d[1] + t.z[0] * d[2],
    t.x[1] * d[0] + t.y[1] * d[1] + t.z[1] * d[2],
    t.x[2] * d[0] + t.y[2] * d[1] + t.z[2] * d[2],
  ];
}

/** Transform a local 3D point by `t`. */
export function transformPoint(t: Transform3D, p: V3): V3 {
  const d = transformDirection(t, p);
  return [clean(t.o[0] + d[0]), clean(t.o[1] + d[1]), clean(t.o[2] + d[2])];
}

/** Compose `parent` and `local` 3D placements (`T_world = T_parent * T_local`). */
export function composeTransform(parent: Transform3D, local: Transform3D): Transform3D {
  const o = transformPoint(parent, local.o);
  const x = norm3(transformDirection(parent, local.x), [1, 0, 0]);
  const z = norm3(transformDirection(parent, local.z), [0, 0, 1]);
  const y = norm3(cross3(z, x), [0, 1, 0]);
  return { o, x, y, z };
}

/** Transform 2D points by a 2D placement `(ox, oy)` and 2D X-axis direction `(dx, dy)`. */
export function transformPoints2D(pts: V2[], origin: V2 = [0, 0], xDir: V2 = [1, 0]): V2[] {
  const len = Math.hypot(xDir[0], xDir[1]) || 1;
  const ux = xDir[0] / len;
  const uy = xDir[1] / len;
  const vx = -uy;
  const vy = ux;
  return pts.map(([x, y]) => [
    clean(origin[0] + x * ux + y * vx),
    clean(origin[1] + x * uy + y * vy),
  ]);
}

/** Convert RGB components (either `0..1` floats or `0..255` ints) to `#rrggbb`. */
export function rgbToHex(r: number, g: number, b: number): string {
  const isFloat = r <= 1 && g <= 1 && b <= 1 && (r < 1 || g < 1 || b < 1 || (r === 1 && g === 1 && b === 1));
  const scale = isFloat && Math.max(r, g, b) <= 1 ? 255 : 1;
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round((Number.isFinite(n) ? n : 180) * scale)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Standard AutoCAD Color Index (ACI 1..255) to `#rrggbb`. */
export function aciToHex(aci: number): string {
  const table: Record<number, string> = {
    1: '#e03c31', // Red
    2: '#e5c130', // Yellow
    3: '#3aa655', // Green
    4: '#38b2c4', // Cyan
    5: '#3b6fd4', // Blue
    6: '#c44fb8', // Magenta
    7: '#d4dae0', // White / Default
    8: '#80868c', // Dark Grey
    9: '#b4bac0', // Light Grey
    10: '#d94a38',
    30: '#e07a35',
    40: '#d9a136',
    50: '#c7bd38',
    90: '#4a9e60',
    130: '#499ab8',
    150: '#4c75ba',
    170: '#5a58b8',
    210: '#b55698',
    250: '#54585c',
    251: '#70757a',
    252: '#8c9298',
    253: '#a8afb5',
    254: '#c4cbd1',
    255: '#e2e8f0',
  };
  return table[aci] ?? '#8fa1b3';
}

/** Standard AEC element palette by IFC/BIM category. */
export function defaultAecColor(category: string): { color: string; opacity?: number } {
  const upper = category.toUpperCase();
  if (upper.includes('WALL')) return { color: '#d9d4cc' };
  if (upper.includes('SLAB') || upper.includes('FLOOR')) return { color: '#9ea7b0' };
  if (upper.includes('COLUMN') || upper.includes('PILLAR')) return { color: '#7b8b9e' };
  if (upper.includes('BEAM') || upper.includes('MEMBER') || upper.includes('FRAMING')) return { color: '#5c7a99' };
  if (upper.includes('DOOR')) return { color: '#a67b5b' };
  if (upper.includes('WINDOW') || upper.includes('GLAZING')) return { color: '#88c0d0', opacity: 0.55 };
  if (upper.includes('ROOF')) return { color: '#b5654d' };
  if (upper.includes('STAIR') || upper.includes('RAMP')) return { color: '#b0a89e' };
  if (upper.includes('FOOTING') || upper.includes('FOUNDATION')) return { color: '#7d7a74' };
  if (upper.includes('PLATE') || upper.includes('PANEL')) return { color: '#8fa1b3' };
  return { color: '#99a3ad' };
}

export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/** Deterministic SHA-256 or FNV-based 64-hex key for PartDoc `blobs`. */
export function blobHashHex(text: string): string {
  // 8 independent 32-bit FNV-1a passes with distinct seeds -> 64 lowercase hex characters
  const seeds = [
    0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35,
    0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5,
  ];
  return seeds
    .map((seed, k) => {
      let h = seed >>> 0;
      for (let i = 0; i < text.length; i++) {
        h = Math.imul(h ^ ((text.charCodeAt(i) + k * 31) & 0xffff), 0x01000193);
      }
      return (h >>> 0).toString(16).padStart(8, '0');
    })
    .join('');
}

function bytesToBase64(b: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) {
    s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + CH)));
  }
  if (typeof btoa === 'function') return btoa(s);
  return Buffer.from(b).toString('base64');
}

function fnv1a32(v: Float32Array): string {
  const w = new Uint32Array(v.buffer, v.byteOffset, v.length);
  let h = 0x811c9dc5;
  for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w[i], 0x01000193);
  return (h >>> 0).toString(16);
}

/** Check whether a triangle index buffer forms a closed watertight 2-manifold mesh. */
export function isMeshWatertight(indices: Uint32Array): boolean {
  if (indices.length < 12 || indices.length % 3 !== 0) return false;
  const edgeCounts = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    const pairs: Array<[number, number]> = [
      [a, b],
      [b, c],
      [c, a],
    ];
    for (const [u, v] of pairs) {
      if (u === v) return false;
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  for (const count of edgeCounts.values()) {
    if (count !== 2) return false;
  }
  return edgeCounts.size > 0;
}

/** Convert a triangle mesh into a valid ISO 10303-21 STEP faceted B-rep (`MANIFOLD_SOLID_BREP` / `FACETED_BREP`). */
export function meshToStepFacetedBrep(name: string, vertices: Float32Array, indices: Uint32Array): string {
  const safeName = name.replace(/'/g, "''");
  const lines: string[] = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('CadKit AEC Faceted B-Rep - ${safeName}'),'2;1');`,
    `FILE_NAME('${safeName}.step','2026-11-23T00:00:00',('CadKit'),('CadKit'),'','','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    'ENDSEC;',
    'DATA;',
  ];
  let id = 1;
  const next = () => id++;

  const vertCount = Math.floor(vertices.length / 3);
  const cartIds: number[] = [];
  const vtxIds: number[] = [];
  for (let i = 0; i < vertCount; i++) {
    const x = clean(vertices[i * 3]);
    const y = clean(vertices[i * 3 + 1]);
    const z = clean(vertices[i * 3 + 2]);
    const cid = next();
    const vid = next();
    lines.push(`#${cid}=CARTESIAN_POINT('',(${x},${y},${z}));`);
    lines.push(`#${vid}=VERTEX_POINT('',#${cid});`);
    cartIds.push(cid);
    vtxIds.push(vid);
  }

  const faceIds: number[] = [];
  const triCount = Math.floor(indices.length / 3);
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];
    if (i0 >= vertCount || i1 >= vertCount || i2 >= vertCount) continue;
    const p0: V3 = [vertices[i0 * 3], vertices[i0 * 3 + 1], vertices[i0 * 3 + 2]];
    const p1: V3 = [vertices[i1 * 3], vertices[i1 * 3 + 1], vertices[i1 * 3 + 2]];
    const p2: V3 = [vertices[i2 * 3], vertices[i2 * 3 + 1], vertices[i2 * 3 + 2]];
    const e1: V3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2: V3 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const nRaw = cross3(e1, e2);
    if (Math.hypot(nRaw[0], nRaw[1], nRaw[2]) <= 1e-9) continue;
    const n = norm3(nRaw);
    const ref = norm3(e1);

    const loopId = next();
    const boundId = next();
    const nDirId = next();
    const rDirId = next();
    const axId = next();
    const planeId = next();
    const faceId = next();

    lines.push(`#${loopId}=POLY_LOOP('',(#${cartIds[i0]},#${cartIds[i1]},#${cartIds[i2]}));`);
    lines.push(`#${boundId}=FACE_OUTER_BOUND('',#${loopId},.T.);`);
    lines.push(`#${nDirId}=DIRECTION('',(${clean(n[0])},${clean(n[1])},${clean(n[2])}));`);
    lines.push(`#${rDirId}=DIRECTION('',(${clean(ref[0])},${clean(ref[1])},${clean(ref[2])}));`);
    lines.push(`#${axId}=AXIS2_PLACEMENT_3D('',#${cartIds[i0]},#${nDirId},#${rDirId});`);
    lines.push(`#${planeId}=PLANE('',#${axId});`);
    lines.push(`#${faceId}=FACE_SURFACE('',(#${boundId}),#${planeId},.T.);`);
    faceIds.push(faceId);
  }

  const shellId = next();
  const brepId = next();
  const faceRefs = faceIds.map((f) => `#${f}`).join(',');
  lines.push(`#${shellId}=CLOSED_SHELL('${safeName}',(${faceRefs}));`);
  lines.push(`#${brepId}=FACETED_BREP('${safeName}',#${shellId});`);
  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');
  return lines.join('\n');
}

/** Convert an `AecMeshBody` into a CadKit `MeshRec` stored in `part.meshes`. */
export function meshBodyToMeshRec(m: AecMeshBody): Record<string, unknown> {
  const tris = Math.floor(m.indices.length / 3);
  const verts = Math.floor(m.vertices.length / 3);
  const vBytes = new Uint8Array(m.vertices.buffer, m.vertices.byteOffset, m.vertices.byteLength);
  const iBytes = new Uint8Array(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength);
  return {
    id: m.id,
    name: m.name,
    visible: true,
    opacity: m.opacity,
    color: m.color,
    wire: false,
    unit: 'mm',
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    scale: 1,
    tris,
    verts,
    watertight: m.watertight,
    sig: `${tris}:${verts}:${fnv1a32(m.vertices)}`,
    v: bytesToBase64(vBytes),
    i: bytesToBase64(iBytes),
  };
}

export type SketchCurve2D =
  | { type: 'line'; p1: V2; p2: V2; construction?: boolean }
  | { type: 'arc'; center: V2; p1: V2; p2: V2; ccw?: boolean; construction?: boolean }
  | { type: 'circle'; center: V2; r: number; construction?: boolean };

const STD_PLANES: Record<'front' | 'top' | 'right', { x: V3; y: V3; z: V3 }> = {
  front: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
  top: { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] },
  right: { x: [0, 0, -1], y: [0, 1, 0], z: [1, 0, 0] },
};

/**
 * Clean-room builder for CadKit `AecPart` and `AecImportReport` structures.
 */
export class PartBuilder {
  readonly name: string;
  seq = 1;
  readonly features: Array<Record<string, unknown>> = [];
  readonly variables: Array<{ name: string; expr: string }> = [];
  readonly seenVars = new Set<string>();
  readonly blobs: Record<string, string> = {};
  readonly appearance: Record<string, AecLook> = {};
  readonly bodyNames: Record<string, string> = {};
  readonly usedBodyNames = new Set<string>();
  readonly meshes: AecMeshBody[] = [];
  readonly storeys = new Map<string, AecStorey>();
  readonly layers = new Map<string, AecLayer>();
  readonly elements: AecElementSummary[] = [];
  readonly parameters: AecParameter[] = [];
  readonly satBodies: AecSatBody[] = [];
  readonly stepBodies: AecStepBody[] = [];
  readonly warnings: AecWarning[] = [];
  private readonly offsetPlanes = new Map<string, string>();
  upAxis: 'y' | 'z' = 'z';

  constructor(name: string) {
    this.name = name || 'Part1';
  }

  nextId(): string {
    return `F${this.seq++}`;
  }

  warn(object: string, code: string, message: string): void {
    this.warnings.push({ object, code, message });
  }

  uniqueBodyName(raw: string): string {
    const base = (raw || 'Body').trim() || 'Body';
    if (!this.usedBodyNames.has(base)) {
      this.usedBodyNames.add(base);
      return base;
    }
    let k = 2;
    while (this.usedBodyNames.has(`${base} (${k})`)) k++;
    const candidate = `${base} (${k})`;
    this.usedBodyNames.add(candidate);
    return candidate;
  }

  addParameter(name: string, expr: string, rawValue?: string | number, unit?: string, group?: string): void {
    const cleanName = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
    if (!cleanName) return;
    this.parameters.push({ name: cleanName, expr, ...(rawValue !== undefined ? { rawValue } : {}), ...(unit ? { unit } : {}), ...(group ? { group } : {}) });
    if (!this.seenVars.has(cleanName)) {
      this.seenVars.add(cleanName);
      this.variables.push({ name: cleanName, expr });
    }
  }

  ensureStorey(id: string, name: string, elevationMm: number): AecStorey {
    let s = this.storeys.get(id);
    if (!s) {
      for (const existing of this.storeys.values()) {
        if (existing.name === name || existing.id === name) {
          s = existing;
          break;
        }
      }
    }
    if (!s) {
      s = { id, name, elevationMm: clean(elevationMm), elementIds: [], featureIds: [] };
      this.storeys.set(id, s);
    }
    return s;
  }

  ensureLayer(name: string, color = '#8fa1b3', visible = true, index?: number): AecLayer {
    let l = this.layers.get(name);
    if (!l) {
      l = { index: index ?? this.layers.size, name, color, visible, elementCount: 0 };
      this.layers.set(name, l);
    }
    return l;
  }

  /**
   * Resolve a 3D frame `{ o, x, y, z }` to a CadKit sketch plane reference, returning:
   * - `plane`: `{ kind: 'std', id }` or `{ kind: 'feature', id }`
   * - `map2D(u, v)`: maps local 2D coordinates `(u, v)` on `frame` into the resolved plane's 2D coordinates
   * - `normalSign`: `+1` if the resolved plane's normal agrees with `frame.z`, `-1` if opposite
   * - `mirrored`: true if the 2D mapping reverses orientation
   */
  resolveSketchPlane(
    frame: Transform3D,
    group?: string,
  ): {
    plane: Record<string, unknown>;
    planeFeatId?: string;
    map2D: (u: number, v: number) => V2;
    normalSign: 1 | -1;
    mirrored: boolean;
  } {
    for (const [stdId, std] of Object.entries(STD_PLANES) as Array<['front' | 'top' | 'right', { x: V3; y: V3; z: V3 }]>) {
      const d = dot3(frame.z, std.z);
      if (Math.abs(Math.abs(d) - 1) <= 1e-5) {
        const normalSign: 1 | -1 = d >= 0 ? 1 : -1;
        const offset = clean(dot3(frame.o, std.z));
        const map2D = (u: number, v: number): V2 => {
          const worldPt = transformPoint(frame, [u, v, 0]);
          return [clean(dot3(worldPt, std.x)), clean(dot3(worldPt, std.y))];
        };
        const t00 = dot3(frame.x, std.x);
        const t01 = dot3(frame.y, std.x);
        const t10 = dot3(frame.x, std.y);
        const t11 = dot3(frame.y, std.y);
        const mirrored = t00 * t11 - t01 * t10 < 0;

        if (Math.abs(offset) <= 1e-5) {
          return { plane: { kind: 'std', id: stdId }, map2D, normalSign, mirrored };
        }
        const cacheKey = `${stdId}:${offset}:${group ?? ''}`;
        let pid = this.offsetPlanes.get(cacheKey);
        let createdPid: string | undefined;
        if (!pid) {
          pid = this.nextId();
          createdPid = pid;
          this.offsetPlanes.set(cacheKey, pid);
          this.features.push({
            type: 'plane',
            id: pid,
            name: `${stdId.toUpperCase()} + ${offset} mm`,
            mode: 'offset',
            base: { kind: 'std', id: stdId },
            offset,
            visible: false,
            ...(group ? { group } : {}),
          });
        }
        return { plane: { kind: 'feature', id: pid }, planeFeatId: createdPid, map2D, normalSign, mirrored };
      }
    }

    // Tilted plane: emit a custom `mode: 'frame'` plane feature
    const pid = this.nextId();
    this.features.push({
      type: 'plane',
      id: pid,
      mode: 'frame',
      origin: frame.o.map(clean),
      xDir: frame.x.map(clean),
      yDir: frame.y.map(clean),
      visible: false,
      ...(group ? { group } : {}),
    });
    return {
      plane: { kind: 'feature', id: pid },
      planeFeatId: pid,
      map2D: (u: number, v: number): V2 => [clean(u), clean(v)],
      normalSign: 1,
      mirrored: false,
    };
  }

  private recordAppearance(featId: string, bodyName: string, color?: string, opacity?: number): void {
    if (color || (opacity !== undefined && opacity < 1)) {
      const look: AecLook = {};
      if (color) look.color = color.toLowerCase();
      if (opacity !== undefined && opacity < 1) look.opacity = Math.max(0.05, clean(opacity));
      this.appearance[featId] = look;
      this.appearance[`@name:${bodyName}`] = look;
    }
    this.bodyNames[featId] = bodyName;
  }

  /**
   * Add a 2D sketch + 3D extrude from one outer polygon and optional inner hole polygons.
   */
  addExtrudedPolygon(opts: {
    id?: string;
    name: string;
    category: string;
    outer: V2[];
    holes?: V2[][];
    frame: Transform3D;
    extrudeDir?: V3;
    depth: number;
    storeyId?: string;
    storeyName?: string;
    layerName?: string;
    color?: string;
    opacity?: number;
  }): string[] {
    const curves: SketchCurve2D[] = [];
    const pushLoop = (loop: V2[]) => {
      const pts = loop.filter((p, i) => i === 0 || Math.hypot(p[0] - loop[i - 1][0], p[1] - loop[i - 1][1]) > 1e-5);
      if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-5) {
        pts.pop();
      }
      if (pts.length < 3) return;
      for (let i = 0; i < pts.length; i++) {
        curves.push({ type: 'line', p1: pts[i], p2: pts[(i + 1) % pts.length] });
      }
    };
    pushLoop(opts.outer);
    for (const h of opts.holes ?? []) pushLoop(h);
    return this.addExtrudedCurves({
      ...opts,
      curves,
    });
  }

  /**
   * Add a 2D sketch + 3D extrude from a circular or hollow circular profile.
   */
  addExtrudedCircle(opts: {
    id?: string;
    name: string;
    category: string;
    center?: V2;
    radius: number;
    innerRadius?: number;
    frame: Transform3D;
    extrudeDir?: V3;
    depth: number;
    storeyId?: string;
    storeyName?: string;
    layerName?: string;
    color?: string;
    opacity?: number;
  }): string[] {
    const c: V2 = opts.center ?? [0, 0];
    const curves: SketchCurve2D[] = [{ type: 'circle', center: c, r: clean(opts.radius) }];
    if (opts.innerRadius && opts.innerRadius > 1e-5 && opts.innerRadius < opts.radius) {
      curves.push({ type: 'circle', center: c, r: clean(opts.innerRadius) });
    }
    return this.addExtrudedCurves({
      ...opts,
      curves,
    });
  }

  /**
   * Add a 2D sketch + 3D extrude from arbitrary 2D curves (`line`, `arc`, `circle`).
   */
  addExtrudedCurves(opts: {
    id?: string;
    name: string;
    category: string;
    curves: SketchCurve2D[];
    frame: Transform3D;
    extrudeDir?: V3;
    depth: number;
    storeyId?: string;
    storeyName?: string;
    layerName?: string;
    color?: string;
    opacity?: number;
  }): string[] {
    if (!opts.curves.length || !(Math.abs(opts.depth) > 1e-6)) return [];
    const group = opts.storeyName ?? opts.layerName;

    // Handle tilted ExtrudedDirection in local space if not parallel to local Z
    let effectiveFrame = opts.frame;
    let effectiveDepth = Math.abs(opts.depth);
    let localDirSign: 1 | -1 = opts.depth < 0 ? -1 : 1;
    if (opts.extrudeDir) {
      const d = norm3(opts.extrudeDir, [0, 0, 1]);
      if (d[2] < -1e-6) localDirSign = (localDirSign * -1) as 1 | -1;
      if (Math.abs(d[2]) > 1e-4) {
        effectiveDepth = Math.abs(opts.depth) * Math.abs(d[2]);
      }
    }

    const { plane, planeFeatId, map2D, normalSign, mirrored } = this.resolveSketchPlane(effectiveFrame, group);
    const { points, entities } = this.buildSketchGeometry(opts.curves, map2D, mirrored);
    if (!entities.length) return [];

    const sid = this.nextId();
    const eid = this.nextId();
    const bodyName = this.uniqueBodyName(opts.name);
    const flip = localDirSign * normalSign < 0;

    this.features.push({
      type: 'sketch',
      id: sid,
      name: `${opts.name} Sketch`,
      plane,
      points,
      entities,
      constraints: [],
      visible: false,
      ...(group ? { group } : {}),
    });

    this.features.push({
      type: 'extrude',
      id: eid,
      name: opts.name,
      op: 'newBody',
      body: bodyName,
      sketch: sid,
      end: 'blind',
      depth: clean(effectiveDepth),
      ...(flip ? { flip: true } : {}),
      ...(group ? { group } : {}),
      aecCategory: opts.category,
      ...(opts.id ? { aecId: opts.id } : {}),
    });

    const palette = defaultAecColor(opts.category);
    const color = opts.color ?? palette.color;
    const opacity = opts.opacity ?? palette.opacity;
    this.recordAppearance(eid, bodyName, color, opacity);

    const createdIds = planeFeatId ? [planeFeatId, sid, eid] : [sid, eid];
    this.recordElement({
      id: opts.id ?? eid,
      name: opts.name,
      category: opts.category,
      storeyId: opts.storeyId,
      storeyName: opts.storeyName,
      layerName: opts.layerName,
      color,
      opacity,
      placement: effectiveFrame,
      representation: 'extrude',
      featureIds: createdIds,
    });
    return createdIds;
  }

  /**
   * Add a 3D sphere feature (`type: 'sphere'`).
   */
  addSphere(opts: {
    id?: string;
    name: string;
    category: string;
    center: V3;
    radius: number;
    storeyId?: string;
    storeyName?: string;
    layerName?: string;
    color?: string;
    opacity?: number;
  }): string[] {
    if (!(opts.radius > 1e-6)) return [];
    const group = opts.storeyName ?? opts.layerName;
    const fid = this.nextId();
    const bodyName = this.uniqueBodyName(opts.name);
    const c: V3 = [clean(opts.center[0]), clean(opts.center[1]), clean(opts.center[2])];

    this.features.push({
      type: 'sphere',
      id: fid,
      name: opts.name,
      op: 'newBody',
      body: bodyName,
      center: c,
      radius: clean(opts.radius),
      ...(group ? { group } : {}),
      aecCategory: opts.category,
    });

    const palette = defaultAecColor(opts.category);
    const color = opts.color ?? palette.color;
    const opacity = opts.opacity ?? palette.opacity;
    this.recordAppearance(fid, bodyName, color, opacity);

    this.recordElement({
      id: opts.id ?? fid,
      name: opts.name,
      category: opts.category,
      storeyId: opts.storeyId,
      storeyName: opts.storeyName,
      layerName: opts.layerName,
      color,
      opacity,
      placement: makeTransform3D(c),
      representation: 'primitive',
      featureIds: [fid],
    });
    return [fid];
  }

  /**
   * Add a revolved surface/solid feature (`sketch` + `revolve`).
   */
  addRevolve(opts: {
    id?: string;
    name: string;
    category: string;
    profile: V2[];
    axisOrigin?: V2;
    axisDir?: V2;
    angleDeg?: number;
    frame: Transform3D;
    storeyId?: string;
    storeyName?: string;
    layerName?: string;
    color?: string;
    opacity?: number;
  }): string[] {
    if (opts.profile.length < 3) return [];
    const group = opts.storeyName ?? opts.layerName;
    const { plane, planeFeatId, map2D, mirrored } = this.resolveSketchPlane(opts.frame, group);
    const curves: SketchCurve2D[] = [];
    for (let i = 0; i < opts.profile.length; i++) {
      curves.push({ type: 'line', p1: opts.profile[i], p2: opts.profile[(i + 1) % opts.profile.length] });
    }
    const axO = opts.axisOrigin ?? [0, 0];
    const axD = opts.axisDir ?? [0, 1];
    curves.push({
      type: 'line',
      p1: axO,
      p2: [axO[0] + axD[0] * 100, axO[1] + axD[1] * 100],
      construction: true,
    });

    const { points, entities } = this.buildSketchGeometry(curves, map2D, mirrored);
    const axisEnt = entities[entities.length - 1];
    const sid = this.nextId();
    const rid = this.nextId();
    const bodyName = this.uniqueBodyName(opts.name);

    this.features.push({
      type: 'sketch',
      id: sid,
      name: `${opts.name} Sketch`,
      plane,
      points,
      entities,
      constraints: [],
      visible: false,
      ...(group ? { group } : {}),
    });

    this.features.push({
      type: 'revolve',
      id: rid,
      name: opts.name,
      op: 'newBody',
      body: bodyName,
      sketch: sid,
      axis: String(axisEnt.id),
      end: 'blind',
      angle: clean(opts.angleDeg ?? 360),
      ...(group ? { group } : {}),
      aecCategory: opts.category,
    });

    const palette = defaultAecColor(opts.category);
    const color = opts.color ?? palette.color;
    const opacity = opts.opacity ?? palette.opacity;
    this.recordAppearance(rid, bodyName, color, opacity);

    const createdIds = planeFeatId ? [planeFeatId, sid, rid] : [sid, rid];
    this.recordElement({
      id: opts.id ?? rid,
      name: opts.name,
      category: opts.category,
      storeyId: opts.storeyId,
      storeyName: opts.storeyName,
      layerName: opts.layerName,
      color,
      opacity,
      placement: opts.frame,
      representation: 'revolve',
      featureIds: createdIds,
    });
    return createdIds;
  }

  /**
   * Add a standalone 2D sketch feature (e.g. from DWG / 3DM 2D curves).
   */
  addSketch2D(opts: {
    id?: string;
    name: string;
    category: string;
    curves: SketchCurve2D[];
    frame: Transform3D;
    storeyId?: string;
    storeyName?: string;
    layerName?: string;
    color?: string;
  }): string[] {
    if (!opts.curves.length) return [];
    const group = opts.storeyName ?? opts.layerName;
    const { plane, planeFeatId, map2D, mirrored } = this.resolveSketchPlane(opts.frame, group);
    const { points, entities } = this.buildSketchGeometry(opts.curves, map2D, mirrored);
    if (!entities.length) return [];

    const sid = this.nextId();
    this.features.push({
      type: 'sketch',
      id: sid,
      name: opts.name,
      plane,
      points,
      entities,
      constraints: [],
      ...(group ? { group } : {}),
    });

    const color = opts.color ?? defaultAecColor(opts.category).color;
    const createdIds = planeFeatId ? [planeFeatId, sid] : [sid];
    this.recordElement({
      id: opts.id ?? sid,
      name: opts.name,
      category: opts.category,
      storeyId: opts.storeyId,
      storeyName: opts.storeyName,
      layerName: opts.layerName,
      color,
      placement: opts.frame,
      representation: 'sketch',
      featureIds: createdIds,
    });
    return createdIds;
  }

  /**
   * Add a tessellated / faceted B-rep mesh body (`IFCTRIANGULATEDFACESET`, `IFCFACETEDBREP`, `IFCPOLYGONALFACESET`,
   * Rhino `ON_Mesh`, DWG/RVT mesh):
   * 1. Stores the `AecMeshBody` in `report.meshes` and `MeshRec` in `part.meshes`,
   * 2. Generates the ISO 10303-21 STEP `FACETED_BREP` representation in `report.stepBodies` and `part.blobs`,
   * 3. Reconstructs a native CadKit `sketch` + `extrude` feature from the mesh's 3D bounding/footprint prism so
   *    the element is also a first-class feature in `part.features` with its storey/layer folder and appearance color!
   */
  addMeshBody(opts: {
    id?: string;
    name: string;
    category: string;
    vertices: Float32Array;
    indices: Uint32Array;
    placement?: Transform3D;
    storeyId?: string;
    storeyName?: string;
    layerName?: string;
    color?: string;
    opacity?: number;
  }): AecMeshBody | null {
    if (opts.vertices.length < 9 || opts.indices.length < 3) return null;
    const palette = defaultAecColor(opts.category);
    const color = (opts.color ?? palette.color).toLowerCase();
    const opacity = opts.opacity ?? palette.opacity ?? 1;
    const meshId = `mesh${this.meshes.length + 1}`;
    const watertight = isMeshWatertight(opts.indices);
    const stepFacetedBrep = meshToStepFacetedBrep(opts.name, opts.vertices, opts.indices);

    const meshBody: AecMeshBody = {
      id: meshId,
      name: opts.name,
      color,
      opacity,
      ...(opts.storeyName ? { storey: opts.storeyName } : {}),
      ...(opts.layerName ? { layer: opts.layerName } : {}),
      category: opts.category,
      vertices: opts.vertices,
      indices: opts.indices,
      watertight,
      stepFacetedBrep,
    };
    this.meshes.push(meshBody);
    this.stepBodies.push({
      name: opts.name,
      step: stepFacetedBrep,
      ...(opts.layerName ? { layer: opts.layerName } : {}),
      ...(opts.storeyName ? { storey: opts.storeyName } : {}),
      color,
    });
    const hash = blobHashHex(stepFacetedBrep);
    this.blobs[hash] = stepFacetedBrep;

    // Compute 3D bounding box of the mesh vertices to create a matching parametric proxy feature in part.features
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < opts.vertices.length; i += 3) {
      const x = opts.vertices[i];
      const y = opts.vertices[i + 1];
      const z = opts.vertices[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const dx = Math.max(1, clean(maxX - minX));
    const dy = Math.max(1, clean(maxY - minY));
    const dz = Math.max(1, clean(maxZ - minZ));
    const baseFrame = makeTransform3D([clean(minX), clean(minY), clean(minZ)], [0, 0, 1], [1, 0, 0]);
    const group = opts.storeyName ?? opts.layerName;
    const { plane, planeFeatId, map2D, mirrored } = this.resolveSketchPlane(baseFrame, group);
    const rectCurves: SketchCurve2D[] = [
      { type: 'line', p1: [0, 0], p2: [dx, 0] },
      { type: 'line', p1: [dx, 0], p2: [dx, dy] },
      { type: 'line', p1: [dx, dy], p2: [0, dy] },
      { type: 'line', p1: [0, dy], p2: [0, 0] },
    ];
    const { points, entities } = this.buildSketchGeometry(rectCurves, map2D, mirrored);
    const sid = this.nextId();
    const eid = this.nextId();
    const bodyName = this.uniqueBodyName(opts.name);

    this.features.push({
      type: 'sketch',
      id: sid,
      name: `${opts.name} Footprint`,
      plane,
      points,
      entities,
      constraints: [],
      visible: false,
      ...(group ? { group } : {}),
    });
    this.features.push({
      type: 'extrude',
      id: eid,
      name: opts.name,
      op: 'newBody',
      body: bodyName,
      sketch: sid,
      end: 'blind',
      depth: dz,
      ...(group ? { group } : {}),
      aecCategory: opts.category,
      aecRepresentation: 'mesh',
      meshId,
      stepBlob: hash,
      ...(opts.id ? { aecId: opts.id } : {}),
    });
    this.recordAppearance(eid, bodyName, color, opacity);

    const createdIds = planeFeatId ? [planeFeatId, sid, eid] : [sid, eid];
    this.recordElement({
      id: opts.id ?? meshId,
      name: opts.name,
      category: opts.category,
      storeyId: opts.storeyId,
      storeyName: opts.storeyName,
      layerName: opts.layerName,
      color,
      opacity,
      placement: opts.placement ?? baseFrame,
      representation: 'mesh',
      featureIds: createdIds,
      meshId,
    });

    return meshBody;
  }

  private recordElement(info: {
    id: string;
    name: string;
    category: string;
    storeyId?: string;
    storeyName?: string;
    layerName?: string;
    color: string;
    opacity?: number;
    placement: Transform3D;
    representation: AecElementSummary['representation'];
    featureIds: string[];
    meshId?: string;
  }): void {
    this.elements.push({
      id: info.id,
      name: info.name,
      category: info.category,
      ...(info.storeyName ? { storey: info.storeyName } : {}),
      ...(info.layerName ? { layer: info.layerName } : {}),
      color: info.color,
      ...(info.opacity !== undefined ? { opacity: info.opacity } : {}),
      placement: info.placement,
      representation: info.representation,
      featureIds: info.featureIds,
      ...(info.meshId ? { meshId: info.meshId } : {}),
    });

    if (info.storeyId || info.storeyName) {
      const sKey = info.storeyId ?? info.storeyName!;
      const st = this.ensureStorey(sKey, info.storeyName ?? sKey, info.placement.o[2]);
      if (!st.elementIds.includes(info.id)) st.elementIds.push(info.id);
      for (const fid of info.featureIds) {
        if (!st.featureIds.includes(fid)) st.featureIds.push(fid);
      }
    }
    if (info.layerName) {
      const l = this.ensureLayer(info.layerName, info.color);
      l.elementCount++;
    }
  }

  private buildSketchGeometry(
    curves: SketchCurve2D[],
    map2D: (u: number, v: number) => V2,
    mirrored: boolean,
  ): { points: Array<Record<string, unknown>>; entities: Array<Record<string, unknown>> } {
    const points: Array<Record<string, unknown>> = [{ id: 'O', x: 0, y: 0, fixed: true }];
    const entities: Array<Record<string, unknown>> = [];
    const mergedEndpoints: Array<{ id: string; x: number; y: number }> = [];
    let pn = 0;
    let en = 0;

    const addPoint = (u: number, v: number, merge: boolean): string => {
      const [x, y] = map2D(u, v);
      if (merge) {
        const hit = mergedEndpoints.find((p) => Math.hypot(p.x - x, p.y - y) <= 1e-5);
        if (hit) return hit.id;
      }
      const id = `p${++pn}`;
      points.push({ id, x, y });
      if (merge) mergedEndpoints.push({ id, x, y });
      return id;
    };

    for (const c of curves) {
      const extra = c.construction ? { construction: true } : {};
      if (c.type === 'line') {
        const p1 = addPoint(c.p1[0], c.p1[1], !c.construction);
        const p2 = addPoint(c.p2[0], c.p2[1], !c.construction);
        if (p1 === p2) continue;
        entities.push({ id: `e${++en}`, type: 'line', p1, p2, ...extra });
      } else if (c.type === 'circle') {
        if (!(c.r > 1e-6)) continue;
        const cp = addPoint(c.center[0], c.center[1], false);
        entities.push({ id: `e${++en}`, type: 'circle', c: cp, r: clean(c.r), ...extra });
      } else if (c.type === 'arc') {
        const cp = addPoint(c.center[0], c.center[1], false);
        const flipOrder = (c.ccw === false) !== mirrored;
        const [a, b] = flipOrder ? [c.p2, c.p1] : [c.p1, c.p2];
        const p1 = addPoint(a[0], a[1], !c.construction);
        const p2 = addPoint(b[0], b[1], !c.construction);
        if (p1 === p2) continue;
        entities.push({ id: `e${++en}`, type: 'arc', c: cp, p1, p2, ...extra });
      }
    }

    return { points, entities };
  }

  buildPart(): AecPart {
    const meshRecs = this.meshes.map(meshBodyToMeshRec);
    return {
      format: 'ck-part',
      version: 1,
      name: this.name,
      features: this.features,
      seq: this.seq,
      rollback: null,
      material: 'steel',
      counters: {},
      upAxis: this.upAxis,
      ...(this.variables.length ? { variables: this.variables } : {}),
      ...(Object.keys(this.blobs).length ? { blobs: this.blobs } : {}),
      ...(Object.keys(this.appearance).length ? { appearance: this.appearance } : {}),
      ...(Object.keys(this.bodyNames).length ? { bodyNames: this.bodyNames } : {}),
      ...(meshRecs.length ? { meshes: meshRecs } : {}),
    };
  }
}
