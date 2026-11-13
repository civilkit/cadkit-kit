import { describe, expect, it } from 'vitest';
import { APP_READBACK_TOOLS, READBACK_TOOLS, ReadbackError, resolveEntity, type BodyRef, type ReadbackHost, type ReadbackTool } from './index';

const bodies: BodyRef[] = [
  { name: 'Base', key: '@body:F2.C0', volume: 4000, faces: ['F2.C0', 'F2.C1', 'F2.S.e1'] },
  { name: 'Peg', key: '@body:F4.C0', volume: 1000, faces: ['F4.C0', 'F4.S.e1'] },
];
const tool = (name: string): ReadbackTool => APP_READBACK_TOOLS.find((t) => t.name === name)!;
const dist = { distance: 15, pointA: [10, 0, 5], pointB: [25, 0, 5], a: { kind: 'face', id: 'F2.S.e1' }, b: { kind: 'face', id: 'F4.S.e1' }, intersects: false, direction: [1, 0, 0] };
function host(over: Partial<ReadbackHost['kernel']> & { interference?: ReadbackHost['interference']; bodies?: BodyRef[] } = {}): ReadbackHost {
  const calls: unknown[] = [];
  const h = {
    kernel: {
      distance: async (a: unknown, b: unknown) => { calls.push(['distance', a, b]); return dist; },
      clearance: async () => ({ min: 20, count: 1, pairsTested: 6, truncated: false, pairs: [{ a: 'F2.S.e1', b: 'F4.S.e1', distance: 15, kind: 'gap', pointA: [10, 0, 5], pointB: [25, 0, 5] }] }),
      thickness: async () => ({ method: 'ray', samples: 100, noExit: 0, minThickness: 1.5, location: { thickness: 1.5, point: [0, 0, 0], farPoint: [0, 0, 1.5], face: 'F2.C0', farFace: 'F2.C1', direction: [0, 0, 1] }, meanThickness: 5, thin: [
        { thickness: 1.5, point: [0, 0, 0], farPoint: [0, 0, 1.5], face: 'F2.C0', farFace: 'F2.C1', direction: [0, 0, 1] },
        { thickness: 8, point: [30, 0, 0], farPoint: [30, 0, 8], face: 'F4.C0', farFace: 'F4.S.e1', direction: [0, 0, 1] }] }),
      angles: async (q: { draft?: unknown; faces?: unknown }) => q.draft
        ? { draft: [{ face: 'F2.S.e1', draft: 0, min: 0, max: 0, class: 'vertical' }, { face: 'F2.C0', draft: 90, min: 90, max: 90, class: 'parting' }, { face: 'F4.S.e1', draft: -3, min: -3, max: -3, class: 'undercut' }, { face: 'F4.C1', draft: 4, min: 4, max: 4, class: 'ok' }], violations: ['F2.S.e1', 'F4.S.e1'] }
        : { between: { angle: 90, normalAngle: 90, parallel: false } },
      profiles: async () => ({ rules: [], profiles: [{ id: 'fdm-print', name: 'FDM', description: '', rules: [{ id: 'minWall', title: 'Minimum wall', description: '', severity: 'error', params: [{ name: 'min', type: 'number', default: 1.2, value: 1.2, unit: 'mm', description: '' }] }, { id: 'overhang', title: 'Overhang', description: '', severity: 'warn', params: [{ name: 'angle', type: 'number', default: 45, value: 45, unit: 'deg', description: '' }, { name: 'direction', type: 'vec3', default: [0, 1, 0], value: [0, 1, 0], unit: '', description: '' }] }] }] }),
      checkProfile: async (p: unknown) => { calls.push(['checkProfile', p]); return { profile: { id: 'fdm-print', name: 'FDM' }, ok: false, issues: [{ rule: 'minWall', severity: 'error', message: 'Wall is 0.5 mm', faces: ['F2.C0'], edges: [], value: 0.5, limit: 1.2, unit: 'mm', at: [1, 2, 3] }], summary: { errors: 1, warnings: 0, infos: 0, total: 1, rules: [{ rule: 'minWall', severity: 'error', issues: 1, passed: false }, { rule: 'overhang', severity: 'warn', issues: 0, passed: true }], truncated: [], skippedFaces: [], samples: 3000 } }; },
      ...over,
    },
    interference: over.interference ?? (async () => ({ bodies: 2, pairs: [{ a: 'F2.C0', b: 'F4.C0', volume: 500, com: [7, 0, 5], box: { min: [5, -5, 0], max: [10, 5, 10] } }] })),
    bodies: async () => over.bodies ?? bodies,
    calls,
  };
  return h as unknown as ReadbackHost & { calls: unknown[] };
}
const run = (name: string, input: Record<string, unknown>, h = host()) => tool(name).run(input, h);
const fails = async (p: Promise<unknown>): Promise<ReadbackError> => { try { await p; } catch (e) { return e as ReadbackError; } throw new Error('did not fail'); };

