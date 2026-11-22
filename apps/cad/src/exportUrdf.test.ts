import { describe, it, expect } from 'vitest';
import { parseStl, zipRead } from '@kit/io';
import {
  applyPlacePoint,
  buildUrdf,
  buildUrdfInputFromDoc,
  exportUrdf,
  meshMassProps,
  rotateInertia,
  urdfSafeName,
  type Mat3,
  type UrdfFaceGeo,
} from './exportUrdf';

/** Outward-wound closed axis-aligned box in millimetres from [x0,y0,z0] to [x1,y1,z1] (12 triangles). */
function boxMesh(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Float32Array {
  const v: Array<[number, number, number]> = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const tris: Array<[number, number, number]> = [
    [0, 2, 1], [0, 3, 2], // -Z
    [4, 5, 6], [4, 6, 7], // +Z
    [0, 1, 5], [0, 5, 4], // -Y
    [2, 3, 7], [2, 7, 6], // +Y
    [0, 4, 7], [0, 7, 3], // -X
    [1, 2, 6], [1, 6, 5], // +X
  ];
  const out = new Float32Array(tris.length * 9);
  tris.forEach(([a, b, c], t) => {
    out.set(v[a], t * 9);
    out.set(v[b], t * 9 + 3);
    out.set(v[c], t * 9 + 6);
  });
  return out;
}

describe('meshMassProps & math helpers', () => {
  it('computes exact volume, CoM and inertia tensor for an offset box', () => {
    // 100 x 200 x 300 mm box shifted by (+50, -25, +10)
    const mesh = boxMesh(50, -25, 10, 150, 175, 310);
    const props = meshMassProps(mesh);
    const V = 100 * 200 * 300;
    expect(props.volume).toBeCloseTo(V, 3);
    expect(props.com[0]).toBeCloseTo(100, 6);
    expect(props.com[1]).toBeCloseTo(75, 6);
    expect(props.com[2]).toBeCloseTo(160, 6);
    expect(props.inertia[0][0]).toBeCloseTo(V * (200 ** 2 + 300 ** 2) / 12, -1);
    expect(props.inertia[1][1]).toBeCloseTo(V * (100 ** 2 + 300 ** 2) / 12, -1);
    expect(props.inertia[2][2]).toBeCloseTo(V * (100 ** 2 + 200 ** 2) / 12, -1);
    expect(Math.abs(props.inertia[0][1])).toBeLessThan(1e-3);
    expect(Math.abs(props.inertia[0][2])).toBeLessThan(1e-3);
    expect(Math.abs(props.inertia[1][2])).toBeLessThan(1e-3);
  });

  it('rotates inertia tensor and transforms points cleanly under 90 deg Z rotation', () => {
    const place = { o: [10, 20, 30], x: [0, 1, 0], y: [-1, 0, 0], z: [0, 0, 1] };
    const p = applyPlacePoint(place, [5, 0, 0]);
    expect(p[0]).toBeCloseTo(10, 9);
    expect(p[1]).toBeCloseTo(25, 9);
    expect(p[2]).toBeCloseTo(30, 9);

    const I: Mat3 = [[10, 0, 0], [0, 40, 0], [0, 0, 50]];
    const Iw = rotateInertia(place, I);
    expect(Iw[0][0]).toBeCloseTo(40, 9);
    expect(Iw[1][1]).toBeCloseTo(10, 9);
    expect(Iw[2][2]).toBeCloseTo(50, 9);
  });

  it('sanitizes URDF names safely', () => {
    expect(urdfSafeName('Left Arm / v2')).toBe('Left_Arm_v2');
    expect(urdfSafeName('   ')).toBe('link');
  });
});

describe('buildUrdf', () => {
  it('converts single-body mass and inertia from mm/g/cm³ to SI kg/m/kg·m² and emits valid URDF XML', () => {
    // 100 mm cube of aluminium (2.7 g/cm³): mass = 2.7 kg, Ixx = 1/12 * 2.7 * (0.1^2 + 0.1^2) = 0.0045 kg·m²
    const V = 1e6;
    const Iunit = (V * (100 ** 2 + 100 ** 2)) / 12;
    const built = buildUrdf({
      name: 'Alu Cube',
      links: [{
        id: 'B1',
        name: 'Base Block',
        positions: boxMesh(0, 0, 0, 100, 100, 100),
        color: '#336699',
        opacity: 0.8,
        mass: {
          volume: V,
          com: [50, 50, 50],
          inertia: [[Iunit, 0, 0], [0, Iunit, 0], [0, 0, Iunit]],
          density: 2.7,
        },
      }],
    });

    expect(built.robotName).toBe('Alu_Cube');
    expect(built.links).toHaveLength(1);
    expect(built.joints).toHaveLength(0);
    expect(built.links[0].massKg).toBeCloseTo(2.7, 9);
    expect(built.links[0].comLocalMeters).toEqual([0.05, 0.05, 0.05]);
    expect(built.links[0].inertiaKgM2[0][0]).toBeCloseTo(0.0045, 9);
    expect(built.xml).toContain('<?xml version="1.0" encoding="utf-8"?>');
    expect(built.xml).toContain('<robot name="Alu_Cube">');
    expect(built.xml).toContain('<link name="Base_Block">');
    expect(built.xml).toContain('<mass value="2.7"/>');
    expect(built.xml).toContain('ixx="0.0045"');
    expect(built.xml).toContain('<mesh filename="meshes/Base_Block.stl"/>');
    expect(built.xml).toContain('<color rgba="0.2 0.4 0.6 0.8"/>');
  });

  it('reconstructs inertia from principal moments and axes when full tensor is omitted', () => {
    const built = buildUrdf({
      name: 'PrincipalTest',
      links: [{
        id: 'B1',
        name: 'Body',
        positions: boxMesh(0, 0, 0, 100, 100, 100),
        mass: {
          volume: 1e6,
          com: [50, 50, 50],
          principal: [1e9, 2e9, 3e9],
          axes: [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
          density: 1.0,
        },
      }],
    });
    expect(built.links[0].inertiaKgM2[0][0]).toBeCloseTo(0.002, 9);
    expect(built.links[0].inertiaKgM2[1][1]).toBeCloseTo(0.001, 9);
    expect(built.links[0].inertiaKgM2[2][2]).toBeCloseTo(0.003, 9);
  });

  it('maps hinge mate to continuous joint and shifts child mesh/CoM to joint pivot in metres', () => {
    const faceGeo = new Map<string, UrdfFaceGeo>([
      ['F1.C@F2.1', { kind: 'cylinder', o: [100, 0, 50], d: [0, 1, 0] }],
      ['F1.C@F3.1', { kind: 'cylinder', o: [100, 0, 50], d: [0, 1, 0] }],
    ]);
    const built = buildUrdf({
      name: 'HingeArm',
      links: [
        { id: 'F2', name: 'Base', positions: boxMesh(0, -25, 0, 100, 25, 50), fixed: true },
        { id: 'F3', name: 'Arm', positions: boxMesh(100, -10, 40, 250, 10, 60) },
      ],
      mates: [
        { id: 'F4', name: 'Shoulder', kind: 'hinge', a: 'F1.C@F3.1', b: 'F1.C@F2.1', a2: 'F1.P@F3.1', b2: 'F1.P@F2.1' },
      ],
      faceGeo,
    });

    expect(built.joints).toHaveLength(1);
    const j = built.joints[0];
    expect(j.type).toBe('continuous');
    expect(j.parent).toBe('Base');
    expect(j.child).toBe('Arm');
    expect(j.axis).toEqual([0, 1, 0]);
    // Pivot is nearest point on line (100, 0, 50) + t*(0,1,0) to Arm CoM (175, 0, 50) -> (100, 0, 50) mm = (0.1, 0, 0.05) m
    expect(j.originMeters[0]).toBeCloseTo(0.1, 9);
    expect(j.originMeters[1]).toBeCloseTo(0, 9);
    expect(j.originMeters[2]).toBeCloseTo(0.05, 9);
    // Child CoM in local frame = (175 - 100, 0 - 0, 50 - 50) mm = (0.075, 0, 0) m
    expect(built.links[1].comLocalMeters[0]).toBeCloseTo(0.075, 6);
    expect(built.links[1].comLocalMeters[1]).toBeCloseTo(0, 6);
    expect(built.links[1].comLocalMeters[2]).toBeCloseTo(0, 6);
    expect(built.xml).toContain('type="continuous"');
    expect(built.xml).toContain('<axis xyz="0 1 0"/>');
    expect(built.xml).not.toContain('<limit');
  });

  it('maps hinge + angle limits mate to revolute joint with radian limits', () => {
    const faceGeo = new Map<string, UrdfFaceGeo>([
      ['C@F2.1', { kind: 'cylinder', o: [0, 0, 50], d: [0, 0, 1] }],
      ['C@F3.1', { kind: 'cylinder', o: [0, 0, 50], d: [0, 0, 1] }],
      ['P@F2.1', { kind: 'plane', o: [0, 0, 50], n: [1, 0, 0] }],
      ['P@F3.1', { kind: 'plane', o: [0, 0, 50], n: [0, 1, 0] }], // currently at 90 deg
    ]);
    const built = buildUrdf({
      name: 'LimitedHinge',
      links: [
        { id: 'F2', name: 'Base', positions: boxMesh(0, 0, 0, 50, 50, 50), fixed: true },
        { id: 'F3', name: 'Door', positions: boxMesh(0, 0, 50, 100, 10, 100) },
      ],
      mates: [
        { id: 'F4', kind: 'hinge', a: 'C@F3.1', b: 'C@F2.1', a2: 'S@F3.1', b2: 'S@F2.1' },
        { id: 'F5', kind: 'limits', of: 'angle', a: 'P@F3.1', b: 'P@F2.1', min: 30, max: 150 },
      ],
      faceGeo,
    });

    expect(built.joints).toHaveLength(1);
    const j = built.joints[0];
    expect(j.type).toBe('revolute');
    // Assembled angle is 90 deg, limits 30..150 deg -> relative range is -60..+60 deg (-pi/3 .. +pi/3)
    expect(j.limit).toBeDefined();
    expect(j.limit!.lower).toBeCloseTo(-Math.PI / 3, 2);
    expect(j.limit!.upper).toBeCloseTo(Math.PI / 3, 2);
    expect(built.xml).toContain('type="revolute"');
    expect(built.xml).toContain('<limit lower=');
  });

  it('maps concentric + parallel + distance limits to prismatic joint with metre limits', () => {
    const faceGeo = new Map<string, UrdfFaceGeo>([
      ['C@F2.1', { kind: 'cylinder', o: [0, 0, 0], d: [1, 0, 0] }],
      ['C@F3.1', { kind: 'cylinder', o: [50, 0, 0], d: [1, 0, 0] }],
      ['Top@F2.1', { kind: 'plane', o: [0, 0, 20], n: [0, 0, 1] }],
      ['Top@F3.1', { kind: 'plane', o: [50, 0, 20], n: [0, 0, 1] }],
      ['End@F2.1', { kind: 'plane', o: [0, 0, 0], n: [1, 0, 0] }],
      ['End@F3.1', { kind: 'plane', o: [50, 0, 0], n: [1, 0, 0] }],
    ]);
    const built = buildUrdf({
      name: 'LinearRail',
      links: [
        { id: 'F2', name: 'Rail', positions: boxMesh(0, -10, -10, 200, 10, 10), fixed: true },
        { id: 'F3', name: 'Carriage', positions: boxMesh(50, -15, -15, 90, 15, 15) },
      ],
      mates: [
        { id: 'F4', kind: 'concentric', a: 'C@F3.1', b: 'C@F2.1' },
        { id: 'F5', kind: 'parallel', a: 'Top@F3.1', b: 'Top@F2.1' },
        { id: 'F6', kind: 'limits', of: 'distance', a: 'End@F3.1', b: 'End@F2.1', min: 10, max: 150 },
      ],
      faceGeo,
    });

    expect(built.joints).toHaveLength(1);
    const j = built.joints[0];
    expect(j.type).toBe('prismatic');
    expect(j.axis).toEqual([1, 0, 0]);
    // Current distance is 50 mm, limits 10..150 mm -> relative range -40..+100 mm = -0.04..+0.1 m
    expect(j.limit!.lower).toBeCloseTo(-0.04, 6);
    expect(j.limit!.upper).toBeCloseTo(0.1, 6);
    expect(built.xml).toContain('type="prismatic"');
  });

  it('maps lock mate and unmated bodies to fixed joints forming a single valid tree', () => {
    const built = buildUrdf({
      name: 'MultiPart',
      links: [
        { id: 'F2', name: 'Frame', positions: boxMesh(0, 0, 0, 100, 100, 20), fixed: true },
        { id: 'F3', name: 'Bracket', positions: boxMesh(10, 10, 20, 40, 40, 50) },
        { id: 'F4', name: 'Bracket', positions: boxMesh(60, 60, 20, 90, 90, 50) }, // duplicate name & unmated
      ],
      mates: [
        { id: 'F5', kind: 'lock', a: 'A@F3.1', b: 'B@F2.1' },
      ],
    });

    expect(built.links.map((l) => l.name)).toEqual(['Frame', 'Bracket', 'Bracket_2']);
    expect(built.joints).toHaveLength(2);
    expect(built.joints.every((j) => j.type === 'fixed')).toBe(true);
    expect(built.joints[0].parent).toBe('Frame');
    expect(built.joints[0].child).toBe('Bracket');
    expect(built.joints[1].parent).toBe('Frame');
    expect(built.joints[1].child).toBe('Bracket_2');
  });

  it('computes relative joint origins across a multi-link chain and warns on kinematic loops', () => {
    const faceGeo = new Map<string, UrdfFaceGeo>([
      ['J1@F2.1', { kind: 'cylinder', o: [0, 0, 100], d: [0, 0, 1] }],
      ['J1@F3.1', { kind: 'cylinder', o: [0, 0, 100], d: [0, 0, 1] }],
      ['J2@F3.1', { kind: 'cylinder', o: [200, 0, 100], d: [0, 1, 0] }],
      ['J2@F4.1', { kind: 'cylinder', o: [200, 0, 100], d: [0, 1, 0] }],
    ]);
    const built = buildUrdf({
      name: 'TwoLinkArm',
      links: [
        { id: 'F2', name: 'Base', positions: boxMesh(-50, -50, 0, 50, 50, 100), fixed: true },
        { id: 'F3', name: 'Upper', positions: boxMesh(0, -10, 100, 200, 10, 120) },
        { id: 'F4', name: 'Forearm', positions: boxMesh(200, -10, 100, 350, 10, 120) },
      ],
      mates: [
        { id: 'M1', kind: 'hinge', a: 'J1@F3.1', b: 'J1@F2.1', a2: 'S1@F3.1', b2: 'S1@F2.1' },
        { id: 'M2', kind: 'hinge', a: 'J2@F4.1', b: 'J2@F3.1', a2: 'S2@F4.1', b2: 'S2@F3.1' },
        { id: 'M3', kind: 'lock', a: 'L@F4.1', b: 'L@F2.1' }, // loop closure
      ],
      faceGeo,
    });

    expect(built.joints).toHaveLength(2);
    // Joint 1: Base (0,0,0) -> Upper (0, 0, 110 mm) [nearest on Z axis to CoM (100,0,110)]
    // Joint 2: Upper (0, 0, 110) -> Forearm (200, 0, 100) [nearest on Y axis to CoM (275,0,110)] -> rel = (0.2, 0, -0.01) m
    const j1 = built.joints[0], j2 = built.joints[1];
    expect(j1.parent).toBe('Base');
    expect(j1.child).toBe('Upper');
    expect(j2.parent).toBe('Upper');
    expect(j2.child).toBe('Forearm');
    expect(j1.originMeters[0] + j2.originMeters[0]).toBeCloseTo(0.2, 6);
    expect(j1.originMeters[1] + j2.originMeters[1]).toBeCloseTo(0, 6);
    expect(j1.originMeters[2] + j2.originMeters[2]).toBeCloseTo(0.1, 6);
    expect(built.warnings.some((w) => w.includes('kinematic loop'))).toBe(true);
  });
});

describe('exportUrdf zip archive', () => {
  it('bundles <name>.urdf and binary STL meshes scaled to metres in a zip', async () => {
    const res = await exportUrdf({
      name: 'Rover / Chassis',
      links: [
        { id: 'L1', name: 'Body', positions: boxMesh(0, 0, 0, 100, 50, 20), fixed: true },
        { id: 'L2', name: 'Wheel', positions: boxMesh(100, 0, 0, 140, 20, 40) },
      ],
    });

    expect(res.file).toBeDefined();
    expect(res.file!.name).toBe('Rover _ Chassis-urdf.zip');
    expect(res.file!.mime).toBe('application/zip');
    expect(res.notices[0]).toEqual({
      level: 'info',
      key: 'io.doneUrdf',
      params: { name: 'Rover _ Chassis-urdf.zip', links: 2, joints: 1, triangles: 24 },
    });

    const entries = await zipRead(res.file!.data as Uint8Array);
    expect(entries.map((e) => e.name)).toEqual([
      'Rover _ Chassis.urdf',
      'meshes/Body.stl',
      'meshes/Wheel.stl',
    ]);

    const xml = new TextDecoder().decode(entries[0].data);
    expect(xml).toContain('<mesh filename="meshes/Body.stl"/>');
    expect(xml).toContain('<mesh filename="meshes/Wheel.stl"/>');

    // Verify STL vertices are in metres (max X of Body is 100 mm = 0.1 m)
    const bodyStl = parseStl(entries[1].data);
    expect(bodyStl.positions.length).toBe(12 * 9);
    let maxX = -Infinity;
    for (let i = 0; i < bodyStl.positions.length; i += 3) maxX = Math.max(maxX, bodyStl.positions[i]);
    expect(maxX).toBeCloseTo(0.1, 5);
  });

  it('returns io.noBody error when there are no non-empty links', async () => {
    const res = await exportUrdf({ name: 'Empty', links: [] });
    expect(res.file).toBeUndefined();
    expect(res.notices).toEqual([{ level: 'error', key: 'io.noBody' }]);
  });
});

describe('buildUrdfInputFromDoc', () => {
  it('groups assembly mesh by insertPart components, rotates component inertia, and extracts mates', () => {
    const b1 = boxMesh(0, 0, 0, 100, 100, 20);
    const b2 = boxMesh(100, 0, 0, 120, 100, 20);
    const positions = new Float32Array(b1.length + b2.length);
    positions.set(b1, 0);
    positions.set(b2, b1.length);
    const triFace = new Int32Array(24);
    for (let i = 0; i < 12; i++) triFace[i] = 0;
    for (let i = 12; i < 24; i++) triFace[i] = 1;

    const input = buildUrdfInputFromDoc({
      doc: {
        name: 'Gripper',
        material: 'PLA',
        features: [
          { id: 'F2', type: 'insertPart', name: 'Palm', fixed: true, part: { name: 'Palm', material: 'Aluminium' } },
          { id: 'F3', type: 'insertPart', name: 'Finger', part: { name: 'Finger' } },
          { id: 'F4', type: 'mate', kind: 'lock', a: 'F1@F3.1', b: 'F1@F2.1' },
        ],
      },
      mesh: { positions, triFace, faceIds: ['F1@F2.1', 'F1@F3.1'] },
      bodyRows: [],
      visibleOnly: false,
      components: [
        { id: 'F2', dof: 0, place: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } },
        { id: 'F3', dof: 0, place: { o: [100, 0, 0], x: [0, 1, 0], y: [-1, 0, 0], z: [0, 0, 1] } },
      ],
      componentMass: new Map([
        ['F2', { volume: 2e5, com: [50, 50, 10], inertia: [[1e8, 0, 0], [0, 2e8, 0], [0, 0, 3e8]] }],
      ]),
    });

    expect(input.links).toHaveLength(2);
    expect(input.links[0].id).toBe('F2');
    expect(input.links[0].fixed).toBe(true);
    expect(input.links[0].density).toBeCloseTo(2.7, 2);
    expect(input.links[0].mass?.volume).toBe(2e5);
    expect(input.links[1].id).toBe('F3');
    expect(input.links[1].density).toBeCloseTo(1.24, 2);
    expect(input.mates).toHaveLength(1);
    expect(input.mates![0].kind).toBe('lock');
  });

  it('respects visibleOnly in multi-body part mode', () => {
    const b1 = boxMesh(0, 0, 0, 10, 10, 10);
    const b2 = boxMesh(20, 0, 0, 30, 10, 10);
    const positions = new Float32Array(b1.length + b2.length);
    positions.set(b1, 0);
    positions.set(b2, b1.length);
    const triFace = new Int32Array(24);
    for (let i = 0; i < 12; i++) triFace[i] = 0;
    for (let i = 12; i < 24; i++) triFace[i] = 1;

    const input = buildUrdfInputFromDoc({
      doc: { name: 'TwoBodies', features: [] },
      mesh: { positions, triFace, faceIds: ['F1', 'F2'] },
      bodyRows: [
        { key: 'k1', name: 'Shown', hidden: false, faces: ['F1'], look: { color: '#ff0000' } },
        { key: 'k2', name: 'Hidden', hidden: true, faces: ['F2'], look: {} },
      ],
      visibleOnly: true,
    });

    expect(input.links).toHaveLength(1);
    expect(input.links[0].name).toBe('Shown');
    expect(input.links[0].color).toBe('#ff0000');
  });
});
