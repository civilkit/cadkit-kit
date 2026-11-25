// Contact Sets for assemblies and motion studies: per-body triangle BVH + OBB/AABB broadphase, exact triangle-triangle contact and
// penetration solver, continuous swept TOI clamping (`clampTransformToContactSets`), contact-driven push (`solveContactPush`), and driver
// travel range discovery (`findMotionContactRange`).
import { isFrame, lerpRigid, rigidOf, type Frame, type Rigid, type V3 } from './model';

export interface ContactSet {
  id: string;
  name: string;
  enabled: boolean;
  memberIds: string[];
  clearanceMm?: number;
}

export interface BodyMesh {
  positions: Float32Array | number[];
  indices?: Uint32Array | number[];
  bvh?: MeshBVH;
}

export interface TranslationRotationTransform {
  translation?: [number, number, number] | number[];
  rotation?: number[];
  r?: number[];
  t?: number[];
}

export type BodyTransform = Rigid | Frame | TranslationRotationTransform | Float32Array | Float64Array | number[];

export interface ContactCollision {
  setId: string;
  bodyA: string;
  bodyB: string;
  penetrationMm: number;
  contactPoint: [number, number, number];
  normal: [number, number, number];
}

export interface ClampContactOptions {
  iterations?: number;
  substeps?: number;
  toleranceMm?: number;
  pushFreeBodies?: boolean;
  freeBodyIds?: ReadonlyArray<string> | ReadonlySet<string>;
}

export interface ClampContactResult<T = BodyTransform> {
  clamped: boolean;
  tImpact: number;
  transform: T;
  clampedTransform: Rigid;
  contact: ContactCollision | null;
  contacts: ContactCollision[];
  pushedTransforms?: Record<string, Rigid>;
}

export interface ContactPushOptions {
  maxIterations?: number;
  freeBodyIds?: ReadonlyArray<string> | ReadonlySet<string>;
}

export interface ContactPushEvent {
  bodyId: string;
  pushedBy: string;
  delta: [number, number, number];
  distanceMm: number;
  normal: [number, number, number];
  transform: Rigid;
}

export interface ContactPushResult {
  transforms: Record<string, Rigid>;
  pushedBodyIds: string[];
  pushes: ContactPushEvent[];
  remainingContacts: ContactCollision[];
}

export interface MotionContactBoundEvent extends ContactCollision {
  value: number;
  contact: ContactCollision;
}

export interface MotionContactRangeResult {
  freeMin: number;
  freeMax: number;
  range: [number, number];
  minContact: MotionContactBoundEvent | null;
  maxContact: MotionContactBoundEvent | null;
}

// ---- ContactSet document persistence helpers -------------------------------------------------------------------------------------

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function readContactSets(motion: unknown): ContactSet[] {
  if (!motion || typeof motion !== 'object') return [];
  const raw = (motion as Record<string, unknown>).contactSets;
  if (!Array.isArray(raw)) return [];
  const out: ContactSet[] = [];
  for (const s of raw as Array<Record<string, unknown>>) {
    if (!s || typeof s.id !== 'string') continue;
    const memberIds = Array.isArray(s.memberIds) ? s.memberIds.filter((m): m is string => typeof m === 'string' && m.length > 0) : [];
    const clearanceMm = num(s.clearanceMm) && s.clearanceMm >= 0 ? s.clearanceMm : undefined;
    out.push({
      id: s.id,
      name: typeof s.name === 'string' && s.name.trim() ? s.name : s.id,
      enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
      memberIds: [...new Set(memberIds)],
      ...(clearanceMm !== undefined ? { clearanceMm } : {}),
    });
  }
  return out;
}

export function readStopOnContact(motion: unknown): boolean {
  if (!motion || typeof motion !== 'object') return false;
  return (motion as Record<string, unknown>).stopOnContact === true;
}

export function newContactSetId(existing: ReadonlyArray<{ id: string }>): string {
  let n = existing.length + 1;
  while (existing.some((s) => s.id === 'cs' + n)) n++;
  return 'cs' + n;
}

export function withContactSet(motion: Record<string, unknown>, set: ContactSet): ContactSet[] {
  const all = readContactSets(motion);
  const i = all.findIndex((s) => s.id === set.id);
  if (i >= 0) all[i] = set;
  else all.push(set);
  return all;
}

export function withoutContactSet(motion: Record<string, unknown>, id: string): ContactSet[] {
  return readContactSets(motion).filter((s) => s.id !== id);
}

export function toggleContactSetMember(set: ContactSet, memberId: string): ContactSet {
  const has = set.memberIds.includes(memberId);
  return {
    ...set,
    memberIds: has ? set.memberIds.filter((m) => m !== memberId) : [...set.memberIds, memberId],
  };
}

// ---- Transform normalization & formatting -----------------------------------------------------------------------------------------

const IDENTITY_R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const IDENTITY_RIGID: Rigid = { r: [...IDENTITY_R], t: [0, 0, 0] };

function quatToMat3(q: number[]): number[] {
  // Support [w, x, y, z] or [x, y, z, w]: wait, in model.ts Quat is [w, x, y, z].
  // Check if someone passed [w, x, y, z] vs [x, y, z, w]: we use [w, x, y, z] by default,
  // unless it's clearly identity [0, 0, 0, 1].
  let w = q[0], x = q[1], y = q[2], z = q[3];
  if (Math.abs(q[0]) < 1e-9 && Math.abs(q[1]) < 1e-9 && Math.abs(q[2]) < 1e-9 && Math.abs(Math.abs(q[3]) - 1) < 1e-6) {
    x = q[0]; y = q[1]; z = q[2]; w = q[3];
  }
  const n = Math.hypot(w, x, y, z) || 1;
  w /= n; x /= n; y /= n; z /= n;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

function eulerToMat3(rx: number, ry: number, rz: number): number[] {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cy * cz, cz * sx * sy - cx * sz, cx * cz * sy + sx * sz,
    cy * sz, cx * cz + sx * sy * sz, cx * sy * sz - cz * sx,
    -sy, cy * sx, cx * cy,
  ];
}

export function normalizeTransform(xf?: BodyTransform | null): Rigid {
  if (!xf) return { r: [...IDENTITY_R], t: [0, 0, 0] };
  if (Array.isArray(xf) || xf instanceof Float32Array || xf instanceof Float64Array) {
    if (xf.length === 16) {
      // Detect column-major vs row-major 4x4 matrix:
      // In column-major (WebGL/Three.js), translation is at [12, 13, 14] and bottom row [3, 7, 11] is [0, 0, 0].
      // In row-major, translation is at [3, 7, 11] and [12, 13, 14] is [0, 0, 0].
      const rowMajorTrans = Math.abs(xf[3]) + Math.abs(xf[7]) + Math.abs(xf[11]);
      const colMajorTrans = Math.abs(xf[12]) + Math.abs(xf[13]) + Math.abs(xf[14]);
      if (rowMajorTrans > 0 && colMajorTrans === 0) {
        return {
          r: [xf[0], xf[1], xf[2], xf[4], xf[5], xf[6], xf[8], xf[9], xf[10]],
          t: [xf[3], xf[7], xf[11]],
        };
      }
      return {
        r: [xf[0], xf[4], xf[8], xf[1], xf[5], xf[9], xf[2], xf[6], xf[10]],
        t: [xf[12], xf[13], xf[14]],
      };
    }
    if (xf.length === 3) {
      return { r: [...IDENTITY_R], t: [xf[0], xf[1], xf[2]] };
    }
    return { r: [...IDENTITY_R], t: [0, 0, 0] };
  }
  if (isFrame(xf)) return rigidOf(xf);
  const obj = xf as TranslationRotationTransform;
  let r = IDENTITY_R;
  if (Array.isArray(obj.r) && obj.r.length === 9) {
    r = [...obj.r];
  } else if (Array.isArray(obj.rotation)) {
    if (obj.rotation.length === 9) r = [...obj.rotation];
    else if (obj.rotation.length === 4) r = quatToMat3(obj.rotation);
    else if (obj.rotation.length === 3) r = eulerToMat3(obj.rotation[0], obj.rotation[1], obj.rotation[2]);
  }
  let t: number[] = [0, 0, 0];
  if (Array.isArray(obj.t) && obj.t.length >= 3) {
    t = [obj.t[0], obj.t[1], obj.t[2]];
  } else if (Array.isArray(obj.translation) && obj.translation.length >= 3) {
    t = [obj.translation[0], obj.translation[1], obj.translation[2]];
  }
  return { r: [...r], t };
}