describe('the tool list', () => {
  it('has the six measurement tools, with the bodies tool for the app, each with an object schema and a real description', () => {
    expect(READBACK_TOOLS.map((t) => t.name)).toEqual(['measure', 'clearance', 'interference', 'thickness', 'draft', 'dfm']);
    expect(APP_READBACK_TOOLS.map((t) => t.name)).toEqual(['bodies', 'measure', 'clearance', 'interference', 'thickness', 'draft', 'dfm']);
    for (const t of APP_READBACK_TOOLS) { expect(t.inputSchema.type).toBe('object'); expect(t.inputSchema.additionalProperties).toBe(false); expect(t.description.length).toBeGreaterThan(60); }
  });
});

describe('entities', () => {
  it('a body by name, key, number or case-insensitive name gives its faces; names, points and lists pass through', () => {
    for (const s of ['Base', '@body:F2.C0', 1, 'base']) expect(resolveEntity(s, bodies)).toMatchObject({ entity: { faces: bodies[0].faces }, label: 'Base', kind: 'body' });
    expect(resolveEntity('F2.C1', bodies)).toMatchObject({ entity: 'F2.C1', kind: 'name' });
    expect(resolveEntity([1, 2, 3], bodies)).toMatchObject({ entity: [1, 2, 3], kind: 'point' });
    expect(resolveEntity(['F2.C1', 'Peg'], bodies).entity).toEqual(['F2.C1', { faces: bodies[1].faces }]);
  });
  it('a body number out of range lists the bodies', async () => {
    const e = await fails(Promise.resolve().then(() => resolveEntity(3, bodies)));
    expect(e.code).toBe('no_such_body');
    expect(e.hint).toContain('1: Base, 2: Peg');
  });
});

describe('measure', () => {
  it('reports the distance, the closest points, the offset and the angle for two faces', async () => {
    const r = await run('measure', { a: 'F2.S.e1', b: 'F4.S.e1' });
    expect(r.summary).toBe('F2.S.e1 to F4.S.e1: 15 mm');
    expect(r.data).toMatchObject({ ok: true, distance: 15, pointA: [10, 0, 5], pointB: [25, 0, 5], offset: [15, 0, 0], intersects: false, faceAngle: { angle: 90, parallel: false } });
  });
  it('two bodies are measured as their faces', async () => {
    const h = host();
    const r = await run('measure', { a: 'Base', b: 2 }, h);
    expect((h as unknown as { calls: unknown[][] }).calls[0]).toEqual(['distance', { faces: bodies[0].faces }, { faces: bodies[1].faces }]);
    expect((r.data as { a: string; b: string }).a).toBe('Base');
    expect((r.data as { b: string }).b).toBe('Peg');
    expect((r.data as { faceAngle?: unknown }).faceAngle).toBeUndefined();
  });
  it('touching entities say so', async () => {
    const r = await run('measure', { a: 'Base', b: 'Peg' }, host({ distance: async () => ({ ...dist, distance: 0, intersects: true, intersection: { kind: 'area' }, direction: null }) as never }));
    expect(r.summary).toMatch(/touch or intersect/);
    expect((r.data as { note: string }).note).toMatch(/minimum distance is 0/);
  });
  it('a kernel error is a measure_failed with a hint; a missing solid is no_body', async () => {
    const e = await fails(run('measure', { a: 'F9.C9', b: 'F2.C0' }, host({ distance: async () => { throw new Error('unknown face F9.C9'); } })));
    expect(e).toMatchObject({ code: 'measure_failed' });
    expect(e.message).toContain('unknown face F9.C9');
    expect(e.hint).toMatch(/bodies lists the bodies/);
    expect(await fails(run('measure', { a: 'x', b: 'y' }, host({ distance: async () => { throw new Error('empty result for distance'); } })))).toMatchObject({ code: 'no_body' });
  });
});

