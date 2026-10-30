import { describe, expect, it } from 'vitest';
import { knurlEditOps } from '@kit/script';
import { DEFAULT_KNURL, knurlCosmetic, knurlOpts, knurlOps, type KnurlParams } from './knurl';
import { knurlDependents, knurlOwner, knurlReplaceOps, paramsFromBand, paramsFromCosmetic, replaceCosmetic } from './knurlEdit';

type F = Record<string, unknown> & { id: string; type: string };
const target = (over: Partial<NonNullable<KnurlParams['target']>> = {}) => ({ axis: 'z' as const, center: [1, 2] as [number, number], radius: 10, from: 0, to: 12, ...over });
const P = (o: Partial<KnurlParams> = {}): KnurlParams => ({ ...DEFAULT_KNURL, cosmetic: false, count: 24, depth: 0.6, target: target(), ...o });

/** A minimal stand-in for the session's op semantics: add (with index), remove (refused when referenced, unless cascade), replace. */
function apply(features: F[], ops: Array<Record<string, unknown>>): F[] {
  const out = [...features];
  for (const o of ops) {
    if (o.op === 'add') { const f = o.feature as F; if (typeof o.index === 'number') out.splice(o.index, 0, f); else out.push(f); }
    else if (o.op === 'remove') {
      // the session checks a batch against the document as it was before the batch, and a non-cascading remove of a referenced feature is refused there
      const refs = features.filter((f) => f.id !== o.id && JSON.stringify(f).includes(`"${String(o.id)}"`));
      expect(o.cascade === true || refs.length === 0, `remove ${String(o.id)} is refused unless it cascades`).toBe(true);
      const i = out.findIndex((f) => f.id === o.id);
      expect(i, `remove ${String(o.id)} exists`).toBeGreaterThanOrEqual(0);
      const gone = new Set<string>([String(o.id)]);
      if (o.cascade) for (let grew = true; grew;) { grew = false; for (const f of out) if (!gone.has(f.id) && [...gone].some((g) => JSON.stringify(f).includes(`"${g}"`))) { gone.add(f.id); grew = true; } }
      for (let k = out.length - 1; k >= 0; k--) if (gone.has(out[k].id)) out.splice(k, 1);
    } else throw new Error('unexpected op ' + String(o.op));
  }
  return out;
}
const base: F[] = [
  { id: 'F1', type: 'sketch' },
  { id: 'F2', type: 'extrude', sketch: 'F1', op: 'add' },
];
const addOps = (p: KnurlParams, features: F[] = base) => knurlOps({ features }, p) as unknown as Array<Record<string, unknown>>;
const docWith = (p: KnurlParams, tail: F[] = []): F[] => [...apply(base, addOps(p)), ...tail];

describe('faceted band: params -> feature -> params', () => {
  it.each([
    ['diamond', P({ pattern: 'diamond', helixAngle: 40 })],
    ['pyramid', P({ pattern: 'pyramid' })],
    ['pyramid with a band, angle and ring pitch', P({ pattern: 'pyramid', range: [2, 10], angle: 80, ringPitch: 4 })],
    ['diamond on a y axis', P({ pattern: 'diamond', target: target({ axis: 'y', center: [3, -4] }) })],
  ])('%s', (_n, p) => {
    const ops = knurlEditOps(knurlOpts(p)!, 7) as unknown as Array<{ feature: F }>;
    expect(ops).toHaveLength(1);
    expect(ops[0].feature.type).toBe('knurlBand');
    const back = paramsFromBand(ops[0].feature)!;
    expect(back).not.toBeNull();
    expect(back.method).toBe('faceted');
    expect(back.cosmetic).toBe(false);
    expect(knurlOpts(back)).toEqual(knurlOpts(p));   // the same helper options, so the same feature again
    if (!p.range) expect(back).toMatchObject({ pattern: p.pattern, count: p.count, depth: p.depth, target: p.target });
  });
  it('a band that cannot be mapped stays on the generic editor', () => {
    expect(paramsFromBand({ type: 'knurlBand', id: 'F3', axis: 'w', center: [0, 0], radius: 5, from: 0, to: 4, pattern: 'diamond', count: 12, depth: 0.4 })).toBeNull();
    expect(paramsFromBand({ type: 'knurlBand', id: 'F3', axis: 'z', center: [0, 0], radius: 5, from: 0, to: 4, pattern: 'straight', count: 12, depth: 0.4 })).toBeNull();
    expect(paramsFromBand({ type: 'knurlBand', id: 'F3', axis: 'z', center: [0, 0], radius: 5, from: 0, to: 4, pattern: 'diamond', depth: 0.4 })).toBeNull();
    expect(paramsFromBand({ type: 'extrude', id: 'F3' })).toBeNull();
  });
  it('a band given by pitch maps to the count', () => {
    const p = paramsFromBand({ type: 'knurlBand', id: 'F3', axis: 'z', center: [0, 0], radius: 5, from: 0, to: 4, pattern: 'diamond', pitch: (2 * Math.PI * 5) / 20, depth: 0.4 });
    expect(p?.count).toBe(20);
  });
});