function formatTransformLike<T extends BodyTransform>(rigid: Rigid, template: T): T {
  if (template instanceof Float32Array && template.length === 16) {
    const rowMajor = (Math.abs(template[3]) + Math.abs(template[7]) + Math.abs(template[11])) > 0 &&
      (Math.abs(template[12]) + Math.abs(template[13]) + Math.abs(template[14])) === 0;
    const out = new Float32Array(16);
    if (rowMajor) {
      out[0] = rigid.r[0]; out[1] = rigid.r[1]; out[2] = rigid.r[2]; out[3] = rigid.t[0];
      out[4] = rigid.r[3]; out[5] = rigid.r[4]; out[6] = rigid.r[5]; out[7] = rigid.t[1];
      out[8] = rigid.r[6]; out[9] = rigid.r[7]; out[10] = rigid.r[8]; out[11] = rigid.t[2];
      out[15] = 1;
    } else {
      out[0] = rigid.r[0]; out[4] = rigid.r[1]; out[8] = rigid.r[2]; out[12] = rigid.t[0];
      out[1] = rigid.r[3]; out[5] = rigid.r[4]; out[9] = rigid.r[5]; out[13] = rigid.t[1];
      out[2] = rigid.r[6]; out[6] = rigid.r[7]; out[10] = rigid.r[8]; out[14] = rigid.t[2];
      out[15] = 1;
    }
    return out as unknown as T;
  }
  if (template instanceof Float64Array && template.length === 16) {
    const out = new Float64Array(16);
    out[0] = rigid.r[0]; out[4] = rigid.r[1]; out[8] = rigid.r[2]; out[12] = rigid.t[0];
    out[1] = rigid.r[3]; out[5] = rigid.r[4]; out[9] = rigid.r[5]; out[13] = rigid.t[1];
    out[2] = rigid.r[6]; out[6] = rigid.r[7]; out[10] = rigid.r[8]; out[14] = rigid.t[2];
    out[15] = 1;
    return out as unknown as T;
  }
  if (Array.isArray(template) && template.length === 16) {
    const rowMajor = (Math.abs(template[3]) + Math.abs(template[7]) + Math.abs(template[11])) > 0 &&
      (Math.abs(template[12]) + Math.abs(template[13]) + Math.abs(template[14])) === 0;
    if (rowMajor) {
      return [
        rigid.r[0], rigid.r[1], rigid.r[2], rigid.t[0],
        rigid.r[3], rigid.r[4], rigid.r[5], rigid.t[1],
        rigid.r[6], rigid.r[7], rigid.r[8], rigid.t[2],
        0, 0, 0, 1,
      ] as unknown as T;
    }
    return [
      rigid.r[0], rigid.r[3], rigid.r[6], 0,
      rigid.r[1], rigid.r[4], rigid.r[7], 0,
      rigid.r[2], rigid.r[5], rigid.r[8], 0,
      rigid.t[0], rigid.t[1], rigid.t[2], 1,
    ] as unknown as T;
  }
  if (isFrame(template)) {
    return {
      o: [...rigid.t],
      x: [rigid.r[0], rigid.r[3], rigid.r[6]],
      y: [rigid.r[1], rigid.r[4], rigid.r[7]],
      z: [rigid.r[2], rigid.r[5], rigid.r[8]],
    } as unknown as T;
  }
  const tVec: [number, number, number] = [rigid.t[0], rigid.t[1], rigid.t[2]];
  return {
    r: [...rigid.r],
    t: [...tVec],
    translation: [...tVec],
    rotation: [...rigid.r],
  } as unknown as T;
}

// ---- Triangle BVH ----------------------------------------------------------------------------------------------------------------

export interface BVHNode {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  left: number;
  right: number;
  start: number;
  count: number;
}

export interface MeshBVH {
  triCount: number;
  /** 9 floats per triangle in BVH leaf order: v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z */
  verts: Float64Array;
  /** 3 floats per triangle in BVH leaf order: outward unit normal nx, ny, nz */
  normals: Float64Array;
  /** 6 floats per triangle in BVH leaf order: minX, minY, minZ, maxX, maxY, maxZ */
  boxes: Float64Array;
  nodes: BVHNode[];
  centroid: V3;
  radius: number;
}

const bvhCache = new WeakMap<object, MeshBVH>();

