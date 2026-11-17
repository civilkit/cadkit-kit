import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeError } from '@kit/agent-link';
import { makeAppHandler, toBase64, type AppDeps } from './appHandlers';

const doc = { name: 'Plate', features: [{ id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude', name: 'Pad' }, { id: 'F3', type: 'fillet', suppressed: true }], variables: [{ name: 'w', expr: '80' }] };
function deps(over: Partial<AppDeps> = {}): AppDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    document: () => doc, selection: () => ['F2.C1'], facts: () => ({ faces: 6, triangles: 12, rebuildMs: 4 }),
    status: () => [{ id: 'F3', ok: false, code: 'fillet_failed', hint: 'radius too big' }, { id: 'F2', ok: true }],
    hasSolid: () => true, allowEdit: () => false,
    render: async () => new Uint8Array([104, 101, 108, 108, 111]),
    runScript: async (c) => { calls.push('run:' + c); return { ok: true, errors: [], created: ['F4'], featureCount: 4 }; },
    undo: async () => { calls.push('undo'); }, redo: async () => { calls.push('redo'); },
    ...over,
  };
}
const fails = async (p: Promise<unknown>, code: string) => { const e = await p.then(() => null, (x) => x); expect(e).toBeInstanceOf(BridgeError); expect((e as BridgeError).code).toBe(code); };

describe('app handler: what is exposed', () => {
  it('state is a summary of the open document with errors and the selection, and no document body', async () => {
    const r = await makeAppHandler(deps())('state', { detail: 'summary' }) as Record<string, unknown>;   // the earlier shape, now asked for by name: the default is the compact one
    expect(r).toMatchObject({ open: true, name: 'Plate', featureCount: 3, selection: ['F2.C1'], hasSolid: true, faces: 6, triangles: 12 });
    expect(r.features).toEqual([
      { id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude', name: 'Pad' },
      { id: 'F3', type: 'fillet', suppressed: true, error: { code: 'fillet_failed', hint: 'radius too big' } },
    ]);
    expect(r.variables).toEqual([{ name: 'w', expr: '80' }]);
    expect(r.document).toBeUndefined();
  });
  it('state with detail full adds the document; with no document it says so', async () => {
    expect((await makeAppHandler(deps())('state', { detail: 'full' }) as { document: unknown }).document).toBe(doc);
    expect(await makeAppHandler(deps({ document: () => null }))('state', {})).toMatchObject({ open: false });
  });
  it('screenshot returns a base64 PNG; with no solid it says so', async () => {
    const r = await makeAppHandler(deps())('screenshot', { view: 'front', size: 5000 }) as { png: string; view: string; size: number };
    expect(r.png).toBe('aGVsbG8=');
    expect(r).toMatchObject({ view: 'front', size: 1536 });          // the size is clamped
    await fails(makeAppHandler(deps({ hasSolid: () => false }))('screenshot', {}), 'no_body');
    await fails(makeAppHandler(deps({ render: async () => null }))('screenshot', {}), 'snapshot_failed');
  });
  it('toBase64 handles more than one chunk', () => {
    const big = new Uint8Array(100_000).fill(65);
    expect(atob(toBase64(big))).toHaveLength(100_000);
  });
});

describe('app handler: the edit gate', () => {
  it('refuses run_script, undo and redo while allowEdit is false, and runs none of them', async () => {
    const d = deps();
    const h = makeAppHandler(d);
    await fails(h('run_script', { code: "part('X')" }), 'edit_not_allowed');
    await fails(h('undo', {}), 'edit_not_allowed');
    await fails(h('redo', {}), 'edit_not_allowed');
    expect(d.calls).toEqual([]);
  });
  it('reads the permission at each call: allowed, then withdrawn', async () => {
    let allow = true;
    const d = deps({ allowEdit: () => allow });
    const h = makeAppHandler(d);
    expect(await h('run_script', { code: "part('X')" })).toMatchObject({ ok: true, created: ['F4'] });
    await h('undo', {}); await h('redo', {});
    allow = false;
    await fails(h('run_script', { code: 'again' }), 'edit_not_allowed');
    expect(d.calls).toEqual(["run:part('X')", 'undo', 'redo']);
  });
  it('checks its input and needs an open document; script errors come back in the report', async () => {
    const h = makeAppHandler(deps({ allowEdit: () => true }));
    await fails(h('run_script', { code: '' }), 'bad_input');
    await fails(h('run_script', { code: 5 }), 'bad_input');
    await fails(makeAppHandler(deps({ allowEdit: () => true, document: () => null }))('run_script', { code: 'x' }), 'no_document');
    const run = vi.fn(async () => ({ ok: false, errors: [{ line: 2, message: 'nope' }], created: [], featureCount: 3 }));
    expect(await makeAppHandler(deps({ allowEdit: () => true, runScript: run }))('run_script', { code: 'x' })).toMatchObject({ ok: false, errors: [{ line: 2, message: 'nope' }] });
  });
  it('knows no other operation', async () => {
    await fails(makeAppHandler(deps())('delete_everything' as never, {}), 'unknown_op');
  });
});

describe('app handler: the measurement tools', () => {
  const dist = { distance: 15, pointA: [10, 0, 5], pointB: [25, 0, 5], a: { kind: 'face', id: 'F2.S.e1' }, b: { kind: 'face', id: 'F4.S.e1' }, intersects: false, direction: [1, 0, 0] };
  const host = (over: Record<string, unknown> = {}) => ({
    kernel: { distance: vi.fn(async () => dist), angles: vi.fn(async () => ({ between: { angle: 90, normalAngle: 90 } })), ...over },
    interference: async () => ({ bodies: 2, pairs: [] }),
    bodies: async () => [{ name: 'Base', key: '@body:F2.C0', faces: ['F2.C0', 'F2.S.e1'], volume: 4000 }, { name: 'Peg', key: '@body:F4.C0', faces: ['F4.C0', 'F4.S.e1'], volume: 1000 }],
  });
  const withHost = (over: Record<string, unknown> = {}, d: Partial<AppDeps> = {}) => makeAppHandler(deps({ readback: async () => host(over) as never, ...d }));

  it('read without the edit permission, and never call the document-changing parts of the app', async () => {
    const d = deps({ allowEdit: () => false, readback: async () => host() as never });
    const h = makeAppHandler(d);
    const r = await h('measure', { a: 'Base', b: 'Peg' }) as Record<string, unknown>;
    expect(r).toMatchObject({ distance: 15, a: 'Base', b: 'Peg', summary: 'Base to Peg: 15 mm' });
    const b = await h('bodies', {}) as { count: number; bodies: Array<{ name: string }> };
    expect(b.count).toBe(2);
    expect(await h('interference', {})).toMatchObject({ overlapping: false, bodies: 2 });
    expect(d.calls).toEqual([]);
  });
  it('a tool error keeps its code and hint; no document, no solid and no kernel say so', async () => {
    const h = withHost({ distance: async () => { throw new Error('unknown face F9'); } });
    const e = await h('measure', { a: 'F9', b: 'Peg' }).then(() => null, (x) => x);
    expect(e).toBeInstanceOf(BridgeError);
    expect(e).toMatchObject({ code: 'measure_failed' });
    expect((e as BridgeError).hint).toMatch(/bodies lists the bodies/);
    await fails(withHost({}, { document: () => null })('measure', { a: 1, b: 2 }), 'no_document');
    await fails(withHost({}, { hasSolid: () => false })('thickness', {}), 'no_body');
    await fails(makeAppHandler(deps())('dfm', { process: 'cnc' }), 'no_kernel');
    await fails(makeAppHandler(deps({ readback: async () => null }))('draft', {}), 'no_kernel');
  });
});

describe('app handler: sections', () => {
  const loop = { kind: 'outer', area: 12.5, edges: [1, 2, 3, 4], pts: [[0, 0], [1, 0]] };
  const host = (section = vi.fn(async () => ({ frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, area: 12.5, bbox2d: [0, 0, 1, 1], loops: [loop] }))) => ({ section, deps: deps({ readback: async () => ({ kernel: { section } as never, interference: async () => null, bodies: async () => [] }) }) });

  it('section reads the exact loops at a plane, with the origin defaulting to the world origin, and needs no edit permission', async () => {
    const h = host();
    const r = await makeAppHandler(h.deps)('section', { plane: { normal: [0, 0, 1] } }) as Record<string, unknown>;
    expect(h.section).toHaveBeenCalledWith({ origin: [0, 0, 0], normal: [0, 0, 1] });
    expect(r).toMatchObject({ area: 12.5, openChains: 0, loops: [{ kind: 'outer', area: 12.5, edges: 4 }] });
    expect(JSON.stringify(r)).not.toContain('pts');
    const full = await makeAppHandler(h.deps)('section', { plane: { origin: [1, 2, 3], normal: [1, 0, 0] }, detail: true }) as { loops: Array<{ pts?: unknown }> };
    expect(full.loops[0].pts).toBeDefined();
  });
  it('section refuses a bad plane, no solid and no kernel with a code', async () => {
    const h = host();
    await fails(makeAppHandler(h.deps)('section', { plane: { normal: [0, 0, 0] } }), 'bad_input');
    await fails(makeAppHandler(h.deps)('section', { plane: { normal: [0, 1] } }), 'bad_input');
    await fails(makeAppHandler(deps({ hasSolid: () => false }))('section', { plane: { normal: [0, 0, 1] } }), 'no_body');
    await fails(makeAppHandler(deps())('section', { plane: { normal: [0, 0, 1] } }), 'no_kernel');
  });
  it('a screenshot with a section passes the plane to the renderer', async () => {
    const render = vi.fn(async () => new Uint8Array([1]));
    await makeAppHandler(deps({ render }))('screenshot', { view: 'front', section: { normal: [0, 0, 1] } });
    expect(render).toHaveBeenCalledWith('front', 768, { origin: [0, 0, 0], normal: [0, 0, 1] });
    await makeAppHandler(deps({ render }))('screenshot', {});
    expect(render).toHaveBeenLastCalledWith('iso', 768, undefined);
  });
});

describe('app handler: plugins', () => {
  const plugins = () => [{ id: 'acme.row', name: 'Row', version: '1.0.0', builtin: false, generators: [{ plugin: 'acme.row', generator: 'row', title: 'Row', parameters: { type: 'object' } }] }];
  it('plugin_list is a read: no permission needed, nothing changes', async () => {
    const r = await makeAppHandler(deps({ plugins }))('plugin_list', {}) as { plugins: Array<{ id: string }> };
    expect(r.plugins.map((p) => p.id)).toEqual(['acme.row']);
    await fails(makeAppHandler(deps())('plugin_list', {}), 'unsupported');
  });
  it('plugin_run needs the edit permission, valid arguments and an open document, and passes the parameters through', async () => {
    const runPlugin = vi.fn(async () => ({ ok: true, group: 'Row', created: 4 }));
    const asks = (over: Partial<AppDeps> = {}) => makeAppHandler(deps({ runPlugin, ...over }));
    await fails(asks()('plugin_run', { plugin: 'acme.row', generator: 'row' }), 'edit_not_allowed');
    await fails(asks({ allowEdit: () => true })('plugin_run', { plugin: 3 }), 'bad_input');
    await fails(asks({ allowEdit: () => true })('plugin_run', { plugin: 'a', generator: 'b', params: [1] }), 'bad_input');
    await fails(asks({ allowEdit: () => true, document: () => null })('plugin_run', { plugin: 'a', generator: 'b' }), 'no_document');
    expect(runPlugin).not.toHaveBeenCalled();
    expect(await asks({ allowEdit: () => true })('plugin_run', { plugin: 'acme.row', generator: 'row', params: { n: 3 } })).toMatchObject({ ok: true, group: 'Row' });
    expect(runPlugin).toHaveBeenCalledWith('acme.row', 'row', { n: 3 });
  });
  it('a failed run is a bridge error that names the bad parameters', async () => {
    const runPlugin = async () => ({ ok: false, message: 'n must be at least 1', issues: [{ param: 'n', message: 'must be at least 1' }] });
    const e = await makeAppHandler(deps({ runPlugin, allowEdit: () => true }))('plugin_run', { plugin: 'a', generator: 'b' }).then(() => null, (x) => x) as BridgeError;
    expect(e.code).toBe('plugin_failed');
    expect(e.hint).toContain('n must be at least 1');
  });
});

describe('app handler: open_asset', () => {
  const bytes = new TextEncoder().encode('{"features":[]}');
  const sha = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b as unknown as ArrayBuffer))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const base = (over: Partial<AppDeps> = {}) => deps({
    allowEdit: () => true, fetchAsset: async () => bytes,
    openAsset: async (a) => { opened.push(a.name); return { documentId: 'd9', revision: 2, counts: { features: 0, faces: 0 }, errorCount: 0 }; }, ...over,
  });
  let opened: string[];
  beforeEach(() => { opened = []; });
  it('is an edit: refused without the permission, the file is neither fetched nor opened', async () => {
    let fetched = 0;
    await fails(makeAppHandler(base({ allowEdit: () => false, fetchAsset: async () => { fetched++; return bytes; } }))('open_asset', { handle: 'h', name: 'a.ckpart', kind: 'part', bytes: bytes.length, sha256: await sha(bytes) }), 'edit_not_allowed');
    expect(fetched).toBe(0); expect(opened).toEqual([]);
  });
  it('fetches by handle, checks size and checksum, opens, and answers with ids and counts only', async () => {
    const r = await makeAppHandler(base())('open_asset', { handle: 'h', name: 'a.ckpart', kind: 'part', bytes: bytes.length, sha256: await sha(bytes) }) as Record<string, unknown>;
    expect(r).toMatchObject({ documentId: 'd9', revision: 2, counts: { features: 0, faces: 0 }, name: 'a.ckpart', kind: 'part' });
    expect(JSON.stringify(r)).not.toContain('features":[]');
    expect(opened).toEqual(['a.ckpart']);
  });
  it('refuses a mismatch, bad arguments and an opener that fails, and an app without the capability', async () => {
    const h = makeAppHandler(base());
    await fails(h('open_asset', { handle: 'h', name: 'a.ckpart', kind: 'part', bytes: 3, sha256: await sha(bytes) }), 'asset_mismatch');
    await fails(h('open_asset', { handle: 'h', name: 'a.ckpart', kind: 'part', bytes: bytes.length, sha256: 'f'.repeat(64) }), 'asset_mismatch');
    await fails(h('open_asset', { handle: 'h', name: 'a.exe', kind: 'exe', bytes: 1, sha256: 'x' }), 'bad_input');
    await fails(makeAppHandler(base({ openAsset: async () => { throw new Error('corrupt'); } }))('open_asset', { handle: 'h', name: 'a.ckpart', kind: 'part', bytes: bytes.length, sha256: await sha(bytes) }), 'open_failed');
    await fails(makeAppHandler(deps({ allowEdit: () => true }))('open_asset', { handle: 'h', name: 'a.ckpart', kind: 'part', bytes: 1, sha256: 'x' }), 'unsupported');
    expect(opened).toEqual([]);
  });
});

