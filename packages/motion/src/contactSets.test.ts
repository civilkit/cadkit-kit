import { describe, expect, it } from 'vitest';
import {
  buildMeshBVH,
  clampTransformToContactSets,
  detectContactSetCollisions,
  findMotionContactRange,
  newContactSetId,
  readContactSets,
  solveContactPush,
  toggleContactSetMember,
  withContactSet,
  withoutContactSet,
  type BodyMesh,
  type ContactSet,
} from './contactSets';
import type { Rigid } from './model';

/** Generates an indexed 12-triangle 3D box mesh spanning [minX..maxX, minY..maxY, minZ..maxZ] with outward-pointing normals. */
function makeBoxMesh(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): BodyMesh {
  const positions = new Float32Array([
    minX, minY, minZ, // 0
    maxX, minY, minZ, // 1
    maxX, maxY, minZ, // 2
    minX, maxY, minZ, // 3
    minX, minY, maxZ, // 4
    maxX, minY, maxZ, // 5
    maxX, maxY, maxZ, // 6
    minX, maxY, maxZ, // 7
  ]);
  const indices = new Uint32Array([
    // -Z
    0, 2, 1, 0, 3, 2,
    // +Z
    4, 5, 6, 4, 6, 7,
    // -Y
    0, 1, 5, 0, 5, 4,
    // +Y
    3, 7, 6, 3, 6, 2,
    // -X
    0, 4, 7, 0, 7, 3,
    // +X
    1, 2, 6, 1, 6, 5,
  ]);
  return { positions, indices };
}

/** Generates a 3D spur gear / cam prism mesh in XY extruded along Z in [minZ, maxZ]. */
function makeGearCamMesh(
  teethCount: number,
  innerRadius: number,
  outerRadius: number,
  minZ = -2,
  maxZ = 2,
  lobeEccentricity = 0,
): BodyMesh {
  const segs = teethCount * 4;
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < segs; i++) {
    const theta = (2 * Math.PI * i) / segs;
    const isTip = i % 4 === 1 || i % 4 === 2;
    const r = (isTip ? outerRadius : innerRadius) + lobeEccentricity * Math.max(0, Math.cos(theta));
    ring.push([r * Math.cos(theta), r * Math.sin(theta)]);
  }
  const tris: number[] = [];
  const pushTri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
    tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };
  for (let i = 0; i < segs; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % segs];
    // Top cap (+Z)
    pushTri([0, 0, maxZ], [x0, y0, maxZ], [x1, y1, maxZ]);
    // Bottom cap (-Z)
    pushTri([0, 0, minZ], [x1, y1, minZ], [x0, y0, minZ]);
    // Outer wall
    pushTri([x0, y0, minZ], [x1, y1, minZ], [x1, y1, maxZ]);
    pushTri([x0, y0, minZ], [x1, y1, maxZ], [x0, y0, maxZ]);
  }
  return { positions: new Float32Array(tris) };
}

function rotZTransform(deg: number, tx = 0, ty = 0, tz = 0): Rigid {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  return {
    r: [c, -s, 0, s, c, 0, 0, 0, 1],
    t: [tx, ty, tz],
  };
}

