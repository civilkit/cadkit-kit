import { describe, expect, it } from 'vitest';
import { BridgeError } from '@kit/agent-link';
import { makeAppHandler, type AppDeps } from './appHandlers';
import { RevisionTracker, compactState, type StateSource } from './stateQuery';

const feats = (n: number): Array<Record<string, unknown>> => Array.from({ length: n }, (_, i) => (i % 2 === 0
  ? { id: `F${i + 1}`, type: 'sketch', entities: Array.from({ length: 30 }, (_, k) => ({ k, x: k * 1.5 })) }
  : { id: `F${i + 1}`, type: 'extrude', name: i % 4 === 1 ? `Pad ${i}` : undefined, depth: 10 + i, suppressed: i === 5 }));
const src = (over: Partial<StateSource> = {}): StateSource => ({ documentId: 'd1', revision: 7, name: 'Plate', features: feats(40), bad: new Map([['F8', { code: 'fillet_failed', hint: 'radius too big' }]]), variableCount: 2, selection: [], hasSolid: true, faces: 12, bounds: { min: [0, 0, 0], max: [10.12345, 20, 30] }, ...over });
const cs = (input = {}, s = src(), t = new RevisionTracker()) => compactState(s, input, t) as { features: Array<Record<string, unknown>>; totalCount: number; returnedCount: number; nextCursor?: string; delta?: any; bounds?: number[]; revision: number; documentId: string };
const fails = (go: () => unknown, code: string) => { try { go(); expect.unreachable(); } catch (e) { expect(e).toBeInstanceOf(BridgeError); expect((e as BridgeError).code).toBe(code); } };

describe('compact state', () => {
  it('is ids, types, names and status with the revision, units and compact bounds, and counts what it returns', () => {
    const r = cs({ limit: 5 });
    expect(r).toMatchObject({ open: true, documentId: 'd1', revision: 7, units: 'mm', totalCount: 40, returnedCount: 5, hasSolid: true, bounds: [0, 0, 0, 10.123, 20, 30], variableCount: 2 });
    expect(r.features[0]).toEqual({ id: 'F1', type: 'sketch' });                       // no status: ok is not said
    expect(r.features[1]).toEqual({ id: 'F2', type: 'extrude', name: 'Pad 1' });
    expect(cs({ ids: ['F8'] }).features[0]).toEqual({ id: 'F8', type: 'extrude', status: 'error' });
    expect(cs({ ids: ['F6'] }).features[0]).toMatchObject({ status: 'suppressed' });
    expect((r as { documentFeatureCount?: number }).documentFeatureCount).toBeUndefined();
    expect(cs({ query: 'pad' })).toMatchObject({ documentFeatureCount: 40 });
    expect(JSON.stringify(r)).not.toContain('"entities"');          // no params, no blobs by default
  });
  it('pages without dropping anything: the cursor walks the whole list once and ends', () => {
    const s = src(), t = new RevisionTracker();
    const seen: string[] = [];
    let cursor: string | undefined, pages = 0;
    do { const r = cs({ limit: 15, ...(cursor ? { cursor } : {}) }, s, t); seen.push(...r.features.map((f) => String(f.id))); cursor = r.nextCursor; pages++; expect(r.totalCount).toBe(40); } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(s.features.map((f) => f.id));
  });
  it('a cursor from another revision or document is refused, not paged over a changed list', () => {
    const c = cs({ limit: 5 }).nextCursor!;
    fails(() => cs({ cursor: c }, src({ revision: 8 })), 'stale_cursor');
    fails(() => cs({ cursor: c }, src({ documentId: 'd2' })), 'stale_cursor');
    fails(() => cs({ cursor: 'garbage' }), 'bad_cursor');
  });
  it('filters by ids, query (id, type, name) and types, and says how many matched', () => {
    expect(cs({ ids: ['F3', 'F4', 'nope'] }).features.map((f) => f.id)).toEqual(['F3', 'F4']);
    expect(cs({ query: 'pad 5' }).features.map((f) => f.id)).toEqual(['F6']);
    const ext = cs({ types: ['extrude'], limit: 3 });
    expect(ext).toMatchObject({ totalCount: 20, returnedCount: 3 }); expect(ext.nextCursor).toBeTruthy();
    expect(cs({ query: 'zzz' })).toMatchObject({ totalCount: 0, returnedCount: 0, features: [] });
  });
  it('fields choose the columns; status shows error, suppressed and ok; params leave blobs out unless asked', () => {
    const r = cs({ ids: ['F1', 'F6', 'F8'], fields: ['status', 'error', 'suppressed', 'params'] });
    expect(r.features[0]).toEqual({ id: 'F1', params: { entities: { blob: expect.any(Number) } } });
    expect(r.features[1]).toMatchObject({ id: 'F6', status: 'suppressed', suppressed: true, params: { depth: 15 } });
    expect(r.features[2]).toMatchObject({ id: 'F8', status: 'error', error: { code: 'fillet_failed', hint: 'radius too big' } });
    const withBlobs = cs({ ids: ['F1'], fields: ['params'], includeBlobs: true });
    expect((withBlobs.features[0].params as { entities: unknown[] }).entities).toHaveLength(30);
    fails(() => cs({ fields: ['colour'] }), 'bad_input');
  });
  it('is much smaller than the earlier summary for the same document', () => {
    const compact = JSON.stringify(cs({ limit: 500 }), null, 1).length;
    const legacy = JSON.stringify({ features: feats(40).map((f) => ({ id: f.id, type: f.type, ...(f.name ? { name: f.name } : {}), ...(f.suppressed ? { suppressed: true } : {}) })) }, null, 1).length;
    expect(compact).toBeLessThan(legacy * 1.6);   // never worse by much even with every row, and the default page is 50 rows
  });
});