export function buildMeshBVH(mesh: BodyMesh): MeshBVH {
  if (mesh.bvh) return mesh.bvh;
  const cacheKey = (typeof mesh.positions === 'object' && mesh.positions !== null) ? mesh.positions : mesh;
  const cached = bvhCache.get(cacheKey);
  if (cached) return cached;

  const pos = mesh.positions;
  const idx = mesh.indices;
  const triCount = idx && idx.length >= 3 ? Math.floor(idx.length / 3) : Math.floor(pos.length / 9);

  const rawVerts = new Float64Array(triCount * 9);
  const rawNormals = new Float64Array(triCount * 3);
  const rawBoxes = new Float64Array(triCount * 6);
  const rawCentroids = new Float64Array(triCount * 3);

  let cxSum = 0, cySum = 0, czSum = 0;

  for (let t = 0; t < triCount; t++) {
    let i0: number, i1: number, i2: number;
    if (idx && idx.length >= 3) {
      i0 = idx[t * 3] * 3;
      i1 = idx[t * 3 + 1] * 3;
      i2 = idx[t * 3 + 2] * 3;
    } else {
      i0 = t * 9;
      i1 = t * 9 + 3;
      i2 = t * 9 + 6;
    }
    const ax = pos[i0], ay = pos[i0 + 1], az = pos[i0 + 2];
    const bx = pos[i1], by = pos[i1 + 1], bz = pos[i1 + 2];
    const cx = pos[i2], cy = pos[i2 + 1], cz = pos[i2 + 2];

    const vBase = t * 9;
    rawVerts[vBase] = ax; rawVerts[vBase + 1] = ay; rawVerts[vBase + 2] = az;
    rawVerts[vBase + 3] = bx; rawVerts[vBase + 4] = by; rawVerts[vBase + 5] = bz;
    rawVerts[vBase + 6] = cx; rawVerts[vBase + 7] = cy; rawVerts[vBase + 8] = cz;

    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 1e-12) { nx /= nl; ny /= nl; nz /= nl; } else { nx = 0; ny = 0; nz = 1; }
    rawNormals[t * 3] = nx;
    rawNormals[t * 3 + 1] = ny;
    rawNormals[t * 3 + 2] = nz;

    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx);
    const minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
    const minZ = Math.min(az, bz, cz), maxZ = Math.max(az, bz, cz);
    const bBase = t * 6;
    rawBoxes[bBase] = minX; rawBoxes[bBase + 1] = minY; rawBoxes[bBase + 2] = minZ;
    rawBoxes[bBase + 3] = maxX; rawBoxes[bBase + 4] = maxY; rawBoxes[bBase + 5] = maxZ;

    const mcx = (ax + bx + cx) / 3, mcy = (ay + by + cy) / 3, mcz = (az + bz + cz) / 3;
    rawCentroids[t * 3] = mcx;
    rawCentroids[t * 3 + 1] = mcy;
    rawCentroids[t * 3 + 2] = mcz;
    cxSum += mcx; cySum += mcy; czSum += mcz;
  }

  const centroid: V3 = triCount > 0 ? [cxSum / triCount, cySum / triCount, czSum / triCount] : [0, 0, 0];
  let maxR2 = 0;
  for (let i = 0; i < rawVerts.length; i += 3) {
    const dx = rawVerts[i] - centroid[0];
    const dy = rawVerts[i + 1] - centroid[1];
    const dz = rawVerts[i + 2] - centroid[2];
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 > maxR2) maxR2 = r2;
  }

  const order = new Int32Array(triCount);
  for (let i = 0; i < triCount; i++) order[i] = i;

  const nodes: BVHNode[] = [];
  const LEAF_SIZE = 4;

  function buildNode(start: number, count: number): number {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let cMinX = Infinity, cMinY = Infinity, cMinZ = Infinity;
    let cMaxX = -Infinity, cMaxY = -Infinity, cMaxZ = -Infinity;

    for (let i = start; i < start + count; i++) {
      const t = order[i];
      const b = t * 6;
      if (rawBoxes[b] < minX) minX = rawBoxes[b];
      if (rawBoxes[b + 1] < minY) minY = rawBoxes[b + 1];
      if (rawBoxes[b + 2] < minZ) minZ = rawBoxes[b + 2];
      if (rawBoxes[b + 3] > maxX) maxX = rawBoxes[b + 3];
      if (rawBoxes[b + 4] > maxY) maxY = rawBoxes[b + 4];
      if (rawBoxes[b + 5] > maxZ) maxZ = rawBoxes[b + 5];

      const c = t * 3;
      const cx = rawCentroids[c], cy = rawCentroids[c + 1], cz = rawCentroids[c + 2];
      if (cx < cMinX) cMinX = cx;
      if (cy < cMinY) cMinY = cy;
      if (cz < cMinZ) cMinZ = cz;
      if (cx > cMaxX) cMaxX = cx;
      if (cy > cMaxY) cMaxY = cy;
      if (cz > cMaxZ) cMaxZ = cz;
    }

    const nodeIdx = nodes.length;
    nodes.push({ minX, minY, minZ, maxX, maxY, maxZ, left: -1, right: -1, start, count });

    if (count <= LEAF_SIZE) return nodeIdx;

    const extX = cMaxX - cMinX, extY = cMaxY - cMinY, extZ = cMaxZ - cMinZ;
    const axis = extX >= extY && extX >= extZ ? 0 : extY >= extZ ? 1 : 2;
    const splitVal = axis === 0 ? 0.5 * (cMinX + cMaxX) : axis === 1 ? 0.5 * (cMinY + cMaxY) : 0.5 * (cMinZ + cMaxZ);

    let lo = start, hi = start + count - 1;
    while (lo <= hi) {
      const t = order[lo];
      const v = rawCentroids[t * 3 + axis];
      if (v < splitVal) {
        lo++;
      } else {
        const tmp = order[lo];
        order[lo] = order[hi];
        order[hi] = tmp;
        hi--;
      }
    }

    let leftCount = lo - start;
    if (leftCount === 0 || leftCount === count) leftCount = count >> 1;

    const leftIdx = buildNode(start, leftCount);
    const rightIdx = buildNode(start + leftCount, count - leftCount);
    nodes[nodeIdx].left = leftIdx;
    nodes[nodeIdx].right = rightIdx;
    return nodeIdx;
  }

  if (triCount > 0) buildNode(0, triCount);

  // Reorder triangles into leaf order for contiguous cache-friendly leaf loops
  const verts = new Float64Array(triCount * 9);
  const normals = new Float64Array(triCount * 3);
  const boxes = new Float64Array(triCount * 6);
  for (let i = 0; i < triCount; i++) {
    const t = order[i];
    for (let k = 0; k < 9; k++) verts[i * 9 + k] = rawVerts[t * 9 + k];
    for (let k = 0; k < 3; k++) normals[i * 3 + k] = rawNormals[t * 3 + k];
    for (let k = 0; k < 6; k++) boxes[i * 6 + k] = rawBoxes[t * 6 + k];
  }

  const bvh: MeshBVH = { triCount, verts, normals, boxes, nodes, centroid, radius: Math.sqrt(maxR2) };
  bvhCache.set(cacheKey, bvh);
  return bvh;
}

// ---- Rigid math helpers ----------------------------------------------------------------------------------------------------------

function invertRigid(m: Rigid): Rigid {
  const r = [m.r[0], m.r[3], m.r[6], m.r[1], m.r[4], m.r[7], m.r[2], m.r[5], m.r[8]];
  const tx = -(r[0] * m.t[0] + r[1] * m.t[1] + r[2] * m.t[2]);
  const ty = -(r[3] * m.t[0] + r[4] * m.t[1] + r[5] * m.t[2]);
  const tz = -(r[6] * m.t[0] + r[7] * m.t[1] + r[8] * m.t[2]);
  return { r, t: [tx, ty, tz] };
}

function composeRigid(a: Rigid, b: Rigid): Rigid {
  const r = new Array<number>(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a.r[i * 3] * b.r[j] + a.r[i * 3 + 1] * b.r[3 + j] + a.r[i * 3 + 2] * b.r[6 + j];
    }
  }
  const tx = a.r[0] * b.t[0] + a.r[1] * b.t[1] + a.r[2] * b.t[2] + a.t[0];
  const ty = a.r[3] * b.t[0] + a.r[4] * b.t[1] + a.r[5] * b.t[2] + a.t[1];
  const tz = a.r[6] * b.t[0] + a.r[7] * b.t[1] + a.r[8] * b.t[2] + a.t[2];
  return { r, t: [tx, ty, tz] };
}

function applyPoint(m: Rigid, x: number, y: number, z: number): V3 {
  return [
    m.r[0] * x + m.r[1] * y + m.r[2] * z + m.t[0],
    m.r[3] * x + m.r[4] * y + m.r[5] * z + m.t[1],
    m.r[6] * x + m.r[7] * y + m.r[8] * z + m.t[2],
  ];
}

function applyDir(m: Rigid, x: number, y: number, z: number): V3 {
  return [
    m.r[0] * x + m.r[1] * y + m.r[2] * z,
    m.r[3] * x + m.r[4] * y + m.r[5] * z,
    m.r[6] * x + m.r[7] * y + m.r[8] * z,
  ];
}

/** Fast OBB-OBB overlap test between nodeA (in frame A) and nodeB (in frame B) using both relative transforms and clearance margin. */
function nodesOverlap(a: BVHNode, b: BVHNode, bToA: Rigid, aToB: Rigid, margin: number): boolean {
  // 1. Transform B's AABB into A's local frame (Arvo's method) and test against A's AABB
  const bMin0 = b.minX, bMin1 = b.minY, bMin2 = b.minZ;
  const bMax0 = b.maxX, bMax1 = b.maxY, bMax2 = b.maxZ;
  for (let i = 0; i < 3; i++) {
    let lo = bToA.t[i], hi = bToA.t[i];
    const r0 = bToA.r[i * 3], r1 = bToA.r[i * 3 + 1], r2 = bToA.r[i * 3 + 2];
    const e0 = r0 * bMin0, f0 = r0 * bMax0; lo += e0 < f0 ? e0 : f0; hi += e0 > f0 ? e0 : f0;
    const e1 = r1 * bMin1, f1 = r1 * bMax1; lo += e1 < f1 ? e1 : f1; hi += e1 > f1 ? e1 : f1;
    const e2 = r2 * bMin2, f2 = r2 * bMax2; lo += e2 < f2 ? e2 : f2; hi += e2 > f2 ? e2 : f2;
    const aLo = i === 0 ? a.minX : i === 1 ? a.minY : a.minZ;
    const aHi = i === 0 ? a.maxX : i === 1 ? a.maxY : a.maxZ;
    if (hi + margin < aLo || lo - margin > aHi) return false;
  }
  // 2. Transform A's AABB into B's local frame and test against B's AABB
  const aMin0 = a.minX, aMin1 = a.minY, aMin2 = a.minZ;
  const aMax0 = a.maxX, aMax1 = a.maxY, aMax2 = a.maxZ;
  for (let i = 0; i < 3; i++) {
    let lo = aToB.t[i], hi = aToB.t[i];
    const r0 = aToB.r[i * 3], r1 = aToB.r[i * 3 + 1], r2 = aToB.r[i * 3 + 2];
    const e0 = r0 * aMin0, f0 = r0 * aMax0; lo += e0 < f0 ? e0 : f0; hi += e0 > f0 ? e0 : f0;
    const e1 = r1 * aMin1, f1 = r1 * aMax1; lo += e1 < f1 ? e1 : f1; hi += e1 > f1 ? e1 : f1;
    const e2 = r2 * aMin2, f2 = r2 * aMax2; lo += e2 < f2 ? e2 : f2; hi += e2 > f2 ? e2 : f2;
    const bLo = i === 0 ? bMin0 : i === 1 ? bMin1 : bMin2;
    const bHi = i === 0 ? bMax0 : i === 1 ? bMax1 : bMax2;
    if (hi + margin < bLo || lo - margin > bHi) return false;
  }
  return true;
}

