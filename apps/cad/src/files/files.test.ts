import { describe, expect, it } from 'vitest';
import { AUTOSAVE_KEY, AUTOSAVE_MAX, createAutosaver, readAutosave, worthRestoring, writeAutosave, clearAutosave } from './autosave';
import { RECENT_MAX, addRecent, dropped, pushRecent, readRecent, type RecentEntry } from './recent';
import { createNameCounter, dropKind, fileNameFor, partNameOf } from './names';
import type { KV } from './storage';

const fakeKV = (limit = Infinity): KV & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => { if (v.length > limit) throw new DOMException('full', 'QuotaExceededError'); data.set(k, v); } };
};
const doc = (n: number) => ({ name: 'P', features: Array.from({ length: n }, (_, i) => ({ id: `F${i}` })) });

describe('autosave storage', () => {
  it('round trips name, doc and time under the versioned key', () => {
    const kv = fakeKV();
    expect(writeAutosave(kv, 'P', doc(2), 5)).toBe('saved');
    expect(kv.data.has('cad.autosave.v1')).toBe(true);
    expect(readAutosave(kv)).toEqual({ name: 'P', doc: doc(2), savedAt: 5 });
    clearAutosave(kv);
    expect(readAutosave(kv)).toBeNull();
  });
  it('skips a document over 2 MB and survives a quota error', () => {
    const kv = fakeKV();
    expect(writeAutosave(kv, 'P', { blob: 'x'.repeat(AUTOSAVE_MAX) })).toBe('tooBig');
    expect(kv.data.size).toBe(0);
    expect(writeAutosave(fakeKV(10), 'P', doc(3))).toBe('quota');
    expect(writeAutosave(null, 'P', doc(1))).toBe('unavailable');
  });
  it('ignores junk and offers only a part with features', () => {
    const kv = fakeKV();
    kv.setItem(AUTOSAVE_KEY, '{nope');
    expect(readAutosave(kv)).toBeNull();
    kv.setItem(AUTOSAVE_KEY, JSON.stringify({ name: 1, doc: 'str', savedAt: 1 }));
    expect(readAutosave(kv)).toBeNull();
    expect(worthRestoring(null)).toBe(false);
    expect(worthRestoring({ name: 'Part1', doc: doc(0), savedAt: 1 })).toBe(false);
    expect(worthRestoring({ name: 'Part1', doc: doc(1), savedAt: 1 })).toBe(true);
  });
});

describe('createAutosaver', () => {
  const manual = () => {
    let f: (() => void) | null = null; let n = 0;
    return { timers: { set: (fn: () => void) => { f = fn; return ++n; }, clear: () => { f = null; } }, fire: () => { const g = f; f = null; g?.(); }, pending: () => f !== null };
  };
  it('debounces to the last schedule, skips unchanged documents and clears', () => {
    const kv = fakeKV(); const m = manual();
    const a = createAutosaver(kv, { timers: m.timers, now: () => 1 });
    a.schedule(() => ({ name: 'P', doc: doc(1) }));
    a.schedule(() => ({ name: 'P', doc: doc(2) }));
    expect(kv.data.size).toBe(0);
    m.fire();
    expect(readAutosave(kv)!.doc).toEqual(doc(2));
    kv.data.clear();
    a.schedule(() => ({ name: 'P', doc: doc(2) }));
    m.fire();
    expect(kv.data.size).toBe(0);                          // same document: nothing rewritten
    a.schedule(() => ({ name: 'P', doc: doc(3) }));
    a.clear();                                              // Save: the pending write is dropped
    expect(m.pending()).toBe(false);
    expect(kv.data.size).toBe(0);
  });
  it('reports each problem once', () => {
    const problems: string[] = []; const m = manual();
    const a = createAutosaver(fakeKV(), { timers: m.timers, onProblem: (r) => problems.push(r) });
    for (let i = 0; i < 3; i++) { a.schedule(() => ({ name: 'P', doc: { blob: 'x'.repeat(AUTOSAVE_MAX + i) } })); m.fire(); }
    expect(problems).toEqual(['tooBig']);
  });
  it('flush writes at once', () => {
    const kv = fakeKV(); const a = createAutosaver(kv, { timers: manual().timers });
    a.flush(() => ({ name: 'P', doc: doc(1) }));
    expect(readAutosave(kv)).not.toBeNull();
  });
});

describe('recent list', () => {
  const e = (id: string, kind: 'sample' | 'file' = 'sample', at = 1, handle?: boolean): RecentEntry => ({ kind, id, name: id, at, ...(handle ? { handle } : {}) });
  it('puts the newest first, moves repeats up and keeps 8', () => {
    let l: RecentEntry[] = [];
    for (let i = 0; i < 10; i++) l = pushRecent(l, e(`s${i}`));
    expect(l.length).toBe(RECENT_MAX);
    expect(l[0].id).toBe('s9');
    l = pushRecent(l, e('s5', 'sample', 99));
    expect(l.map((x) => x.id).slice(0, 2)).toEqual(['s5', 's9']);
    expect(l.filter((x) => x.id === 's5').length).toBe(1);
    // a sample and a file with the same id are different entries
    expect(pushRecent([e('a')], e('a', 'file')).length).toBe(2);
  });
  it('persists through storage and tolerates junk', () => {
    const kv = fakeKV();
    addRecent(kv, e('a')); addRecent(kv, e('b', 'file', 2, true));
    expect(readRecent(kv).map((x) => x.id)).toEqual(['b', 'a']);
    kv.setItem('cad.recent.v1', '[1,{"kind":"x"}]');
    expect(readRecent(kv)).toEqual([]);
  });
  it('lists the entries with handles that were pushed out', () => {
    const before = [e('a', 'file', 1, true), e('b')];
    expect(dropped(before, [e('b')]).map((x) => x.id)).toEqual(['a']);
  });
});

describe('names', () => {
  it('builds a file name with .ckpart and refuses empty ones', () => {
    expect(fileNameFor('Bracket')).toBe('Bracket.ckpart');
    expect(fileNameFor('  Bracket.FWPART ')).toBe('Bracket.ckpart');
    expect(fileNameFor('a/b:c')).toBe('a_b_c.ckpart');
    expect(fileNameFor('...')).toBeNull();
    expect(fileNameFor('   ')).toBeNull();
    expect(partNameOf('Bracket.ckpart')).toBe('Bracket');
  });
  it('counts new parts Part1, Part2 ... and skips names already seen', () => {
    const c = createNameCounter();
    expect([c.next(), c.next()]).toEqual(['Part1', 'Part2']);
    c.seen('Part7'); c.seen('Other'); c.seen('Part3');
    expect(c.next()).toBe('Part8');
  });
  it('classifies dropped files', () => {
    expect(['a.ckpart', 'a.JSON', 'x.step', 'x.STP', 'm.skp', 'N.SKP', 'a.skp.bak', 'd.dxf', 'm.stl', 'p.png', 'noext', 'a.FCStd'].map(dropKind)).toEqual(['part', 'part', 'step', 'step', 'skp', 'skp', 'unknown', 'dxf', 'stl', 'unknown', 'unknown', 'fcstd']);
  });
});