describe('app handler: edit transactions', () => {
  let features: Array<Record<string, unknown>>, revision: number;
  const edits: Array<{ expected: number; ops: unknown[]; reason: string }> = [];
  const mk = (over: Partial<AppDeps> = {}) => deps({
    allowEdit: () => true, status: () => [], document: () => ({ name: 'P', features }), revision: () => revision, documentId: () => 'dE',
    edit: async (expected, ops, reason) => {
      edits.push({ expected, ops, reason });
      if (expected !== revision) return { ok: false, stale: true, revision };
      features = features.map((f) => (f.id === 'F2' ? { ...f, depth: 14 } : f)).concat(ops.some((o) => o.op === 'add') ? [{ id: 'F4', type: 'extrude' }] : []);
      revision++;
      return { ok: true, warnings: 1 };
    }, ...over,
  });
  beforeEach(() => { features = [{ id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude', depth: 10 }, { id: 'F3', type: 'fillet' }]; revision = 5; edits.length = 0; });

  it('is an edit: refused without the permission, nothing sent', async () => {
    await fails(makeAppHandler(mk({ allowEdit: () => false }))('edit', { expectedRevision: 5, ops: [{ op: 'setParam', id: 'F2', path: 'depth', value: 14 }] }), 'edit_not_allowed');
    expect(edits).toEqual([]);
  });
  it('applies the ops as one transaction and answers with the revision, the changed and added ids and a validation summary', async () => {
    const r = await makeAppHandler(mk())('edit', { expectedRevision: 5, reason: 'longer pad', ops: [{ op: 'setParam', id: 'F2', path: 'depth', value: 14 }, { op: 'add', feature: { type: 'extrude' } }] });
    expect(r).toEqual({ revision: 6, documentId: 'dE', changedIds: ['F2', 'F4'], addedIds: ['F4'], removedIds: [], validation: { errorCount: 0, errors: [], warnings: 1 } });
    expect(edits).toHaveLength(1);                                                     // ONE call to the kernel side: one history step
    expect(edits[0]).toMatchObject({ expected: 5, reason: 'longer pad', ops: [{ op: 'set', id: 'F2', path: 'depth', value: 14 }, { op: 'add' }] });
  });
  it('refuses a stale revision with a hint, before and inside the controller, and changes nothing', async () => {
    const h = makeAppHandler(mk());
    await fails(h('edit', { expectedRevision: 4, ops: [{ op: 'remove', id: 'F3' }] }), 'stale_revision');
    expect(edits).toEqual([]);
    // the revision moved between the handler's check and the edit (a user edit in the queue): the controller side refuses
    const racing = makeAppHandler(mk({ edit: async () => { revision++; return { ok: false, stale: true, revision }; } }));
    const e = await racing('edit', { expectedRevision: 5, ops: [{ op: 'remove', id: 'F3' }] }).then(() => null, (x) => x);
    expect(e).toBeInstanceOf(BridgeError); expect(e.code).toBe('stale_revision'); expect(e.hint).toMatch(/sinceRevision/);
    await fails(h('edit', { ops: [{ op: 'remove', id: 'F3' }] }), 'bad_input');
  });
  it('a bad op refuses all of them before the kernel, a rejected rebuild says nothing changed, and dryRun only checks', async () => {
    const h = makeAppHandler(mk());
    await fails(h('edit', { expectedRevision: 5, ops: [{ op: 'setParam', id: 'F2', path: 'depth', value: 1 }, { op: 'remove', id: 'NOPE' }] }), 'bad_op');
    expect(edits).toEqual([]);
    const rejected = await makeAppHandler(mk({ edit: async () => ({ ok: false, errors: [{ feature: 'F3', code: 'fillet_failed' }] }) }))('edit', { expectedRevision: 5, ops: [{ op: 'remove', id: 'F2' }] }).then(() => null, (x) => x);
    expect(rejected.code).toBe('edit_rejected'); expect(rejected.message).toBe('F3: fillet_failed; nothing was changed');
    expect(await h('edit', { expectedRevision: 5, dryRun: true, ops: [{ op: 'remove', id: 'F2' }] })).toEqual({ ok: true, dryRun: true, revision: 5, documentId: 'dE', validated: 1 });
    expect(edits).toEqual([]); expect(revision).toBe(5);
  });
  it('without an editor, or a document, it says so', async () => {
    await fails(makeAppHandler(deps({ allowEdit: () => true }))('edit', { expectedRevision: 0, ops: [{ op: 'remove', id: 'F1' }] }), 'unsupported');
    await fails(makeAppHandler(mk({ document: () => null }))('edit', { expectedRevision: 5, ops: [{ op: 'remove', id: 'F1' }] }), 'no_document');
  });
});
