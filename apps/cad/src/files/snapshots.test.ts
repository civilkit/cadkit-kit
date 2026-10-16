import { describe, expect, it } from 'vitest';
import { createSnapshots, memoryBackend, pruneIds, SNAP_EVERY, SNAP_KEEP, type Snapshot } from './snapshots';

const doc = (n: number, tag = '') => ({ name: 'P', features: Array.from({ length: n }, (_, i) => ({ id: `F${i}${tag}` })) });
let clock = 1_000_000;
const make = () => { const b = memoryBackend(); clock = 1_000_000; return { b, s: createSnapshots(b, { now: () => clock }) }; };

describe('snapshots', () => {
  it('auto snapshots are at most one per 30 s; undo and drop ones are always taken', async () => {
    const { b, s } = make();
    await s.note(doc(3), 'P', 'auto');
    clock += 5000; await s.note(doc(4), 'P', 'auto');
    expect(b.items.length).toBe(1);
    await s.note(doc(4), 'P', 'undo');
    expect(b.items.length).toBe(2);
    clock += SNAP_EVERY; await s.note(doc(5), 'P', 'auto');
    expect(b.items.length).toBe(3);
  });
  it('an empty part and an identical state are not stored', async () => {
    const { b, s } = make();
    await s.note(doc(0), 'P', 'undo'); await s.note(doc(2), 'P', 'undo'); await s.note(doc(2), 'P', 'undo');
    expect(b.items.length).toBe(1);
  });
  it('keeps the newest ten and the richest from the last day, lists newest first', async () => {
    const { b, s } = make();
    await s.note(doc(40), 'P', 'undo');   // the rich one, oldest
    for (let i = 0; i < 14; i++) { clock += 1000; await s.note(doc(2 + i), 'P', 'undo'); }
    expect(b.items.length).toBe(SNAP_KEEP + 1);
    expect(b.items.some((x) => x.features === 40)).toBe(true);
    const l = await s.list();
    expect(l[0].time).toBeGreaterThan(l[1].time);
    clock += 25 * 3600_000; await s.note(doc(3, 'z'), 'P', 'undo');   // a day later the rich one is only old
    expect(b.items.some((x) => x.features === 40)).toBe(false);
  });
  it('pruneIds never drops the newest', () => {
    const l: Snapshot[] = Array.from({ length: 12 }, (_, i) => ({ id: `${i}`, time: i, name: '', features: 1, reason: 'auto', doc: {} }));
    expect(pruneIds(l, 12)).not.toContain('11');
  });
  it('no backend: nothing happens', async () => {
    const s = createSnapshots(null);
    await s.note(doc(3), 'P', 'undo');
    expect(await s.list()).toEqual([]);
  });
});