describe('Contact Sets: BVH construction and collision detection', () => {
  it('builds a triangle BVH and detects contact between translating 3D boxes with accurate penetration and normal', () => {
    const boxA = makeBoxMesh(0, 0, 0, 10, 10, 10);
    const boxB = makeBoxMesh(0, 0, 0, 10, 10, 10);
    const bvh = buildMeshBVH(boxA);
    expect(bvh.triCount).toBe(12);
    expect(bvh.nodes.length).toBeGreaterThan(1);

    const sets: ContactSet[] = [
      { id: 'cs1', name: 'Main contact', enabled: true, memberIds: ['A', 'B'] },
    ];
    const meshes = { A: boxA, B: boxB };

    // Separated by 5 mm along +X -> no collision
    const clearHits = detectContactSetCollisions(sets, meshes, {
      A: { translation: [0, 0, 0] },
      B: { translation: [15, 0, 0] },
    });
    expect(clearHits).toHaveLength(0);

    // Overlapping by 2 mm along +X (B at x = 8..18, A at x = 0..10)
    const hits = detectContactSetCollisions(sets, meshes, {
      A: { translation: [0, 0, 0] },
      B: { translation: [8, 0, 0] },
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].setId).toBe('cs1');
    expect(hits[0].bodyA).toBe('A');
    expect(hits[0].bodyB).toBe('B');
    expect(hits[0].penetrationMm).toBeCloseTo(2, 3);
    expect(hits[0].normal[0]).toBeCloseTo(1, 3);
    expect(Math.abs(hits[0].normal[1])).toBeLessThan(1e-3);
    expect(Math.abs(hits[0].normal[2])).toBeLessThan(1e-3);
    expect(hits[0].contactPoint[0]).toBeGreaterThanOrEqual(8);
    expect(hits[0].contactPoint[0]).toBeLessThanOrEqual(10);
  });

  it('detects collisions between rotating 3D gears and cams', () => {
    const gearA = makeGearCamMesh(12, 8, 11);
    const gearB = makeGearCamMesh(12, 8, 11);
    const cam = makeGearCamMesh(16, 6, 6.5, -2, 2, 5); // cam lobe extending to radius 11.5 at theta=0
    const follower = makeBoxMesh(-2, -5, -2, 2, 5, 2);

    const sets: ContactSet[] = [
      { id: 'gears', name: 'Gear mesh', enabled: true, memberIds: ['gearA', 'gearB'] },
      { id: 'camSet', name: 'Cam follower', enabled: true, memberIds: ['cam', 'follower'] },
    ];
    const meshes = { gearA, gearB, cam, follower };

    // Warm up BVH cache and JIT
    detectContactSetCollisions(sets, meshes, {
      gearA: rotZTransform(15, 0, 0, 0),
      gearB: rotZTransform(195, 19.5, 0, 0),
      cam: rotZTransform(0, 0, 0, 0),
      follower: rotZTransform(0, 12, 0, 0),
    });

    // Gears at center distance 19.5 mm (outer radius 11 + 11 = 22 > 19.5 when teeth align)
    // Cam at origin rotated to 0 deg (lobe reaches x = +11.5) vs follower at x = 12 (extends to x = 10 -> 1.5 mm overlap)
    const t0 = performance.now();
    const hits = detectContactSetCollisions(sets, meshes, {
      gearA: rotZTransform(15, 0, 0, 0),
      gearB: rotZTransform(195, 19.5, 0, 0),
      cam: rotZTransform(0, 0, 0, 0),
      follower: rotZTransform(0, 12, 0, 0),
    });
    // no wall-clock bound: a loaded CI box measured 33 ms against a 20 ms limit for the same work. The result below is the gate.
    const elapsedMs = performance.now() - t0;
    expect(Number.isFinite(elapsedMs)).toBe(true);
    expect(hits.some((h) => h.setId === 'gears')).toBe(true);
    expect(hits.some((h) => h.setId === 'camSet')).toBe(true);

    // When cam rotates 180 deg, lobe points to -X (radius at +X is 6.5), follower at x = 12 (min x = 10) is clear
    const camClear = detectContactSetCollisions([sets[1]], meshes, {
      cam: rotZTransform(180, 0, 0, 0),
      follower: rotZTransform(0, 12, 0, 0),
    });
    expect(camClear).toHaveLength(0);
  });

  it('respects enabled/disabled Contact Sets, >2 member sets, and optional clearanceMm', () => {
    const boxA = makeBoxMesh(0, 0, 0, 10, 10, 10);
    const boxB = makeBoxMesh(0, 0, 0, 10, 10, 10);
    const boxC = makeBoxMesh(0, 0, 0, 10, 10, 10);
    const boxD = makeBoxMesh(0, 0, 0, 10, 10, 10);
    const meshes = { A: boxA, B: boxB, C: boxC, D: boxD };

    const transforms = {
      A: { translation: [0, 0, 0] },
      B: { translation: [8, 0, 0] }, // overlaps A by 2 mm
      C: { translation: [15, 0, 0] }, // overlaps B by 3 mm (8..18 vs 15..25)
      D: { translation: [50, 0, 0] }, // far away
    };

    // 4-member enabled set detects both A<->B and B<->C
    const multiSet: ContactSet = { id: 'multi', name: '4-body set', enabled: true, memberIds: ['A', 'B', 'C', 'D'] };
    const hits = detectContactSetCollisions([multiSet], meshes, transforms);
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => `${h.bodyA}-${h.bodyB}`).sort()).toEqual(['A-B', 'B-C']);

    // Disabled set returns no collisions
    const disabledHits = detectContactSetCollisions([{ ...multiSet, enabled: false }], meshes, transforms);
    expect(disabledHits).toHaveLength(0);

    // Clearance check: A (0..10) and B at x = 11.2 (gap = 1.2 mm) with clearanceMm = 2.0 -> violation of 0.8 mm
    const clearanceSet: ContactSet = { id: 'clear', name: 'Clearance', enabled: true, memberIds: ['A', 'B'], clearanceMm: 2.0 };
    const nearHits = detectContactSetCollisions([clearanceSet], meshes, {
      A: { translation: [0, 0, 0] },
      B: { translation: [11.2, 0, 0] },
    });
    expect(nearHits).toHaveLength(1);
    expect(nearHits[0].penetrationMm).toBeCloseTo(0.8, 3);
  });
});