describe('clearance', () => {
  it('compares the two bodies of a two-body document and lists the closest face pairs', async () => {
    const r = await run('clearance', {});
    expect(r.data).toMatchObject({ state: 'clear', gap: 15, a: 'Base', b: 'Peg', closePairs: [{ a: 'F2.S.e1', b: 'F4.S.e1', distance: 15, kind: 'gap' }] });
  });
  it('passes or fails against the required clearance with the shortfall', async () => {
    const ok = await run('clearance', { a: 'Base', b: 'Peg', required: 10 });
    expect(ok.data).toMatchObject({ pass: true });
    const bad = await run('clearance', { a: 'Base', b: 'Peg', required: 20 });
    expect(bad.data).toMatchObject({ pass: false });
    expect((bad.data as { verdict: string }).verdict).toMatch(/fail: gap 15 mm is under the required 20 mm \(short by 5 mm\)/);
  });
  it('bodies that meet are contact, never a pass', async () => {
    const r = await run('clearance', { required: 0.2 }, host({ distance: async () => ({ ...dist, distance: 0, intersects: true, intersection: { kind: 'curve' }, direction: null }) as never }));
    expect(r.data).toMatchObject({ state: 'contact', gap: 0, pass: false });
  });
  it('needs a and b when the document has other than two bodies', async () => {
    expect((await fails(run('clearance', {}, host({ bodies: [bodies[0]] })))).code).toBe('need_bodies');
    const three = [...bodies, { name: 'Lid', key: '@body:F6.C0', faces: ['F6.C0'] }];
    const e = await fails(run('clearance', {}, host({ bodies: three })));
    expect(e.code).toBe('ambiguous');
    expect(e.hint).toContain('3: Lid');
    expect((await fails(run('clearance', { a: 'Base' }))).code).toBe('bad_input');
  });
});

describe('interference', () => {
  it('names the bodies of each overlapping pair with the volume and the share of the smaller body', async () => {
    const r = await run('interference', {});
    expect(r.data).toMatchObject({ overlapping: true, pairCount: 1, totalOverlapVolume: 500, pairs: [{ a: 'Base', b: 'Peg', volume: 500, centre: [7, 0, 5], shareOfSmaller: 0.5 }] });
    expect(r.summary).toBe('1 overlapping pair, 500 mm3 in all');
  });
  it('a and b pick pairs; no overlap is said plainly; one body explains the merge rule', async () => {
    expect(((await run('interference', { a: 'Peg' })).data as { pairCount: number }).pairCount).toBe(1);
    expect(((await run('interference', { a: 'Peg', b: 'Base' })).data as { pairCount: number }).pairCount).toBe(1);
    const none = await run('interference', {}, host({ interference: async () => ({ bodies: 2, pairs: [] }) }));
    expect(none.summary).toBe('no interference');
    const one = await run('interference', {}, host({ interference: async () => ({ bodies: 1, pairs: [] }) }));
    expect((one.data as { note: string }).note).toMatch(/newBody: true/);
  });
  it('a pair whose boolean failed is reported as incomplete, not as clear', async () => {
    const r = await run('interference', {}, host({ interference: async () => ({ bodies: 2, pairs: [{ a: 'F2.C0', b: 'F4.C0', error: 'boolean failed' }] }) }));
    expect(r.data).toMatchObject({ overlapping: false, incomplete: expect.stringContaining('1 pair') });
    expect(await fails(run('interference', {}, host({ interference: async () => null })))).toMatchObject({ code: 'no_body' });
  });
});

describe('thickness', () => {
  it('gives the thinnest place with its faces, and the verdict against min', async () => {
    const r = await run('thickness', { min: 2 });
    expect(r.data).toMatchObject({ minThickness: 1.5, where: { face: 'F2.C0', farFace: 'F2.C1' }, required: 2, pass: false, under: [{ thickness: 1.5 }] });
    expect(r.summary).toMatch(/under the required 2 mm/);
    expect(((await run('thickness', { min: 1 })).data as { pass: boolean }).pass).toBe(true);
  });
  it('body limits the places to that body', async () => {
    const r = await run('thickness', { body: 'Peg' });
    expect(r.data).toMatchObject({ scope: 'Peg', minThickness: 8, where: { face: 'F4.C0' } });
    expect((r.data as { thin: unknown[] }).thin).toHaveLength(1);
  });
  it('no measurable wall explains why', async () => {
    const e = await fails(run('thickness', {}, host({ thickness: async () => ({ method: 'ray', samples: 10, noExit: 10, minThickness: null, thin: [] }) as never })));
    expect(e.code).toBe('no_thickness');
    expect(e.hint).toMatch(/open/);
  });
});

