import { describe, expect, it } from 'vitest';
import { movePoint } from '@kit/motion';
import { displayBody } from './assembly/display';
import { NO_EXPLODE } from './assembly/model';
import { jointRigid, pluginPoseMaps, readPluginJoints } from './pluginMotion';

describe('pluginMotion: plugin-declared joint/motion hints', () => {
  it('reads movable revolute and prismatic joints from pluginRuns and skips rigid or invalid entries', () => {
    const entries = readPluginJoints({
      Cabinet: {
        meta: {
          joints: [
            { name: 'Door L', kind: 'revolute', bodies: ['Door L'], origin: [0, 0, 0], axis: [0, 0, 1], min: 0, max: 110 },
            { name: 'Drawer 1', kind: 'prismatic', bodies: ['Drawer 1'], origin: [0, 0, 200], axis: [0, -1, 0], min: 0, max: 350 },
            { name: 'Fixed Back', kind: 'rigid', bodies: ['Back'], origin: [0, 0, 0], axis: [0, 0, 1], min: 0, max: 0 },
          ],
        },
      },
      Empty: {},
    });
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.id)).toEqual(['Cabinet:Door L', 'Cabinet:Drawer 1']);
    expect(entries[0].joint.kind).toBe('revolute');
    expect(entries[1].joint.kind).toBe('prismatic');
  });

  it('computes exact Rodrigues rotation for revolute hinges and linear translation for prismatic slides', () => {
    const hinge = jointRigid({ name: 'H', kind: 'revolute', bodies: ['Door'], origin: [10, 0, 0], axis: [0, 0, 1], min: 0, max: 110 }, 90);
    // Point (20, 0, 0) rotated 90° CCW about Z through (10, 0, 0) lands at (10, 10, 0)
    const p = movePoint(hinge, [20, 0, 0]);
    expect(p[0]).toBeCloseTo(10, 6);
    expect(p[1]).toBeCloseTo(10, 6);
    expect(p[2]).toBeCloseTo(0, 6);

    const slide = jointRigid({ name: 'S', kind: 'prismatic', bodies: ['Drawer'], origin: [0, 0, 0], axis: [0, -1, 0], min: 0, max: 300 }, 150);
    expect(movePoint(slide, [5, 10, 20])).toEqual([5, -140, 20]);
  });

  it('maps plugin joint poses onto body faces and edges and moves them via displayBody', () => {
    const entries = readPluginJoints({
      Cabinet: {
        meta: {
          joints: [{ name: 'Drawer', kind: 'prismatic', bodies: ['Drawer'], origin: [0, 0, 0], axis: [0, 1, 0], min: 0, max: 200 }],
        },
      },
    });
    const rows = [
      { name: 'Body 1', docName: 'Carcass', faces: ['F1.S1'], edges: ['F1.E1'] },
      { name: 'Body 2', docName: 'Drawer', faces: ['F2.S1'], edges: ['F2.E1'] },
    ];
    const { facePose, edgePose } = pluginPoseMaps(entries, { 'Cabinet:Drawer': 50 }, rows);
    expect(facePose.has('F1.S1')).toBe(false);
    expect(facePose.has('F2.S1')).toBe(true);
    expect(edgePose.has('F2.E1')).toBe(true);

    const body = {
      mesh: {
        positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 5, 10, 0, 5, 0, 10, 5]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
        triFace: new Int32Array([0, 1]),
        faceIds: ['F1.S1', 'F2.S1'],
      },
      edges: [
        { key: 'F1.E1', pts: [[0, 0, 0], [10, 0, 0]] },
        { key: 'F2.E1', pts: [[0, 0, 5], [10, 0, 5]] },
      ],
      box: { min: [0, 0, 0], max: [10, 10, 5] },
    };
    const moved = displayBody(body, { inserts: new Set(), hidden: new Set(), explode: NO_EXPLODE, facePose, edgePose });
    // Carcass triangle (F1.S1) stays at y=0..10; Drawer triangle (F2.S1) shifts +50 in Y
    expect(moved.mesh.positions[1]).toBe(0);
    expect(moved.mesh.positions[10]).toBe(50);
    expect(moved.edges[0].pts[0]).toEqual([0, 0, 0]);
    expect(moved.edges[1].pts[0]).toEqual([0, 50, 5]);
  });
});