describe('Contact Sets: swept TOI clamping (clampTransformToContactSets)', () => {
  it('halts a sliding body at exact surface contact along a linear drag step', () => {
    const wall = makeBoxMesh(20, -10, -10, 30, 10, 10); // wall starts at x = 20
    const slider = makeBoxMesh(0, -5, -5, 10, 5, 5); // slider front face is at x = 10 + tx
    const sets: ContactSet[] = [{ id: 'cs1', name: 'SlideStop', enabled: true, memberIds: ['wall', 'slider'] }];
    const meshes = { wall, slider };

    // Drag slider from tx = 0 (front face at x = 10) to tx = 25 (front face at x = 35, deep inside wall).
    // Exact contact occurs when front face reaches x = 20 -> tx = 10 -> tImpact = 10 / 25 = 0.4.
    const res = clampTransformToContactSets(
      'slider',
      { translation: [0, 0, 0] },
      { translation: [25, 0, 0] },
      sets,
      meshes,
      { wall: { translation: [0, 0, 0] } },
    );
    expect(res.clamped).toBe(true);
    expect(res.tImpact).toBeCloseTo(0.4, 3);
    expect(res.clampedTransform.t[0]).toBeCloseTo(10, 2);
    expect(res.contact).not.toBeNull();
    expect([res.contact!.bodyA, res.contact!.bodyB].sort()).toEqual(['slider', 'wall']);
  });

  it('halts a rotating arm at exact angular contact against a stop pin', () => {
    // Arm extends from x = 0 to x = 20, y = -1..1, z = -1..1
    const arm = makeBoxMesh(0, -1, -1, 20, 1, 1);
    // Stop block placed at x = 5..15, y = 10..15, z = -2..2
    const stop = makeBoxMesh(5, 10, -2, 15, 15, 2);
    const sets: ContactSet[] = [{ id: 'cs-rot', name: 'RotStop', enabled: true, memberIds: ['arm', 'stop'] }];
    const meshes = { arm, stop };

    // Rotate arm from 0 deg to 90 deg about Z. It must stop before reaching 90 deg when hitting y = 10.
    const res = clampTransformToContactSets(
      'arm',
      rotZTransform(0),
      rotZTransform(90),
      sets,
      meshes,
      { stop: rotZTransform(0) },
    );
    expect(res.clamped).toBe(true);
    expect(res.tImpact).toBeGreaterThan(0.25);
    expect(res.tImpact).toBeLessThan(0.75);
    expect(res.contact).not.toBeNull();
    // At clampedTransform, the arm does not penetrate the stop block
    const checkAfter = detectContactSetCollisions(sets, meshes, {
      arm: res.clampedTransform,
      stop: rotZTransform(0),
    });
    expect(checkAfter).toHaveLength(0);
  });
});

