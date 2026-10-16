import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/preact';
import { revealFor, useRevealInTree } from './useRevealInTree';

const rows = ['F4', 'F9', 'F62'];
describe('revealFor', () => {
  it('uses the last picked name', () => expect(revealFor(['F4.C0', 'F62.S.e3'], rows, new Set())).toEqual({ id: 'F62', also: [] }));
  it('has nothing for an empty pick or an unknown owner', () => {
    expect(revealFor([], rows, new Set())).toBeNull();
    expect(revealFor(['F70.C0'], rows, new Set())).toBeNull();
  });
  it('maps an assembly name to its component row', () => expect(revealFor(['F2.S.e1@F9.1'], rows, new Set(['F9']))).toEqual({ id: 'F9', also: [] }));
});

describe('useRevealInTree', () => {
  it('asks again on every new pick, and forces on show()', () => {
    const { result, rerender } = renderHook(({ sel }) => useRevealInTree(sel, rows, new Set()), { initialProps: { sel: [] as string[] } });
    expect(result.current.reveal).toBeNull();
    rerender({ sel: ['F62.S.e3'] });
    const first = result.current.reveal!;
    expect(first).toMatchObject({ id: 'F62', force: false });
    rerender({ sel: ['F4.S.h1@F9.2'] });
    expect(result.current.reveal).toMatchObject({ id: 'F4', also: ['F9'], force: false });
    expect(result.current.reveal!.n).toBeGreaterThan(first.n);
    const n = result.current.reveal!.n;
    act(() => result.current.show());
    expect(result.current.reveal).toMatchObject({ force: true });
    expect(result.current.reveal!.n).toBeGreaterThan(n);
  });
  it('drops the marker when the pick is cleared', () => {
    const { result, rerender } = renderHook(({ sel }) => useRevealInTree(sel, rows, new Set()), { initialProps: { sel: ['F62.C0'] as string[] } });
    expect(result.current.reveal).not.toBeNull();
    rerender({ sel: [] });
    expect(result.current.reveal).toBeNull();
  });
});
