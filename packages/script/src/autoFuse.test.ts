import { describe, expect, it } from 'vitest';
import {
  applyAutoFuseOp,
  boxesOverlap,
  evaluate,
  fuseIntersectingOps,
  intersectingGroups,
  lumpsFromGeometry,
  reservedNames,
  runScript,
  type Ctx,
  type EditOp,
  type Geometry,
  type ScriptHost,
} from './index';

/** Build a minimal triangulated box mesh for one lump with a single face id. */
function boxMesh(
  boxes: Array<{ faceId: string; lump: number; min: [number, number, number]; max: [number, number, number] }>,
  withFaceLumps = true,
): Geometry {
  const positions: number[] = [];
  const faceIds: string[] = [];
  const triFace: number[] = [];
  const faceLumps: Record<string, number> = {};
  const edges: Geometry['edges'] = [];

  boxes.forEach((b, idx) => {
    faceIds.push(b.faceId);
    if (withFaceLumps) faceLumps[b.faceId] = b.lump;
    const [x0, y0, z0] = b.min;
    const [x1, y1, z1] = b.max;
    // Two triangles spanning the diagonal corners so AABB equals [min, max]
    positions.push(
      x0, y0, z0, x1, y0, z0, x1, y1, z1,
      x0, y0, z0, x1, y1, z1, x0, y1, z1,
    );
    triFace.push(idx, idx);
    edges.push({ key: `e${idx}`, faces: [b.faceId], pts: [[x0, y0, z0], [x1, y1, z1]] });
  });

  return {
    mesh: {
      positions: new Float32Array(positions),
      normals: new Float32Array(positions.length),
      faceIds,
      triFace: new Uint32Array(triFace),
    },
    edges,
    box: null,
    ...(withFaceLumps ? { faceLumps } : {}),
  };
}

function makeCtx(geo: Geometry): Ctx {
  let n = 10;
  return { geo, nextId: () => `F${++n}`, lastSketch: null, lastFeature: null };
}

