import { describe, it, expect } from 'vitest';
import { createStore } from './index';

describe('store', () => {
  it('selects, toggles and extends the selection', () => {
    const s = createStore();
    s.select(['F2.C1']);
    s.select(['F2.C0'], true);
    expect(s.selection.value).toEqual(['F2.C1', 'F2.C0']);
    s.toggle('F2.C1');
    expect(s.selection.value).toEqual(['F2.C0']);
  });
  it('drops names that no longer exist and says so', () => {
    const s = createStore();
    s.select(['F2.C1', 'F2.C0']);
    const dropped = s.dropMissing(new Set(['F2.C0']));
    expect(dropped).toEqual(['F2.C1']);
    expect(s.selection.value).toEqual(['F2.C0']);
    expect(s.notices.value.at(-1)?.text).toMatch(/F2\.C1/);
  });
});