// ---- Exact Triangle-Triangle Intersection & Closest Point ------------------------------------------------------------------------

function pointInTri(px: number, py: number, pz: number, a0: V3, a1: V3, a2: V3, n: V3): boolean {
  const eps = -1e-6;
  // Edge 0: a0 -> a1
  const e0x = a1[0] - a0[0], e0y = a1[1] - a0[1], e0z = a1[2] - a0[2];
  const v0x = px - a0[0], v0y = py - a0[1], v0z = pz - a0[2];
  const c0 = n[0] * (e0y * v0z - e0z * v0y) + n[1] * (e0z * v0x - e0x * v0z) + n[2] * (e0x * v0y - e0y * v0x);
  if (c0 < eps) return false;

  // Edge 1: a1 -> a2
  const e1x = a2[0] - a1[0], e1y = a2[1] - a1[1], e1z = a2[2] - a1[2];
  const v1x = px - a1[0], v1y = py - a1[1], v1z = pz - a1[2];
  const c1 = n[0] * (e1y * v1z - e1z * v1y) + n[1] * (e1z * v1x - e1x * v1z) + n[2] * (e1x * v1y - e1y * v1x);
  if (c1 < eps) return false;

  // Edge 2: a2 -> a0
  const e2x = a0[0] - a2[0], e2y = a0[1] - a2[1], e2z = a0[2] - a2[2];
  const v2x = px - a2[0], v2y = py - a2[1], v2z = pz - a2[2];
  const c2 = n[0] * (e2y * v2z - e2z * v2y) + n[1] * (e2z * v2x - e2x * v2z) + n[2] * (e2x * v2y - e2y * v2x);
  return c2 >= eps;
}

/**
 * Tests if triangle A (a0, a1, a2, normal nA) and triangle B (b0, b1, b2, normal nB) intersect strictly inside/across each other.
 * Appends any piercing points to `hitPoints` and returns true when they intersect.
 */
function triTriIntersect(a0: V3, a1: V3, a2: V3, nA: V3, b0: V3, b1: V3, b2: V3, nB: V3, hitPoints: V3[]): boolean {
  const eps = 1e-7;
  const dA = nA[0] * a0[0] + nA[1] * a0[1] + nA[2] * a0[2];
  const db0 = nA[0] * b0[0] + nA[1] * b0[1] + nA[2] * b0[2] - dA;
  const db1 = nA[0] * b1[0] + nA[1] * b1[1] + nA[2] * b1[2] - dA;
  const db2 = nA[0] * b2[0] + nA[1] * b2[1] + nA[2] * b2[2] - dA;
  if ((db0 > eps && db1 > eps && db2 > eps) || (db0 < -eps && db1 < -eps && db2 < -eps)) return false;

  const dB = nB[0] * b0[0] + nB[1] * b0[1] + nB[2] * b0[2];
  const da0 = nB[0] * a0[0] + nB[1] * a0[1] + nB[2] * a0[2] - dB;
  const da1 = nB[0] * a1[0] + nB[1] * a1[1] + nB[2] * a1[2] - dB;
  const da2 = nB[0] * a2[0] + nB[1] * a2[1] + nB[2] * a2[2] - dB;
  if ((da0 > eps && da1 > eps && da2 > eps) || (da0 < -eps && da1 < -eps && da2 < -eps)) return false;

  let hit = false;
  const bVerts = [b0, b1, b2];
  const bDists = [db0, db1, db2];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const di = bDists[i], dj = bDists[j];
    if ((di > 0 && dj < 0) || (di < 0 && dj > 0) || (Math.abs(di) <= eps && Math.abs(dj) > eps)) {
      const denom = di - dj;
      if (Math.abs(denom) > 1e-12) {
        const u = di / denom;
        const vi = bVerts[i], vj = bVerts[j];
        const px = vi[0] + u * (vj[0] - vi[0]);
        const py = vi[1] + u * (vj[1] - vi[1]);
        const pz = vi[2] + u * (vj[2] - vi[2]);
        if (pointInTri(px, py, pz, a0, a1, a2, nA)) {
          hitPoints.push([px, py, pz]);
          hit = true;
        }
      }
    }
  }

  const aVerts = [a0, a1, a2];
  const aDists = [da0, da1, da2];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const di = aDists[i], dj = aDists[j];
    if ((di > 0 && dj < 0) || (di < 0 && dj > 0) || (Math.abs(di) <= eps && Math.abs(dj) > eps)) {
      const denom = di - dj;
      if (Math.abs(denom) > 1e-12) {
        const u = di / denom;
        const vi = aVerts[i], vj = aVerts[j];
        const px = vi[0] + u * (vj[0] - vi[0]);
        const py = vi[1] + u * (vj[1] - vi[1]);
        const pz = vi[2] + u * (vj[2] - vi[2]);
        if (pointInTri(px, py, pz, b0, b1, b2, nB)) {
          hitPoints.push([px, py, pz]);
          hit = true;
        }
      }
    }
  }

  return hit;
}

function closestPointOnTri(p: V3, a: V3, b: V3, c: V3): V3 {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return a;

  const bpx = p[0] - b[0], bpy = p[1] - b[1], bpz = p[2] - b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return b;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [a[0] + v * abx, a[1] + v * aby, a[2] + v * abz];
  }

  const cpx = p[0] - c[0], cpy = p[1] - c[1], cpz = p[2] - c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return c;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [a[0] + w * acx, a[1] + w * acy, a[2] + w * acz];
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [a[0] + abx * v + acx * w, a[1] + aby * v + acy * w, a[2] + abz * v + acz * w];
}

function segmentSegmentClosest(p1: V3, q1: V3, p2: V3, q2: V3): { c1: V3; c2: V3; dist2: number } {
  const d1x = q1[0] - p1[0], d1y = q1[1] - p1[1], d1z = q1[2] - p1[2];
  const d2x = q2[0] - p2[0], d2y = q2[1] - p2[1], d2z = q2[2] - p2[2];
  const rx = p1[0] - p2[0], ry = p1[1] - p2[1], rz = p1[2] - p2[2];
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;

  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) {
    return { c1: p1, c2: p2, dist2: rx * rx + ry * ry + rz * rz };
  }
  if (a <= 1e-12) {
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) {
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      if (denom !== 0) s = Math.max(0, Math.min(1, (b * f - c * e) / denom));
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  const c1: V3 = [p1[0] + d1x * s, p1[1] + d1y * s, p1[2] + d1z * s];
  const c2: V3 = [p2[0] + d2x * t, p2[1] + d2y * t, p2[2] + d2z * t];
  const dx = c1[0] - c2[0], dy = c1[1] - c2[1], dz = c1[2] - c2[2];
  return { c1, c2, dist2: dx * dx + dy * dy + dz * dz };
}

