import { describe, expect, it, vi } from 'vitest';
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
    const r = await makeAppHandler(deps())('state', {}) as Record<string, unknown>;
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