describe('draft', () => {
  it('counts the classes, lists the walls under the minimum worst first and the least draft', async () => {
    const r = await run('draft', { pull: '+Z', min: 1 });
    expect(r.data).toMatchObject({ pull: [0, 0, 1], min: 1, pass: false, facesChecked: 4, counts: { ok: 1, vertical: 1, undercut: 1, parting: 1 }, least: { face: 'F4.S.e1', draft: -3 }, violations: [{ face: 'F4.S.e1', draft: -3, class: 'undercut' }, { face: 'F2.S.e1', draft: 0, class: 'vertical' }] });
    expect((r.data as { hint: string }).hint).toMatch(/undercut faces/);
  });
  it('passes the pull direction and the faces of a body to the kernel; the default is +Z and 1 degree', async () => {
    let q: unknown;
    const h = host({ angles: async (x: unknown) => { q = x; return { draft: [], violations: [] } as never; } });
    await run('draft', { pull: '-Y', body: 'Peg' }, h);
    expect(q).toEqual({ draft: { pull: [0, -1, 0], faces: bodies[1].faces, min: 1 } });
    await run('draft', {}, h);
    expect(q).toEqual({ draft: { pull: [0, 0, 1], faces: 'all', min: 1 } });
  });
  it('a zero direction is refused', async () => expect((await fails(run('draft', { pull: [0, 0, 0] }))).code).toBe('bad_input'));
});

describe('dfm', () => {
  it('runs the profile with its own limits, lists the issues with the numbers and the limits in force', async () => {
    const h = host();
    const r = await run('dfm', { process: 'printing', params: { minWall: { min: 2 } }, direction: '+Z' }, h);
    const sent = (h as unknown as { calls: Array<[string, { rules: Array<{ id: string; params: Record<string, unknown> }> }]> }).calls.find((c) => c[0] === 'checkProfile')![1];
    expect(sent.rules.find((x) => x.id === 'minWall')!.params).toEqual({ min: 2 });
    expect(sent.rules.find((x) => x.id === 'overhang')!.params).toEqual({ angle: 45, direction: [0, 0, 1] });
    expect(r.summary).toBe('FDM 3D printing: 1 error, 0 warnings, 0 notes');
    expect(r.data).toMatchObject({ process: 'printing', profile: 'fdm-print', passed: false, errors: 1, issues: [{ rule: 'minWall', faces: ['F2.C0'], value: 0.5, limit: 1.2, unit: 'mm' }], rules: [{ rule: 'minWall', title: 'Minimum wall', passed: false }, { rule: 'overhang', passed: true }] });
  });
  it('rejects unknown rules, parameters and wrong types, naming the valid ones', async () => {
    expect((await fails(run('dfm', { process: 'printing', rules: ['nope'] }))).hint).toContain('minWall, overhang');
    expect((await fails(run('dfm', { process: 'printing', params: { minWall: { depth: 1 } } }))).code).toBe('unknown_param');
    expect((await fails(run('dfm', { process: 'printing', params: { minWall: { min: 'two' } } }))).code).toBe('bad_input');
    expect((await fails(run('dfm', { process: 'cnc' }))).code).toBe('no_profile');
  });
  it('rules runs only those', async () => {
    const h = host();
    await run('dfm', { process: 'printing', rules: ['overhang'] }, h);
    const sent = (h as unknown as { calls: Array<[string, { rules: Array<{ id: string }> }]> }).calls.find((c) => c[0] === 'checkProfile')![1];
    expect(sent.rules.map((x) => x.id)).toEqual(['overhang']);
  });
});

describe('bodies (app)', () => {
  it('lists number, name, volume and the first faces', async () => {
    const r = await run('bodies', { faces: 2 });
    expect(r.data).toMatchObject({ count: 2, bodies: [{ index: 1, name: 'Base', volume: 4000, faceCount: 3, faces: ['F2.C0', 'F2.C1'] }, { index: 2, name: 'Peg' }] });
  });
});
