import { describe, expect, it } from 'vitest';
import { AUTOSAVE_KEY, BEAT_LIVE, SLOTS_MAX_AGE, beatKey, createAutosaver, dropBeat, listSlots, pickRestorable, pruneSlots, readAutosave, slotKey, touchBeat, writeAutosave } from './autosave';
import type { KV } from './storage';

/** A fake localStorage shared by several "tabs", with enumeration. */
const fakeKV = (): KV & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, removeItem: (k) => { data.delete(k); }, setItem: (k, v) => { data.set(k, v); },
    get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null };
};
const doc = (n: number) => ({ name: 'Part1', features: Array.from({ length: n }, (_, i) => ({ id: `F${i}` })) });
const H = 3600_000;
const immediate = { set: (f: () => void) => { f(); return 0; }, clear: () => {} };
const tab = (kv: KV, id: string, now: () => number) => createAutosaver(kv, { key: slotKey(id), timers: immediate, now });

describe('per-tab autosave slots', () => {
  it('two tabs writing do not overwrite each other', () => {
    const kv = fakeKV();
    tab(kv, 'A', () => 1000).schedule(() => ({ name: 'Part1', doc: doc(2) }));
    tab(kv, 'B', () => 2000).schedule(() => ({ name: 'Part1', doc: doc(5) }));
    expect(readAutosave(kv, slotKey('A'))!.doc).toEqual(doc(2));
    expect(readAutosave(kv, slotKey('B'))!.doc).toEqual(doc(5));
    expect(kv.data.has(AUTOSAVE_KEY)).toBe(false);
  });
  it('saving in one tab clears only its own slot', () => {
    const kv = fakeKV();
    const a = tab(kv, 'A', () => 1); tab(kv, 'B', () => 2).schedule(() => ({ name: 'P', doc: doc(1) }));
    a.schedule(() => ({ name: 'P', doc: doc(3) })); a.clear();
    expect(readAutosave(kv, slotKey('A'))).toBeNull();
    expect(readAutosave(kv, slotKey('B'))).not.toBeNull();
  });
});

describe('which session is offered', () => {
  const now = 10 * H;
  it('the newest slot not owned by an open tab, with its real age', () => {
    const kv = fakeKV();
    writeAutosave(kv, 'Old', doc(1), now - 4 * H, undefined, slotKey('old'));
    writeAutosave(kv, 'Newer', doc(2), now - 1 * H, undefined, slotKey('gone'));
    const r = pickRestorable(kv, 'me', now)!;
    expect(r.name).toBe('Newer');
    expect(now - r.savedAt).toBe(1 * H);
    expect(r.key).toBe(slotKey('gone'));
  });
  it('a slot of a live tab is not offered, and is once the tab is gone', () => {
    const kv = fakeKV();
    writeAutosave(kv, 'Old', doc(1), now - 4 * H, undefined, slotKey('old'));
    writeAutosave(kv, 'Live', doc(4), now - 1000, undefined, slotKey('live'));
    touchBeat(kv, 'live', now - 2000);
    expect(pickRestorable(kv, 'me', now)!.name).toBe('Old');
    expect(pickRestorable(kv, 'me', now + BEAT_LIVE + 1)!.name).toBe('Live');   // heartbeat went stale (tab crashed)
    touchBeat(kv, 'live', now); dropBeat(kv, 'live');                          // tab closed: pagehide
    expect(pickRestorable(kv, 'me', now)!.name).toBe('Live');
  });
  it('never offers this tab its own slot, nor a blank part, but reads the old shared slot', () => {
    const kv = fakeKV();
    writeAutosave(kv, 'Mine', doc(3), now, undefined, slotKey('me'));
    writeAutosave(kv, 'Blank', doc(0), now - 1, undefined, slotKey('x'));
    expect(pickRestorable(kv, 'me', now)).toBeNull();
    writeAutosave(kv, 'Legacy', doc(2), now - 5 * H);
    expect(pickRestorable(kv, 'me', now)!.name).toBe('Legacy');
  });
  it('without enumeration nothing is offered from the slots', () => {
    const kv = fakeKV(); writeAutosave(kv, 'P', doc(2), 1, undefined, slotKey('a'));
    const plain: KV = { getItem: kv.getItem, setItem: kv.setItem, removeItem: kv.removeItem };
    expect(listSlots(plain)).toEqual([]);
  });
});

describe('pruning', () => {
  const now = 100 * 24 * H;
  it('keeps the newest 5 and anything under 7 days, never a live or own slot', () => {
    const kv = fakeKV();
    // 8 old slots (10..17 days), 2 recent (1 and 2 days), one old live, one old own
    for (let i = 0; i < 8; i++) writeAutosave(kv, `old${i}`, doc(1), now - (10 + i) * 24 * H, undefined, slotKey(`o${i}`));
    writeAutosave(kv, 'r1', doc(1), now - 24 * H, undefined, slotKey('r1'));
    writeAutosave(kv, 'r2', doc(1), now - 48 * H, undefined, slotKey('r2'));
    writeAutosave(kv, 'live', doc(1), now - 30 * 24 * H, undefined, slotKey('live')); touchBeat(kv, 'live', now);
    writeAutosave(kv, 'own', doc(1), now - 40 * 24 * H, undefined, slotKey('own'));
    const removed = pruneSlots(kv, { ownKey: slotKey('own'), now });
    const left = listSlots(kv, now).map((s) => s.id).sort();
    // newest 5 = r1, r2, o0..o2 ; plus live and own
    expect(left).toEqual(['live', 'o0', 'o1', 'o2', 'own', 'r1', 'r2']);
    expect(removed).toBe(5);
    expect(SLOTS_MAX_AGE).toBe(7 * 24 * H);
  });
  it('removes stale heartbeat keys but not fresh ones', () => {
    const kv = fakeKV();
    touchBeat(kv, 'dead', now - 10 * H); touchBeat(kv, 'alive', now);
    pruneSlots(kv, { now });
    expect(kv.data.has(beatKey('dead'))).toBe(false);
    expect(kv.data.has(beatKey('alive'))).toBe(true);
  });
  it('a full storage prunes slots of gone tabs and retries the write', () => {
    const data = new Map<string, string>(); let full = true;
    const kv: KV = { getItem: (k) => data.get(k) ?? null, removeItem: (k) => { data.delete(k); full = false; },
      setItem: (k, v) => { if (full && !data.has(k)) throw new Error('quota'); data.set(k, v); }, get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null };
    full = false; writeAutosave(kv, 'gone', doc(1), now - 20 * 24 * H, undefined, slotKey('gone'));
    for (let i = 0; i < 5; i++) writeAutosave(kv, 'k', doc(1), now - (i + 1) * 24 * H * 8, undefined, slotKey(`k${i}`));
    full = true;
    expect(writeAutosave(kv, 'me', doc(2), now, undefined, slotKey('me'))).toBe('saved');
  });
});