describe('autoFuse geometry helpers', () => {
  it('detects AABB overlap within tolerance', () => {
    const a = { min: [0, 0, 0] as [number, number, number], max: [10, 10, 10] as [number, number, number] };
    const b = { min: [5, 0, 0] as [number, number, number], max: [15, 10, 10] as [number, number, number] };
    const touching = { min: [10, 0, 0] as [number, number, number], max: [20, 10, 10] as [number, number, number] };
    const disjoint = { min: [25, 0, 0] as [number, number, number], max: [35, 10, 10] as [number, number, number] };
    expect(boxesOverlap(a, b)).toBe(true);
    expect(boxesOverlap(a, touching)).toBe(true);
    expect(boxesOverlap(a, disjoint)).toBe(false);
  });

  it('returns empty ops for empty geometry or a single lump', () => {
    expect(fuseIntersectingOps(makeCtx({ mesh: null, edges: [], box: null }))).toEqual([]);
    const single = boxMesh([{ faceId: 'F2.C1', lump: 0, min: [0, 0, 0], max: [10, 10, 10] }]);
    expect(fuseIntersectingOps(makeCtx(single))).toEqual([]);
  });

  it('groups overlapping lumps and leaves disjoint lumps untouched', () => {
    const geo = boxMesh([
      { faceId: 'F2.C1', lump: 0, min: [0, 0, 0], max: [20, 20, 10] },
      { faceId: 'F4.C1', lump: 1, min: [10, 0, 0], max: [30, 20, 10] },
      { faceId: 'F6.C1', lump: 2, min: [60, 0, 0], max: [70, 10, 10] },
    ]);
    const lumps = lumpsFromGeometry(geo);
    expect(lumps).toHaveLength(3);
    const groups = intersectingGroups(lumps);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((l) => l.index)).toEqual([0, 1]);

    const ops = fuseIntersectingOps(makeCtx(geo));
    expect(ops).toHaveLength(1);
    expect(ops[0].feature).toMatchObject({
      type: 'combine',
      op: 'union',
      target: { face: 'F2.C1' },
      tools: [{ face: 'F4.C1' }],
    });
  });

  it('handles transitive overlap chains in BFS order and multiple disjoint pairs', () => {
    const geo = boxMesh([
      { faceId: 'A.C1', lump: 0, min: [0, 0, 0], max: [10, 10, 10] },
      { faceId: 'C.C1', lump: 1, min: [15, 0, 0], max: [25, 10, 10] },
      { faceId: 'B.C1', lump: 2, min: [8, 0, 0], max: [18, 10, 10] },
      { faceId: 'D.C1', lump: 3, min: [100, 0, 0], max: [110, 10, 10] },
      { faceId: 'E.C1', lump: 4, min: [105, 0, 0], max: [115, 10, 10] },
    ]);
    const ops = fuseIntersectingOps(makeCtx(geo));
    expect(ops).toHaveLength(2);
    // First group: A overlaps B, B overlaps C -> BFS visits A, B, C
    expect(ops[0].feature).toMatchObject({
      type: 'combine',
      op: 'union',
      target: { face: 'A.C1' },
      tools: [{ face: 'B.C1' }, { face: 'C.C1' }],
    });
    // Second group: D overlaps E
    expect(ops[1].feature).toMatchObject({
      type: 'combine',
      op: 'union',
      target: { face: 'D.C1' },
      tools: [{ face: 'E.C1' }],
    });
  });

  it('falls back to face-edge connected components when faceLumps is absent', () => {
    const geo = boxMesh([
      { faceId: 'F2.C1', lump: 0, min: [0, 0, 0], max: [20, 20, 10] },
      { faceId: 'F4.C1', lump: 1, min: [10, 0, 0], max: [30, 20, 10] },
      { faceId: 'F6.C1', lump: 2, min: [60, 0, 0], max: [70, 10, 10] },
    ], false);
    const ops = fuseIntersectingOps(makeCtx(geo));
    expect(ops).toHaveLength(1);
    expect(ops[0].feature).toMatchObject({
      type: 'combine',
      op: 'union',
      target: { face: 'F2.C1' },
      tools: [{ face: 'F4.C1' }],
    });
  });

  it('applyAutoFuseOp sets op: add only on additive features without explicit op or body', () => {
    for (const type of ['extrude', 'revolve', 'sweep', 'loft', 'box', 'cylinder', 'sphere', 'cone', 'torus', 'pipe', 'coil']) {
      const f: Record<string, unknown> = { type, id: 'F1' };
      applyAutoFuseOp(f);
      expect(f.op, type).toBe('add');
    }
    const explicitNew: Record<string, unknown> = { type: 'extrude', id: 'F2', op: 'newBody' };
    applyAutoFuseOp(explicitNew);
    expect(explicitNew.op).toBe('newBody');

    const explicitCut: Record<string, unknown> = { type: 'extrude', id: 'F3', op: 'cut' };
    applyAutoFuseOp(explicitCut);
    expect(explicitCut.op).toBe('cut');

    const explicitBody: Record<string, unknown> = { type: 'sphere', id: 'F4', body: 'Ball' };
    applyAutoFuseOp(explicitBody);
    expect(explicitBody.op).toBeUndefined();

    const nonAdditive: Record<string, unknown> = { type: 'fillet', id: 'F5' };
    applyAutoFuseOp(nonAdditive);
    expect(nonAdditive.op).toBeUndefined();
  });
});