describe('Contact Sets: contact-driven push (solveContactPush)', () => {
  it('pushes an unconstrained contacted body along the contact normal out of penetration', () => {
    const pusher = makeBoxMesh(0, 0, 0, 10, 10, 10);
    const block = makeBoxMesh(0, 0, 0, 10, 10, 10);
    const sets: ContactSet[] = [{ id: 'push-set', name: 'Push', enabled: true, memberIds: ['pusher', 'block'] }];
    const meshes = { pusher, block };

    // Block is initially at x = 12 (spanning 12..22). Pusher moves to x = 6 (spanning 6..16), overlapping block by 4 mm along +X.
    const res = solveContactPush(
      'pusher',
      { translation: [6, 0, 0] },
      sets,
      meshes,
      { pusher: { translation: [0, 0, 0] }, block: { translation: [12, 0, 0] } },
      { freeBodyIds: ['block'] },
    );
    expect(res.pushedBodyIds).toEqual(['block']);
    expect(res.pushes).toHaveLength(1);
    expect(res.pushes[0].normal[0]).toBeCloseTo(1, 3);
    expect(res.pushes[0].distanceMm).toBeCloseTo(4, 3);
    // Block should now be pushed to x = 16 (flush with pusher's front face at x = 16)
    expect(res.transforms.block.t[0]).toBeCloseTo(16, 2);
    expect(res.remainingContacts).toHaveLength(0);
  });
});

describe('Contact Sets: findMotionContactRange', () => {
  it('finds exact min and max travel limits for a slider between two stops', () => {
    const leftStop = makeBoxMesh(-25, -5, -5, -15, 5, 5); // inner face at x = -15
    const rightStop = makeBoxMesh(30, -5, -5, 40, 5, 5); // inner face at x = +30
    const carriage = makeBoxMesh(-5, -4, -4, 5, 4, 4); // half-width 5 mm: hits leftStop at x = -10, rightStop at x = +25
    const sets: ContactSet[] = [
      { id: 'limits', name: 'Rail stops', enabled: true, memberIds: ['leftStop', 'carriage', 'rightStop'] },
    ];
    const meshes = { leftStop, rightStop, carriage };

    const rangeRes = findMotionContactRange(
      (offsetMm) => ({
        leftStop: { translation: [0, 0, 0] },
        rightStop: { translation: [0, 0, 0] },
        carriage: { translation: [offsetMm, 0, 0] },
      }),
      -40,
      40,
      40,
      sets,
      meshes,
    );

    expect(rangeRes.freeMin).toBeCloseTo(-10, 2);
    expect(rangeRes.freeMax).toBeCloseTo(25, 2);
    expect(rangeRes.minContact).not.toBeNull();
    expect([rangeRes.minContact!.bodyA, rangeRes.minContact!.bodyB].sort()).toEqual(['carriage', 'leftStop']);
    expect(rangeRes.maxContact).not.toBeNull();
    expect([rangeRes.maxContact!.bodyA, rangeRes.maxContact!.bodyB].sort()).toEqual(['carriage', 'rightStop']);
  });

  it('persists and edits contact sets in motion doc records', () => {
    expect(readContactSets(null)).toEqual([]);
    const cs1: ContactSet = { id: newContactSetId([]), name: 'Set 1', enabled: true, memberIds: ['F1'] };
    expect(cs1.id).toBe('cs1');
    const toggled = toggleContactSetMember(cs1, 'F2');
    expect(toggled.memberIds).toEqual(['F1', 'F2']);
    const list = withContactSet({}, toggled);
    expect(readContactSets({ contactSets: list })).toEqual([toggled]);
    expect(withoutContactSet({ contactSets: list }, 'cs1')).toEqual([]);
  });
});