function triTriClosest(a0: V3, a1: V3, a2: V3, b0: V3, b1: V3, b2: V3): { pA: V3; pB: V3; dist: number } {
  let bestDist2 = Infinity;
  let bestA: V3 = a0, bestB: V3 = b0;

  const aVerts = [a0, a1, a2];
  const bVerts = [b0, b1, b2];

  for (const va of aVerts) {
    const cb = closestPointOnTri(va, b0, b1, b2);
    const dx = va[0] - cb[0], dy = va[1] - cb[1], dz = va[2] - cb[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestDist2) { bestDist2 = d2; bestA = va; bestB = cb; }
  }
  for (const vb of bVerts) {
    const ca = closestPointOnTri(vb, a0, a1, a2);
    const dx = ca[0] - vb[0], dy = ca[1] - vb[1], dz = ca[2] - vb[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestDist2) { bestDist2 = d2; bestA = ca; bestB = vb; }
  }
  for (let i = 0; i < 3; i++) {
    const ai = aVerts[i], aj = aVerts[(i + 1) % 3];
    for (let j = 0; j < 3; j++) {
      const bi = bVerts[j], bj = bVerts[(j + 1) % 3];
      const { c1, c2, dist2 } = segmentSegmentClosest(ai, aj, bi, bj);
      if (dist2 < bestDist2) { bestDist2 = dist2; bestA = c1; bestB = c2; }
    }
  }
  return { pA: bestA, pB: bestB, dist: Math.sqrt(bestDist2) };
}

// ---- Pairwise BVH Collision Query ------------------------------------------------------------------------------------------------

function addUniqueDir(dirs: V3[], x: number, y: number, z: number): void {
  const len = Math.hypot(x, y, z);
  if (len < 1e-9) return;
  const ux = x / len, uy = y / len, uz = z / len;
  for (const d of dirs) {
    if (Math.abs(d[0] * ux + d[1] * uy + d[2] * uz) > 0.999) return;
  }
  dirs.push([ux, uy, uz]);
}

function detectPairCollision(
  setId: string,
  bodyA: string,
  bodyB: string,
  bvhA: MeshBVH,
  bvhB: MeshBVH,
  tA: Rigid,
  tB: Rigid,
  clearanceMm: number,
): ContactCollision | null {
  if (bvhA.triCount === 0 || bvhB.triCount === 0) return null;

  const invA = invertRigid(tA);
  const invB = invertRigid(tB);
  const bToA = composeRigid(invA, tB);
  const aToB = composeRigid(invB, tA);

  if (!nodesOverlap(bvhA.nodes[0], bvhB.nodes[0], bToA, aToB, clearanceMm)) return null;

  const hitPoints: V3[] = [];
  const hitNormals: V3[] = [];
  const activeVertsA: V3[] = [];
  const activeVertsB: V3[] = [];
  const seenTriA = new Uint8Array(bvhA.triCount);
  const seenTriB = new Uint8Array(bvhB.triCount);
  const checkedInBA = new Uint8Array(bvhA.triCount);
  const checkedInAB = new Uint8Array(bvhB.triCount);

  let minClearanceDist = Infinity;
  let bestClearA: V3 = [0, 0, 0];
  let bestClearB: V3 = [0, 0, 0];
  let bestClearNormal: V3 = [1, 0, 0];

  const rootA = bvhA.nodes[0];
  const rootB = bvhB.nodes[0];

  const stackA: number[] = [0];
  const stackB: number[] = [0];

  while (stackA.length > 0) {
    const idxA = stackA.pop()!;
    const idxB = stackB.pop()!;
    const nodeA = bvhA.nodes[idxA];
    const nodeB = bvhB.nodes[idxB];

    if (!nodesOverlap(nodeA, nodeB, bToA, aToB, clearanceMm)) continue;

    const leafA = nodeA.left === -1;
    const leafB = nodeB.left === -1;

    if (leafA && leafB) {
      for (let i = nodeA.start; i < nodeA.start + nodeA.count; i++) {
        const va = i * 9, na = i * 3;
        const a0 = applyPoint(tA, bvhA.verts[va], bvhA.verts[va + 1], bvhA.verts[va + 2]);
        const a1 = applyPoint(tA, bvhA.verts[va + 3], bvhA.verts[va + 4], bvhA.verts[va + 5]);
        const a2 = applyPoint(tA, bvhA.verts[va + 6], bvhA.verts[va + 7], bvhA.verts[va + 8]);
        const nA = applyDir(tA, bvhA.normals[na], bvhA.normals[na + 1], bvhA.normals[na + 2]);

        const aMinX = Math.min(a0[0], a1[0], a2[0]) - clearanceMm;
        const aMaxX = Math.max(a0[0], a1[0], a2[0]) + clearanceMm;
        const aMinY = Math.min(a0[1], a1[1], a2[1]) - clearanceMm;
        const aMaxY = Math.max(a0[1], a1[1], a2[1]) + clearanceMm;
        const aMinZ = Math.min(a0[2], a1[2], a2[2]) - clearanceMm;
        const aMaxZ = Math.max(a0[2], a1[2], a2[2]) + clearanceMm;

        // Also record vertices of A that lie inside B's local root AABB
        if (!checkedInBA[i]) {
          checkedInBA[i] = 1;
          for (const v of [a0, a1, a2]) {
            const inB = applyPoint(invB, v[0], v[1], v[2]);
            if (
              inB[0] >= rootB.minX - 1e-6 && inB[0] <= rootB.maxX + 1e-6 &&
              inB[1] >= rootB.minY - 1e-6 && inB[1] <= rootB.maxY + 1e-6 &&
              inB[2] >= rootB.minZ - 1e-6 && inB[2] <= rootB.maxZ + 1e-6
            ) {
              activeVertsA.push(v);
            }
          }
        }

        for (let j = nodeB.start; j < nodeB.start + nodeB.count; j++) {
          const vb = j * 9, nb = j * 3;
          const b0 = applyPoint(tB, bvhB.verts[vb], bvhB.verts[vb + 1], bvhB.verts[vb + 2]);
          const b1 = applyPoint(tB, bvhB.verts[vb + 3], bvhB.verts[vb + 4], bvhB.verts[vb + 5]);
          const b2 = applyPoint(tB, bvhB.verts[vb + 6], bvhB.verts[vb + 7], bvhB.verts[vb + 8]);

          if (!checkedInAB[j]) {
            checkedInAB[j] = 1;
            for (const v of [b0, b1, b2]) {
              const inA = applyPoint(invA, v[0], v[1], v[2]);
              if (
                inA[0] >= rootA.minX - 1e-6 && inA[0] <= rootA.maxX + 1e-6 &&
                inA[1] >= rootA.minY - 1e-6 && inA[1] <= rootA.maxY + 1e-6 &&
                inA[2] >= rootA.minZ - 1e-6 && inA[2] <= rootA.maxZ + 1e-6
              ) {
                activeVertsB.push(v);
              }
            }
          }

          const bMinX = Math.min(b0[0], b1[0], b2[0]);
          const bMaxX = Math.max(b0[0], b1[0], b2[0]);
          if (bMaxX < aMinX || bMinX > aMaxX) continue;
          const bMinY = Math.min(b0[1], b1[1], b2[1]);
          const bMaxY = Math.max(b0[1], b1[1], b2[1]);
          if (bMaxY < aMinY || bMinY > aMaxY) continue;
          const bMinZ = Math.min(b0[2], b1[2], b2[2]);
          const bMaxZ = Math.max(b0[2], b1[2], b2[2]);
          if (bMaxZ < aMinZ || bMinZ > aMaxZ) continue;

          const nB = applyDir(tB, bvhB.normals[nb], bvhB.normals[nb + 1], bvhB.normals[nb + 2]);

          if (triTriIntersect(a0, a1, a2, nA, b0, b1, b2, nB, hitPoints)) {
            if (!seenTriA[i]) {
              seenTriA[i] = 1;
              activeVertsA.push(a0, a1, a2);
              addUniqueDir(hitNormals, nA[0], nA[1], nA[2]);
            }
            if (!seenTriB[j]) {
              seenTriB[j] = 1;
              activeVertsB.push(b0, b1, b2);
              addUniqueDir(hitNormals, -nB[0], -nB[1], -nB[2]);
            }
          } else if (clearanceMm > 0 && hitPoints.length === 0) {
            const { pA, pB, dist } = triTriClosest(a0, a1, a2, b0, b1, b2);
            if (dist < clearanceMm && dist < minClearanceDist) {
              minClearanceDist = dist;
              bestClearA = pA;
              bestClearB = pB;
              const dx = pB[0] - pA[0], dy = pB[1] - pA[1], dz = pB[2] - pA[2];
              const dl = Math.hypot(dx, dy, dz);
              bestClearNormal = dl > 1e-9 ? [dx / dl, dy / dl, dz / dl] : nA;
            }
          }
        }
      }
    } else if (leafA) {
      stackA.push(idxA, idxA);
      stackB.push(nodeB.left, nodeB.right);
    } else if (leafB) {
      stackA.push(nodeA.left, nodeA.right);
      stackB.push(idxB, idxB);
    } else {
      const volA = (nodeA.maxX - nodeA.minX) + (nodeA.maxY - nodeA.minY) + (nodeA.maxZ - nodeA.minZ);
      const volB = (nodeB.maxX - nodeB.minX) + (nodeB.maxY - nodeB.minY) + (nodeB.maxZ - nodeB.minZ);
      if (volA >= volB) {
        stackA.push(nodeA.left, nodeA.right);
        stackB.push(idxB, idxB);
      } else {
        stackA.push(idxA, idxA);
        stackB.push(nodeB.left, nodeB.right);
      }
    }
  }

  if (hitPoints.length > 0) {
    // Compute contact point as centroid of piercing points
    let cx = 0, cy = 0, cz = 0;
    for (const p of hitPoints) { cx += p[0]; cy += p[1]; cz += p[2]; }
    const contactPoint: V3 = [cx / hitPoints.length, cy / hitPoints.length, cz / hitPoints.length];

    // Add principal axes of A and B to candidate separating axes
    addUniqueDir(hitNormals, tA.r[0], tA.r[3], tA.r[6]);
    addUniqueDir(hitNormals, tA.r[1], tA.r[4], tA.r[7]);
    addUniqueDir(hitNormals, tA.r[2], tA.r[5], tA.r[8]);
    addUniqueDir(hitNormals, tB.r[0], tB.r[3], tB.r[6]);
    addUniqueDir(hitNormals, tB.r[1], tB.r[4], tB.r[7]);
    addUniqueDir(hitNormals, tB.r[2], tB.r[5], tB.r[8]);

    const cA = applyPoint(tA, bvhA.centroid[0], bvhA.centroid[1], bvhA.centroid[2]);
    const cB = applyPoint(tB, bvhB.centroid[0], bvhB.centroid[1], bvhB.centroid[2]);
    const abX = cB[0] - cA[0], abY = cB[1] - cA[1], abZ = cB[2] - cA[2];
    addUniqueDir(hitNormals, abX, abY, abZ);

    let bestDepth = Infinity;
    let bestNormal: V3 = [1, 0, 0];

    const vertsA = activeVertsA.length > 0 ? activeVertsA : hitPoints;
    const vertsB = activeVertsB.length > 0 ? activeVertsB : hitPoints;

    for (const dir of hitNormals) {
      // Orient candidate normal from bodyA toward bodyB when centroids differ along dir
      const dotAB = abX * dir[0] + abY * dir[1] + abZ * dir[2];
      const signs = Math.abs(dotAB) > 1e-6 ? [dotAB >= 0 ? 1 : -1] : [1, -1];
      for (const s of signs) {
        const ux = dir[0] * s, uy = dir[1] * s, uz = dir[2] * s;
        let maxA = -Infinity, minB = Infinity;
        for (const v of vertsA) {
          const p = ux * v[0] + uy * v[1] + uz * v[2];
          if (p > maxA) maxA = p;
        }
        for (const v of vertsB) {
          const p = ux * v[0] + uy * v[1] + uz * v[2];
          if (p < minB) minB = p;
        }
        const depth = maxA - minB;
        if (depth > 1e-7 && depth < bestDepth) {
          bestDepth = depth;
          bestNormal = [ux, uy, uz];
        }
      }
    }

    if (!Number.isFinite(bestDepth) || bestDepth <= 0) {
      bestDepth = 1e-4;
      const al = Math.hypot(abX, abY, abZ);
      bestNormal = al > 1e-9 ? [abX / al, abY / al, abZ / al] : [1, 0, 0];
    }

    return {
      setId,
      bodyA,
      bodyB,
      penetrationMm: bestDepth + clearanceMm,
      contactPoint,
      normal: bestNormal,
    };
  }

  if (clearanceMm > 0 && minClearanceDist < clearanceMm) {
    return {
      setId,
      bodyA,
      bodyB,
      penetrationMm: clearanceMm - minClearanceDist,
      contactPoint: [
        0.5 * (bestClearA[0] + bestClearB[0]),
        0.5 * (bestClearA[1] + bestClearB[1]),
        0.5 * (bestClearA[2] + bestClearB[2]),
      ],
      normal: bestClearNormal,
    };
  }

  return null;
}