describe('autoFuse & fuseIntersecting script API', () => {
  function mockHost(geoAfterMove: Geometry): { host: ScriptHost; applied: EditOp[] } {
    const applied: EditOp[] = [];
    let hasMoved = false;
    const host: ScriptHost = {
      load: async () => {},
      edit: async (ops) => {
        applied.push(...ops);
        if (ops.some((o) => o.feature.type === 'moveBody')) hasMoved = true;
        return { ok: true };
      },
      geometry: () => (hasMoved ? geoAfterMove : { mesh: null, edges: [], box: null }),
    };
    return { host, applied };
  }

  const overlappingGeo = boxMesh([
    { faceId: 'F2.C1', lump: 0, min: [-10, -10, 0], max: [10, 10, 10] },
    { faceId: 'F2.C1@F3.1', lump: 1, min: [0, -10, 0], max: [20, 10, 10] },
    { faceId: 'F5.C1', lump: 2, min: [55, -5, 0], max: [65, 5, 10] },
  ]);

  it('keeps default behavior (autoFuse off) with zero combine ops after moveBody', async () => {
    const { host, applied } = mockHost(overlappingGeo);
    const code = `part('Off')
      .sketch('front', (s) => s.rect(20, 20)).extrude(10, { newBody: 'A' })
      .moveBody('A', { translate: [10, 0, 0], copy: true });`;
    const r = await runScript(code, host);
    expect(r.errors).toEqual([]);
    expect(applied.some((o) => o.feature.type === 'combine')).toBe(false);
  });

  it('emits combine union after moveBody when enabled via part options, method, free function, callback, or runScript option', async () => {
    const variants: Array<{ label: string; code: string; opts?: { autoFuse?: boolean; implicitUnion?: boolean } }> = [
      {
        label: 'part({ autoFuse: true })',
        code: `part('P', { autoFuse: true })
          .sketch('front', (s) => s.rect(20, 20)).extrude(10, { newBody: 'A' })
          .moveBody('A', { translate: [10, 0, 0], copy: true });`,
      },
      {
        label: 'part({ implicitUnion: true })',
        code: `part('P', { implicitUnion: true })
          .sketch('front', (s) => s.rect(20, 20)).extrude(10, { newBody: 'A' })
          .moveBody('A', { translate: [10, 0, 0], copy: true });`,
      },
      {
        label: 'part.autoFuse(true)',
        code: `part('P').autoFuse(true)
          .sketch('front', (s) => s.rect(20, 20)).extrude(10, { newBody: 'A' })
          .moveBody('A', { translate: [10, 0, 0], copy: true });`,
      },
      {
        label: 'free autoFuse(true)',
        code: `const p = part('P');
          autoFuse(true);
          p.sketch('front', (s) => s.rect(20, 20)).extrude(10, { newBody: 'A' })
            .moveBody('A', { translate: [10, 0, 0], copy: true });`,
      },
      {
        label: 'scoped autoFuse(() => ...)',
        code: `const p = part('P')
            .sketch('front', (s) => s.rect(20, 20)).extrude(10, { newBody: 'A' });
          p.autoFuse(() => {
            p.moveBody('A', { translate: [10, 0, 0], copy: true });
          });`,
      },
      {
        label: 'runScript({ autoFuse: true })',
        code: `part('P')
          .sketch('front', (s) => s.rect(20, 20)).extrude(10, { newBody: 'A' })
          .moveBody('A', { translate: [10, 0, 0], copy: true });`,
        opts: { autoFuse: true },
      },
    ];

    for (const v of variants) {
      const { host, applied } = mockHost(overlappingGeo);
      const r = await runScript(v.code, host, {}, v.opts);
      expect(r.errors, v.label).toEqual([]);
      const combines = applied.filter((o) => o.feature.type === 'combine');
      expect(combines, v.label).toHaveLength(1);
      expect(combines[0].feature, v.label).toMatchObject({
        type: 'combine',
        op: 'union',
        target: { face: 'F2.C1' },
        tools: [{ face: 'F2.C1@F3.1' }],
      });
    }
  });

  it('part.autoFuse(false) overrides runScript({ autoFuse: true })', async () => {
    const { host, applied } = mockHost(overlappingGeo);
    const code = `part('P').autoFuse(false)
      .sketch('front', (s) => s.rect(20, 20)).extrude(10, { newBody: 'A' })
      .moveBody('A', { translate: [10, 0, 0], copy: true });`;
    const r = await runScript(code, host, {}, { autoFuse: true });
    expect(r.errors).toEqual([]);
    expect(applied.some((o) => o.feature.type === 'combine')).toBe(false);
  });

  it('validates fuseIntersecting options and free-function preconditions', () => {
    const e1 = evaluate(`autoFuse(true);`);
    expect(e1.errors[0].message).toContain('autoFuse() needs a part() before it');

    const e2 = evaluate(`fuseIntersecting();`);
    expect(e2.errors[0].message).toContain('fuseIntersecting() needs a part() before it');

    const e3 = evaluate(`part('X').fuseIntersecting({ tolerance: -1 });`);
    expect(e3.errors[0].message).toContain('tolerance must be a finite number >= 0');

    expect(reservedNames()).toContain('autoFuse');
    expect(reservedNames()).toContain('fuseIntersecting');
  });
});
