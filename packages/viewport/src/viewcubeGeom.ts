/**
 * The geometry of the view cube: a chamfered cube whose 26 regions (6 faces, 12 edge bevels, 8 corner triangles) are
 * separate material groups, so a ray hit says which view it stands for and the hovered region can be tinted on its own.
 * Group i belongs to `dirs[i]`: the six faces first in BoxGeometry's order (+x, -x, +y, -y, +z, -z), then the edges, then the corners.
 */
import * as THREE from 'three';
import { frontDir, upVector, type UpAxis, type V3 } from './camerarig';

export interface CubeGeometry {
  geometry: THREE.BufferGeometry;
  /** The view direction of each region (its index is the material index). */
  dirs: V3[];
  /** The middle of each region on the surface. */
  centres: THREE.Vector3[];
}

/** Half the cube's width, and how deep the chamfer cuts at an edge. */
export const CUBE_HALF = 0.8;
export const CUBE_BEVEL = 0.26;

/** Where a face's text reads upright: screen-up on the face (the world up axis, or on Top and Bottom the way the front points) and screen-right (up x normal). */
function faceFrame(n: THREE.Vector3, up: UpAxis): { right: THREE.Vector3; up: THREE.Vector3 } {
  const wu = new THREE.Vector3(...upVector(up));
  let u = wu.clone();
  if (Math.abs(n.dot(wu)) > 0.5) u = new THREE.Vector3(...frontDir(up)).multiplyScalar(n.dot(wu) > 0 ? -1 : 1);
  return { right: new THREE.Vector3().crossVectors(u, n), up: u };
}

export function chamferCube(upAxis: UpAxis, h = CUBE_HALF, b = CUBE_BEVEL): CubeGeometry {
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [];
  const groups: Array<{ start: number; count: number; mat: number }> = [];
  const dirs: V3[] = [], centres: THREE.Vector3[] = [];
  const i = h - b;

  /** Add one convex polygon (counter-clockwise seen from outside, whatever order it was given in) as a fan, one material group. */
  const region = (pts: THREE.Vector3[], dir: V3, texture?: { right: THREE.Vector3; up: THREE.Vector3 }) => {
    const outward = new THREE.Vector3(...dir).normalize();
    const c = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(pts.length);
    // order the points counter-clockwise about the outward direction
    const nOut = outward.clone();
    const ref = pts[0].clone().sub(c);
    const side = new THREE.Vector3().crossVectors(nOut, ref).normalize();
    const ang = (p: THREE.Vector3) => { const v = p.clone().sub(c); return Math.atan2(v.dot(side), v.dot(ref)); };
    const ring = [...pts].sort((p, q) => ang(p) - ang(q));
    const start = pos.length / 3;
    for (let k = 1; k < ring.length - 1; k++) {
      for (const p of [ring[0], ring[k], ring[k + 1]]) {
        pos.push(p.x, p.y, p.z);
        nrm.push(nOut.x, nOut.y, nOut.z);
        if (texture) uv.push(0.5 + (p.clone().sub(c).dot(texture.right)) / (2 * i), 0.5 + (p.clone().sub(c).dot(texture.up)) / (2 * i));
        else uv.push(0, 0);
      }
    }
    groups.push({ start, count: pos.length / 3 - start, mat: dirs.length });
    dirs.push(dir);
    centres.push(c.clone());
  };

  const axes = [0, 1, 2];
  const unit = (a: number, s: number): V3 => { const v: V3 = [0, 0, 0]; v[a] = s; return v; };
  const pt = (c: V3): THREE.Vector3 => new THREE.Vector3(...c);
  // faces: the square of side 2i at distance h
  for (const a of axes) for (const s of [1, -1]) {
    const [p, q] = axes.filter((x) => x !== a);
    const pts: THREE.Vector3[] = [];
    for (const sp of [1, -1]) for (const sq of [1, -1]) { const c: V3 = [0, 0, 0]; c[a] = s * h; c[p] = sp * i; c[q] = sq * i; pts.push(pt(c)); }
    region(pts, unit(a, s), faceFrame(new THREE.Vector3(...unit(a, s)), upAxis));
  }
  // edges: the bevel between two faces, from one end of the edge to the other
  for (const [a, c] of [[0, 1], [0, 2], [1, 2]]) {
    const e = axes.find((x) => x !== a && x !== c)!;
    for (const sa of [1, -1]) for (const sc of [1, -1]) {
      const pts: THREE.Vector3[] = [];
      for (const se of [1, -1]) {
        const onA: V3 = [0, 0, 0]; onA[a] = sa * h; onA[c] = sc * i; onA[e] = se * i; pts.push(pt(onA));
        const onC: V3 = [0, 0, 0]; onC[a] = sa * i; onC[c] = sc * h; onC[e] = se * i; pts.push(pt(onC));
      }
      const dir: V3 = [0, 0, 0]; dir[a] = sa; dir[c] = sc;
      region(pts, dir);
    }
  }
  // corners: the triangle between three faces
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
    region([pt([sx * h, sy * i, sz * i]), pt([sx * i, sy * h, sz * i]), pt([sx * i, sy * i, sz * h])], [sx, sy, sz]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  for (const g of groups) geometry.addGroup(g.start, g.count, g.mat);
  return { geometry, dirs, centres };
}
