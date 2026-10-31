import { describe, expect, it } from 'vitest';
import { runsInPlace } from './scriptTarget';

const base = { activeTabId: 2, lastRunTabId: null, scriptPartName: 'PET bottle' };

describe('where a script Run builds', () => {
  it('a part this panel made is rebuilt in place, even when the script renames it', () => {
    expect(runsInPlace({ ...base, lastRunTabId: 2, docName: 'PET bottle' })).toBe(true);
    expect(runsInPlace({ ...base, lastRunTabId: 2, docName: 'Old name', scriptPartName: 'New name' })).toBe(true);
  });
  it('another tab, or nothing run yet, does not count as the same part', () => {
    expect(runsInPlace({ ...base, lastRunTabId: 1, docName: 'PET bottle' })).toBe(false);
    expect(runsInPlace({ ...base, docName: 'PET bottle' })).toBe(false);
  });
  it('the open document own script with the same part name is rebuilt in place; a different name opens a new tab', () => {
    expect(runsInPlace({ ...base, docScript: 'part()', docName: 'PET bottle' })).toBe(true);
    expect(runsInPlace({ ...base, docScript: 'part()', docName: 'Motor' })).toBe(false);
  });
  it('a hand-made part of the same name (no script of its own) is never replaced', () => {
    expect(runsInPlace({ ...base, docName: 'PET bottle' })).toBe(false);
  });
});