// ---- Mesh & Transform Map Accessors ----------------------------------------------------------------------------------------------

export type BodyMeshMap =
  | Readonly<Record<string, BodyMesh>>
  | ReadonlyMap<string, BodyMesh>
  | ReadonlyArray<BodyMesh & { id: string }>;

export type BodyTransformMap =
  | Readonly<Record<string, BodyTransform>>
  | ReadonlyMap<string, BodyTransform>;

function getMesh(meshes: BodyMeshMap, id: string): BodyMesh | undefined {
  if (meshes instanceof Map) return meshes.get(id);
  if (Array.isArray(meshes)) return meshes.find((m) => m.id === id);
  return (meshes as Readonly<Record<string, BodyMesh>>)[id];
}

function getTransform(transforms: BodyTransformMap | undefined, id: string): Rigid {
  if (!transforms) return IDENTITY_RIGID;
  if (transforms instanceof Map) return normalizeTransform(transforms.get(id));
  return normalizeTransform((transforms as Readonly<Record<string, BodyTransform>>)[id]);
}

function cloneTransformsToRigid(transforms: BodyTransformMap | undefined, bodyIds: Iterable<string>): Record<string, Rigid> {
  const out: Record<string, Rigid> = {};
  if (transforms instanceof Map) {
    for (const [k, v] of transforms.entries()) out[k] = normalizeTransform(v);
  } else if (transforms && typeof transforms === 'object') {
    for (const [k, v] of Object.entries(transforms)) out[k] = normalizeTransform(v);
  }
  for (const id of bodyIds) {
    if (!out[id]) out[id] = getTransform(transforms, id);
  }
  return out;
}

// ---- Public Solver API -----------------------------------------------------------------------------------------------------------

/**
 * Evaluates all enabled Contact Sets against the given body triangle meshes and world transforms,
 * returning all active collisions/contacts.
 */
export function detectContactSetCollisions(
  contactSets: ReadonlyArray<ContactSet>,
  bodyMeshes: BodyMeshMap,
  transforms?: BodyTransformMap,
): ContactCollision[] {
  const results: ContactCollision[] = [];
  for (const set of contactSets) {
    if (!set.enabled || set.memberIds.length < 2) continue;
    const clearance = Math.max(0, set.clearanceMm ?? 0);
    const members = set.memberIds;
    for (let i = 0; i < members.length; i++) {
      const idA = members[i];
      const meshA = getMesh(bodyMeshes, idA);
      if (!meshA) continue;
      const bvhA = buildMeshBVH(meshA);
      const tA = getTransform(transforms, idA);
      for (let j = i + 1; j < members.length; j++) {
        const idB = members[j];
        if (idA === idB) continue;
        const meshB = getMesh(bodyMeshes, idB);
        if (!meshB) continue;
        const bvhB = buildMeshBVH(meshB);
        const tB = getTransform(transforms, idB);
        const hit = detectPairCollision(set.id, idA, idB, bvhA, bvhB, tA, tB, clearance);
        if (hit) results.push(hit);
      }
    }
  }
  return results;
}

