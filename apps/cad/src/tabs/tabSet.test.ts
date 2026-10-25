import { describe, expect, it } from 'vitest';
import { MAX_TABS, TabSet } from './tabSet';

const mk = (s: TabSet<{ id: number }>) => ({ id: s.nextId() });
const ids = (s: TabSet<{ id: number }>) => s.tabs.map((t) => t.id);

describe('TabSet', () => {
  it('a new tab goes in after the active one and becomes active', () => {
    const s = new TabSet<{ id: number }>();
    const a = mk(s), b = mk(s), c = mk(s);
    s.add(a); s.add(b);
    s.activate(a.id);
    s.add(c);
    expect(ids(s)).toEqual([a.id, c.id, b.id]);
    expect(s.activeId).toBe(c.id);
  });
  it('closing the active tab activates its right neighbour, else its left one; closing another keeps the active tab', () => {
    const s = new TabSet<{ id: number }>();
    const a = mk(s), b = mk(s), c = mk(s);
    [a, b, c].forEach((t) => s.add(t));
    s.activate(b.id);
    expect(s.remove(b.id)?.id).toBe(c.id);
    expect(s.remove(c.id)?.id).toBe(a.id);
    s.add(b);
    s.activate(a.id);
    s.remove(b.id);
    expect(s.activeId).toBe(a.id);
    expect(s.remove(a.id)).toBeNull();
    expect(s.activeId).toBe(-1);
  });
  it('stops at the limit and never reuses an id', () => {
    const s = new TabSet<{ id: number }>();
    for (let i = 0; i < MAX_TABS; i++) expect(s.add(mk(s))).toBe(true);
    expect(s.add(mk(s))).toBe(false);
    expect(s.count).toBe(MAX_TABS);
    const gone = s.tabs[0].id;
    s.remove(gone);
    expect(s.nextId()).toBeGreaterThan(gone);
  });
  it('moves a tab to a position', () => {
    const s = new TabSet<{ id: number }>();
    const [a, b, c] = [mk(s), mk(s), mk(s)];
    [a, b, c].forEach((t) => s.add(t));
    s.move(c.id, 0);
    expect(ids(s)).toEqual([c.id, a.id, b.id]);
    s.move(c.id, 99);
    expect(ids(s)).toEqual([a.id, b.id, c.id]);
  });
});