describe('revision deltas', () => {
  it('say what was added, changed and removed since a revision the app saw, and nothing when nothing changed', () => {
    const t = new RevisionTracker();
    const a = src({ revision: 7 });
    t.observe(a);
    const b = src({ revision: 8, features: [...feats(40).filter((f) => f.id !== 'F2').map((f) => (f.id === 'F4' ? { ...f, depth: 99 } : f)), { id: 'F41', type: 'extrude' }] });
    expect(compactState(b, { sinceRevision: 7 }, t)).toMatchObject({ delta: { available: true, added: ['F41'], changed: ['F4'], removed: ['F2'] }, totalCount: 2, returnedCount: 2 });
    expect((compactState(b, { sinceRevision: 7 }, t) as { features: Array<{ id: string }> }).features.map((f) => f.id)).toEqual(['F4', 'F41']);
    t.observe(b);
    expect(compactState(b, { sinceRevision: 8 }, t)).toMatchObject({ delta: { available: true, added: [], changed: [], removed: [] }, totalCount: 0, returnedCount: 0 });
  });
  it('a change of status alone counts as a change', () => {
    const t = new RevisionTracker();
    t.observe(src({ revision: 1, bad: new Map() }));
    const r = compactState(src({ revision: 2 }), { sinceRevision: 1 }, t) as { delta: { changed: string[] } };
    expect(r.delta.changed).toEqual(['F8']);
  });
  it('an unknown revision (never seen, too old, from another document, from the future) says so and returns the whole list', () => {
    const t = new RevisionTracker();
    t.observe(src({ revision: 7 }));
    const r = compactState(src({ revision: 9 }), { sinceRevision: 3 }, t) as { delta: { available: boolean; reason: string }; totalCount: number };
    expect(r.delta.available).toBe(false); expect(r.delta.reason).toMatch(/no longer/); expect(r.totalCount).toBe(40);
    expect((compactState(src({ revision: 9 }), { sinceRevision: 99 }, t) as { delta: { reason: string } }).delta.reason).toMatch(/newer/);
    t.observe(src({ documentId: 'd2', revision: 1 }));                       // another document: the old snapshots are gone
    expect((compactState(src({ documentId: 'd2', revision: 2 }), { sinceRevision: 7 }, t) as { delta: { available: boolean } }).delta.available).toBe(false);
  });
  it('keeps only the last revisions', () => {
    const t = new RevisionTracker();
    for (let r = 1; r <= 40; r++) t.observe(src({ revision: r }));
    expect(t.delta(src({ revision: 40 }), 1).available).toBe(false);
    expect(t.delta(src({ revision: 40 }), 39).available).toBe(true);
  });
});

describe('the handler: revision, edits and the default shape', () => {
  const doc = { name: 'Plate', features: feats(6), variables: [] };
  let revision = 1, current = doc;
  const deps = (): AppDeps => ({
    document: () => current, selection: () => [], facts: () => ({ faces: 6, triangles: 12, rebuildMs: 1 }), status: () => [], hasSolid: () => true, allowEdit: () => true,
    render: async () => null, undo: async () => {}, redo: async () => {},
    runScript: async () => { revision++; current = { ...current, features: [...current.features, { id: 'F7', type: 'extrude', depth: 5 }] }; return { ok: true, errors: [], created: ['F7'], featureCount: 7 }; },
    revision: () => revision, documentId: () => 'dX', bounds: () => ({ min: [0, 0, 0], max: [1, 2, 3] }),
  });
  it('the default is compact, the earlier shapes are one switch away, and a script run is visible to sinceRevision', async () => {
    const h = makeAppHandler(deps());
    const first = await h('state', {}) as { revision: number; features: unknown[] };
    expect(first).toMatchObject({ documentId: 'dX', revision: 1, totalCount: 6, bounds: [0, 0, 0, 1, 2, 3] });
    expect(await h('state', { detail: 'summary' })).toMatchObject({ featureCount: 6, revision: 1, documentId: 'dX' });
    await h('run_script', { code: 'x' });
    const delta = await h('state', { sinceRevision: 1 }) as { revision: number; delta: { added: string[]; changed: string[]; removed: string[] }; features: Array<{ id: string }> };
    expect(delta.revision).toBe(2);
    expect(delta.delta).toMatchObject({ available: true, added: ['F7'], changed: [], removed: [] });
    expect(delta.features.map((f) => f.id)).toEqual(['F7']);
  });
  it('a revision the app never saw can still be asked for: the edit itself records the state before it', async () => {
    revision = 1; current = doc;
    const h = makeAppHandler(deps());
    await h('run_script', { code: 'x' });          // no state read before it
    expect(await h('state', { sinceRevision: 1 })).toMatchObject({ delta: { available: true, added: ['F7'] } });
  });
});