function detectCollisionsForMovingBody(
  movingBodyId: string,
  movingRigid: Rigid,
  contactSets: ReadonlyArray<ContactSet>,
  bodyMeshes: BodyMeshMap,
  transforms?: BodyTransformMap,
): ContactCollision[] {
  const meshMoving = getMesh(bodyMeshes, movingBodyId);
  if (!meshMoving) return [];
  const bvhMoving = buildMeshBVH(meshMoving);
  const results: ContactCollision[] = [];

  for (const set of contactSets) {
    if (!set.enabled || set.memberIds.length < 2 || !set.memberIds.includes(movingBodyId)) continue;
    const clearance = Math.max(0, set.clearanceMm ?? 0);
    for (const otherId of set.memberIds) {
      if (otherId === movingBodyId) continue;
      const meshOther = getMesh(bodyMeshes, otherId);
      if (!meshOther) continue;
      const bvhOther = buildMeshBVH(meshOther);
      const tOther = getTransform(transforms, otherId);
      // Keep pair order consistent with memberIds order in the ContactSet
      const idxMoving = set.memberIds.indexOf(movingBodyId);
      const idxOther = set.memberIds.indexOf(otherId);
      const hit = idxMoving < idxOther
        ? detectPairCollision(set.id, movingBodyId, otherId, bvhMoving, bvhOther, movingRigid, tOther, clearance)
        : detectPairCollision(set.id, otherId, movingBodyId, bvhOther, bvhMoving, tOther, movingRigid, clearance);
      if (hit) results.push(hit);
    }
  }
  return results;
}

/**
 * Transfers contact motion from a moving body to unconstrained/free contacted bodies along the contact normal
 * so that contacted bodies are pushed out of penetration into flush surface contact.
 */
export function solveContactPush(
  movingBodyId: string,
  targetTransform: BodyTransform,
  contactSets: ReadonlyArray<ContactSet>,
  bodyMeshes: BodyMeshMap,
  transforms: BodyTransformMap,
  options?: ContactPushOptions,
): ContactPushResult;
export function solveContactPush(
  movingBodyId: string,
  startTransform: BodyTransform,
  targetTransform: BodyTransform,
  contactSets: ReadonlyArray<ContactSet>,
  bodyMeshes: BodyMeshMap,
  transforms: BodyTransformMap,
  options?: ContactPushOptions,
): ContactPushResult;
export function solveContactPush(
  movingBodyId: string,
  arg1: BodyTransform,
  arg2: BodyTransform | ReadonlyArray<ContactSet>,
  arg3: ReadonlyArray<ContactSet> | BodyMeshMap,
  arg4: BodyMeshMap | BodyTransformMap,
  arg5?: BodyTransformMap | ContactPushOptions,
  arg6?: ContactPushOptions,
): ContactPushResult {
  const first = Array.isArray(arg2) ? (arg2[0] as unknown as ContactSet | undefined) : undefined;   // a transform's own first element is a number: only a contact set has id and memberIds
  const isSixArgForm = Array.isArray(arg2) && (arg2.length === 0 || (typeof first?.id === 'string' && Array.isArray(first?.memberIds)));
  const targetTransform = isSixArgForm ? arg1 : (arg2 as BodyTransform);
  const contactSets = (isSixArgForm ? arg2 : arg3) as ReadonlyArray<ContactSet>;
  const bodyMeshes = (isSixArgForm ? arg3 : arg4) as BodyMeshMap;
  const transforms = (isSixArgForm ? arg4 : arg5) as BodyTransformMap;
  const options = (isSixArgForm ? arg5 : arg6) as ContactPushOptions | undefined;

  const allIds = new Set<string>([movingBodyId]);
  for (const s of contactSets) for (const id of s.memberIds) allIds.add(id);

  const work = cloneTransformsToRigid(transforms, allIds);
  work[movingBodyId] = normalizeTransform(targetTransform);

  const freeSet = options?.freeBodyIds
    ? (options.freeBodyIds instanceof Set ? options.freeBodyIds : new Set(options.freeBodyIds))
    : null;
  const canPush = (id: string): boolean => id !== movingBodyId && (freeSet ? freeSet.has(id) : true);

  const maxIter = Math.max(1, options?.maxIterations ?? 8);
  const pushes: ContactPushEvent[] = [];
  const pushedSet = new Set<string>();

  for (let iter = 0; iter < maxIter; iter++) {
    const hits = detectContactSetCollisions(contactSets, bodyMeshes, work);
    if (hits.length === 0) break;
    let movedAny = false;

    for (const hit of hits) {
      let pushedId: string | null = null;
      let pusherId: string | null = null;
      let sign = 1; // +1 means normal points from bodyA to bodyB

      if (hit.bodyA === movingBodyId && canPush(hit.bodyB)) {
        pushedId = hit.bodyB; pusherId = hit.bodyA; sign = 1;
      } else if (hit.bodyB === movingBodyId && canPush(hit.bodyA)) {
        pushedId = hit.bodyA; pusherId = hit.bodyB; sign = -1;
      } else if (canPush(hit.bodyB) && !canPush(hit.bodyA)) {
        pushedId = hit.bodyB; pusherId = hit.bodyA; sign = 1;
      } else if (canPush(hit.bodyA) && !canPush(hit.bodyB)) {
        pushedId = hit.bodyA; pusherId = hit.bodyB; sign = -1;
      } else if (canPush(hit.bodyB)) {
        pushedId = hit.bodyB; pusherId = hit.bodyA; sign = 1;
      }

      if (!pushedId || !pusherId) continue;

      const dist = hit.penetrationMm + 1e-5;
      const nx = hit.normal[0] * sign;
      const ny = hit.normal[1] * sign;
      const nz = hit.normal[2] * sign;
      const delta: V3 = [nx * dist, ny * dist, nz * dist];

      const cur = work[pushedId] ?? IDENTITY_RIGID;
      const next: Rigid = {
        r: [...cur.r],
        t: [cur.t[0] + delta[0], cur.t[1] + delta[1], cur.t[2] + delta[2]],
      };
      work[pushedId] = next;
      pushedSet.add(pushedId);
      pushes.push({
        bodyId: pushedId,
        pushedBy: pusherId,
        delta,
        distanceMm: hit.penetrationMm,
        normal: [nx, ny, nz],
        transform: next,
      });
      movedAny = true;
    }

    if (!movedAny) break;
  }

  const remainingContacts = detectContactSetCollisions(contactSets, bodyMeshes, work);
  return {
    transforms: work,
    pushedBodyIds: [...pushedSet],
    pushes,
    remainingContacts,
  };
}

/**
 * Continuous swept contact resolution along the linear/angular motion step from `startTransform` to `targetTransform`.
 * Binary-searches the exact time of impact `tImpact in [0, 1]` so interactive dragging or motion playback halts cleanly at
 * surface contact (or optionally pushes free bodies when `options.pushFreeBodies` is enabled).
 */