describe('cosmetic record: params -> record -> params', () => {
  it.each([
    ['straight', P({ cosmetic: true })],
    ['diamond', P({ cosmetic: true, pattern: 'diamond', helixAngle: 33 })],
    ['pyramid with a ring pitch', P({ cosmetic: true, pattern: 'pyramid', ringPitch: 3.5, range: [1, 9] })],
    ['round grooves with a width', P({ cosmetic: true, profile: 'round', width: 1.7 })],
    ['a wide V', P({ cosmetic: true, angle: 70 })],
  ])('%s', (_n, p) => {
    const rec = knurlCosmetic(p);
    const back = paramsFromCosmetic(rec);
    expect(back.cosmetic).toBe(true);
    expect(knurlCosmetic(back)).toEqual(rec);
    expect(back).toMatchObject({ pattern: p.pattern, profile: p.profile, count: p.count, depth: p.depth });
  });
});

describe('boolean and straight knurls are tagged and found again', () => {
  it.each([
    ['straight', P()],
    ['round straight', P({ profile: 'round' })],
    ['pyramid, cut grooves', P({ pattern: 'pyramid', method: 'boolean', count: 12, depth: 0.4 })],
    ['diamond, cut grooves', P({ pattern: 'diamond', method: 'boolean', count: 8, depth: 0.4, helixAngle: 60 })],
  ])('%s: params -> features -> params', (_n, p) => {
    const ops = addOps(p);
    const feats = ops.map((o) => o.feature as F);
    const tagged = feats.filter((f) => 'knurl' in f);
    expect(tagged).toHaveLength(1);   // one marker, on the first feature
    expect(feats[0]).toBe(tagged[0]);
    const doc = docWith(p);
    for (const f of feats) {
      const owner = knurlOwner(doc, f.id)!;
      expect(owner, f.id).not.toBeNull();
      expect(owner.ids).toEqual(feats.map((x) => x.id));
      expect(knurlOpts(owner.params)).toEqual(knurlOpts(p));
      expect(owner.params.cosmetic).toBe(false);
    }
  });
  it('the marker survives a JSON round trip (what the document file and the kernel keep)', () => {
    const doc = JSON.parse(JSON.stringify(docWith(P()))) as F[];
    expect(knurlOwner(doc, 'F3')?.params.count).toBe(24);
  });
  it('knurls without the marker are not guessed', () => {
    expect(knurlOwner(base, 'F1')).toBeNull();
    expect(knurlOwner(base, 'F2')).toBeNull();
    const untagged = addOps(P()).map((o) => { const f = { ...(o.feature as F) }; delete f.knurl; return f; });
    expect(knurlOwner([...base, ...untagged], 'F3')).toBeNull();
  });
  it('a marked group with a member gone is not offered either', () => {
    const doc = docWith(P());
    expect(knurlOwner(doc.filter((f) => f.id !== 'F4'), 'F3')).toBeNull();
  });
  it('a faceted band is found by its own id; other features are not', () => {
    const band = knurlEditOps(knurlOpts(P({ pattern: 'diamond' }))!, 3) as unknown as Array<{ feature: F }>;
    const doc = [...base, band[0].feature];
    expect(knurlOwner(doc, 'F3')).toMatchObject({ kind: 'band', ids: ['F3'] });
    expect(knurlOwner(doc, 'F2')).toBeNull();
  });
});