export function clampTransformToContactSets<T extends BodyTransform = BodyTransform>(
  movingBodyId: string,
  startTransform: T,
  targetTransform: T,
  contactSets: ReadonlyArray<ContactSet>,
  bodyMeshes: BodyMeshMap,
  transforms?: BodyTransformMap,
  options?: ClampContactOptions,
): ClampContactResult<T> {
  const startRigid = normalizeTransform(startTransform);
  const targetRigid = normalizeTransform(targetTransform);

  const participates = contactSets.some(
    (s) => s.enabled && s.memberIds.length >= 2 && s.memberIds.includes(movingBodyId),
  );
  if (!participates || !getMesh(bodyMeshes, movingBodyId)) {
    return {
      clamped: false,
      tImpact: 1,
      transform: formatTransformLike(targetRigid, targetTransform),
      clampedTransform: targetRigid,
      contact: null,
      contacts: [],
    };
  }

  if (options?.pushFreeBodies) {
    const pushRes = solveContactPush(movingBodyId, startTransform, targetTransform, contactSets, bodyMeshes, transforms ?? {}, {
      freeBodyIds: options.freeBodyIds,
    });
    if (pushRes.remainingContacts.length === 0) {
      return {
        clamped: false,
        tImpact: 1,
        transform: formatTransformLike(targetRigid, targetTransform),
        clampedTransform: targetRigid,
        contact: pushRes.pushes[0]
          ? {
              setId: contactSets.find((s) => s.enabled && s.memberIds.includes(movingBodyId))?.id ?? '',
              bodyA: movingBodyId,
              bodyB: pushRes.pushes[0].bodyId,
              penetrationMm: 0,
              contactPoint: [targetRigid.t[0], targetRigid.t[1], targetRigid.t[2]],
              normal: pushRes.pushes[0].normal,
            }
          : null,
        contacts: [],
        pushedTransforms: pushRes.transforms,
      };
    }
  }

  // Estimate swept travel distance to choose substep count for continuous collision detection
  const mesh = getMesh(bodyMeshes, movingBodyId)!;
  const bvh = buildMeshBVH(mesh);
  const linDist = Math.hypot(
    targetRigid.t[0] - startRigid.t[0],
    targetRigid.t[1] - startRigid.t[1],
    targetRigid.t[2] - startRigid.t[2],
  );
  let rotDiff = 0;
  for (let k = 0; k < 9; k++) rotDiff += Math.abs(targetRigid.r[k] - startRigid.r[k]);
  const sweepDist = linDist + rotDiff * Math.max(1, bvh.radius);
  const substeps = options?.substeps ?? Math.max(16, Math.min(64, Math.ceil(sweepDist / 1.0)));

  // Check if t = 0 is already in contact
  const startHits = detectCollisionsForMovingBody(movingBodyId, startRigid, contactSets, bodyMeshes, transforms);
  if (startHits.length > 0) {
    return {
      clamped: true,
      tImpact: 0,
      transform: formatTransformLike(startRigid, targetTransform),
      clampedTransform: startRigid,
      contact: startHits[0],
      contacts: startHits,
    };
  }

  let tLo = 0;
  let tHi = 1;
  let hitAtBracket: ContactCollision[] | null = null;

  for (let s = 1; s <= substeps; s++) {
    const t = s / substeps;
    const pose = lerpRigid(startRigid, targetRigid, t);
    const hits = detectCollisionsForMovingBody(movingBodyId, pose, contactSets, bodyMeshes, transforms);
    if (hits.length > 0) {
      tLo = (s - 1) / substeps;
      tHi = t;
      hitAtBracket = hits;
      break;
    }
  }

  if (!hitAtBracket) {
    return {
      clamped: false,
      tImpact: 1,
      transform: formatTransformLike(targetRigid, targetTransform),
      clampedTransform: targetRigid,
      contact: null,
      contacts: [],
    };
  }

  const iterations = Math.max(8, options?.iterations ?? 26);
  let lastHits = hitAtBracket;
  for (let iter = 0; iter < iterations; iter++) {
    const tMid = 0.5 * (tLo + tHi);
    const pose = lerpRigid(startRigid, targetRigid, tMid);
    const hits = detectCollisionsForMovingBody(movingBodyId, pose, contactSets, bodyMeshes, transforms);
    if (hits.length > 0) {
      tHi = tMid;
      lastHits = hits;
    } else {
      tLo = tMid;
    }
  }

  const clampedRigid = lerpRigid(startRigid, targetRigid, tLo);
  return {
    clamped: true,
    tImpact: tLo,
    transform: formatTransformLike(clampedRigid, targetTransform),
    clampedTransform: clampedRigid,
    contact: lastHits[0] ?? null,
    contacts: lastHits,
  };
}

/**
 * Sweeps a motion driver / mate parameter across `[minVal, maxVal]` and returns the exact contact-free range
 * `[freeMin, freeMax]` along with the first contact event at each bound.
 */
export function findMotionContactRange(
  driverFn: (val: number) => BodyTransformMap,
  minVal: number,
  maxVal: number,
  steps: number,
  contactSets: ReadonlyArray<ContactSet>,
  bodyMeshes: BodyMeshMap,
): MotionContactRangeResult {
  const lo = Math.min(minVal, maxVal);
  const hi = Math.max(minVal, maxVal);
  const nSteps = Math.max(2, Math.floor(steps));

  const checkAt = (v: number): ContactCollision[] =>
    detectContactSetCollisions(contactSets, bodyMeshes, driverFn(v));

  // Choose a contact-free reference origin inside [lo, hi]
  let refVal: number | null = null;
  if (lo <= 0 && 0 <= hi && checkAt(0).length === 0) {
    refVal = 0;
  } else {
    // Sample across [lo, hi] to find a contact-free starting point closest to 0 (or midpoint)
    const mid = lo <= 0 && 0 <= hi ? 0 : 0.5 * (lo + hi);
    let bestDist = Infinity;
    for (let i = 0; i <= nSteps; i++) {
      const v = lo + ((hi - lo) * i) / nSteps;
      if (checkAt(v).length === 0) {
        const d = Math.abs(v - mid);
        if (d < bestDist) {
          bestDist = d;
          refVal = v;
        }
      }
    }
  }

  if (refVal === null) {
    const hitsLo = checkAt(lo);
    const hitsHi = checkAt(hi);
    const minC = hitsLo[0] ? { ...hitsLo[0], value: lo, contact: hitsLo[0] } : null;
    const maxC = hitsHi[0] ? { ...hitsHi[0], value: hi, contact: hitsHi[0] } : null;
    return { freeMin: lo, freeMax: lo, range: [lo, lo], minContact: minC, maxContact: maxC };
  }

  const stepSize = (hi - lo) / nSteps;

  // 1. Sweep upward from refVal to hi
  let freeMax = hi;
  let maxContact: MotionContactBoundEvent | null = null;
  {
    const upSteps = Math.max(1, Math.ceil((hi - refVal) / Math.max(1e-9, stepSize)));
    let prevClear = refVal;
    for (let i = 1; i <= upSteps; i++) {
      const v = i === upSteps ? hi : refVal + ((hi - refVal) * i) / upSteps;
      const hits = checkAt(v);
      if (hits.length > 0) {
        let a = prevClear, b = v;
        let lastHit = hits[0];
        for (let iter = 0; iter < 24; iter++) {
          const mid = 0.5 * (a + b);
          const mHits = checkAt(mid);
          if (mHits.length > 0) {
            b = mid;
            lastHit = mHits[0];
          } else {
            a = mid;
          }
        }
        freeMax = a;
        maxContact = { ...lastHit, value: a, contact: lastHit };
        break;
      }
      prevClear = v;
    }
  }

  // 2. Sweep downward from refVal to lo
  let freeMin = lo;
  let minContact: MotionContactBoundEvent | null = null;
  {
    const downSteps = Math.max(1, Math.ceil((refVal - lo) / Math.max(1e-9, stepSize)));
    let prevClear = refVal;
    for (let i = 1; i <= downSteps; i++) {
      const v = i === downSteps ? lo : refVal - ((refVal - lo) * i) / downSteps;
      const hits = checkAt(v);
      if (hits.length > 0) {
        let a = prevClear, b = v; // a is clear, b is hit (b < a)
        let lastHit = hits[0];
        for (let iter = 0; iter < 24; iter++) {
          const mid = 0.5 * (a + b);
          const mHits = checkAt(mid);
          if (mHits.length > 0) {
            b = mid;
            lastHit = mHits[0];
          } else {
            a = mid;
          }
        }
        freeMin = a;
        minContact = { ...lastHit, value: a, contact: lastHit };
        break;
      }
      prevClear = v;
    }
  }

  return {
    freeMin,
    freeMax,
    range: [freeMin, freeMax],
    minContact,
    maxContact,
  };
}