describe('dependents', () => {
  it('lists later features that use the knurl by id or by a face of it', () => {
    const doc = docWith(P(), [{ id: 'F5', type: 'extrude', sketch: 'F1' }, { id: 'F6', type: 'fillet', edges: ['F4.S.c1'] }, { id: 'F7', type: 'pattern', seeds: ['F4'] }]);
    expect(knurlDependents(doc, ['F3', 'F4'])).toEqual(['F6', 'F7']);
  });
  it('is empty when nothing later uses it (the base solid is not a dependent)', () => {
    expect(knurlDependents(docWith(P(), [{ id: 'F5', type: 'extrude', sketch: 'F1' }]), ['F3', 'F4'])).toEqual([]);
  });
  it('a feature id is not matched as a prefix of a longer one', () => {
    const doc = docWith(P(), [{ id: 'F5', type: 'fillet', edges: ['F40.S.c1', 'F41'] }]);
    expect(knurlDependents(doc, ['F3', 'F4'])).toEqual([]);
  });
});

describe('replace in place', () => {
  const tail: F[] = [{ id: 'F5', type: 'extrude', sketch: 'F1', op: 'add' }, { id: 'F6', type: 'sketch' }];
  it('a straight knurl is replaced at the same position, later features stay after it', () => {
    const doc = docWith(P(), tail);
    const owner = knurlOwner(doc, 'F4')!;
    const next = P({ pattern: 'pyramid', method: 'boolean', count: 12, depth: 0.4 });
    const out = apply(doc, knurlReplaceOps({ features: doc }, next, owner) as never);
    expect(out.slice(0, 2).map((f) => f.id)).toEqual(['F1', 'F2']);
    expect(out.slice(-2).map((f) => f.id)).toEqual(['F5', 'F6']);
    const mid = out.slice(2, -2);
    expect(mid.length).toBeGreaterThanOrEqual(2);
    expect(mid.some((f) => ['F3', 'F4'].includes(f.id))).toBe(false);   // new ids
    const again = knurlOwner(out, mid[0].id)!;
    expect(again.params.pattern).toBe('pyramid');
    expect(again.ids).toEqual(mid.map((f) => f.id));
    expect(again.params.count).toBe(12);
  });
  it('a group in the middle of other features keeps its index', () => {
    const pre: F[] = [...base, { id: 'F3', type: 'sketch' }];
    const doc = [...apply(pre, addOps(P(), pre)), ...tail];
    const owner = knurlOwner(doc, doc[3].id)!;
    const out = apply(doc, knurlReplaceOps({ features: doc }, P({ count: 30 }), owner) as never);
    expect(out.map((f) => f.type).slice(0, 4)).toEqual(['sketch', 'extrude', 'sketch', 'sketch']);
    expect(out[3].knurl).toBeTruthy();
    expect((out[3].knurl as { params: { count: number } }).params.count).toBe(30);
  });
  it('a faceted band becomes a band again, in place', () => {
    const band = (knurlEditOps(knurlOpts(P({ pattern: 'diamond' }))!, 3) as unknown as Array<{ feature: F }>)[0].feature;
    const doc = [...base, band, ...tail.map((f, i) => ({ ...f, id: 'G' + i }))];
    const owner = knurlOwner(doc, 'F3')!;
    const ops = knurlReplaceOps({ features: doc }, owner.params, owner) as unknown as Array<Record<string, unknown>>;
    expect(ops[0]).toMatchObject({ op: 'remove', id: 'F3' });
    const out = apply(doc, ops);
    expect(out.map((f) => f.type)).toEqual(['sketch', 'extrude', 'knurlBand', 'extrude', 'sketch']);
  });
  it('is one batch: removes first (last member first), then adds at consecutive indices', () => {
    const doc = docWith(P(), tail);
    const ops = knurlReplaceOps({ features: doc }, P({ count: 20 }), knurlOwner(doc, 'F3')!) as unknown as Array<Record<string, unknown>>;
    expect(ops.map((o) => o.op)).toEqual(['remove', 'remove', 'add', 'add']);
    expect(ops.slice(0, 2).every((o) => o.cascade === true)).toBe(true);
    expect(ops.slice(0, 2).map((o) => o.id)).toEqual(['F4', 'F3']);
    expect(ops.slice(2).map((o) => o.index)).toEqual([2, 3]);
  });
  it('the cosmetic record is replaced at its index', () => {
    const a = knurlCosmetic(P({ cosmetic: true })), b = knurlCosmetic(P({ cosmetic: true, count: 40 })), c = knurlCosmetic(P({ cosmetic: true, count: 12 }));
    const out = replaceCosmetic([a, b, c], 1, knurlCosmetic(P({ cosmetic: true, count: 50 })));
    expect(out!.map((r) => r.count)).toEqual([24, 50, 12]);
    expect(replaceCosmetic([a], 5, c)).toBeNull();
  });
});
