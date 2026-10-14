import { describe, expect, it } from 'vitest';
import { BODY } from '@kit/store';
import type { Command } from '@kit/ui';
import './i18n';
import { gestureHint, menuItems, selectionKind } from './menuModel';

const cmd = (id: string, label: string, over: Partial<Command> = {}): Command => ({ id, label, tab: 'Home', group: 'Features', run: () => {}, ...over });
const registry = [
  cmd('add-fillet', 'Fillet', { keys: 'Shift+F', enabled: () => true }), cmd('add-chamfer', 'Chamfer', { keys: 'Shift+B', enabled: () => false }),
  cmd('sketch-on-face', 'Sketch on selected face', { keys: 'S' }), cmd('add-hole', 'Hole', { keys: 'Shift+H' }), cmd('add-shell', 'Shell', { keys: 'Shift+S' }),
  cmd('add-lpattern', 'Linear pattern'), cmd('add-cpattern', 'Circular pattern'), cmd('select-body', 'Select body'), cmd('fit', 'Fit'),
  cmd('sketch-new-front', 'F'), cmd('sketch-new-top', 'T'), cmd('sketch-new-right', 'R'), cmd('add-extrude', 'Extrude'), cmd('add-cut', 'Cut'),
];

describe('selectionKind', () => {
  it('names what is selected', () => {
    expect(selectionKind([], 'face')).toBe('none');
    expect(selectionKind(['F2.C1'], 'face')).toBe('face');
    expect(selectionKind(['F2.C1|F2.S.e1#0'], 'edge')).toBe('edge');
    expect(selectionKind(['v:1,2,3'], 'vertex')).toBe('corner');
    expect(selectionKind([BODY], 'face')).toBe('body');
  });
});

describe('menuItems', () => {
  it('an edge offers fillet and chamfer with their keys and enabled state', () => {
    const m = menuItems('edge', registry, false);
    expect(m.map((x) => x.id)).toEqual(['add-fillet', 'add-chamfer']);
    expect(m[0]).toMatchObject({ label: 'Fillet', keys: 'Shift+F', enabled: true });
    expect(m[1].enabled).toBe(false);
  });
  it('a face offers sketch, hole, shell and the patterns, separated', () => {
    const m = menuItems('face', registry, false);
    expect(m.map((x) => (x.separator ? '-' : x.id))).toEqual(['sketch-on-face', 'add-hole', 'add-shell', '-', 'add-lpattern', 'add-cpattern']);
  });
  it('a body lists Move body, disabled with the reason while the kernel cannot', () => {
    const off = menuItems('body', registry, false).find((x) => x.id === 'move-body')!;
    expect(off.enabled).toBe(false);
    expect(off.reason).toMatch(/kernel/);
    expect(menuItems('body', registry, true).find((x) => x.id === 'move-body')!.enabled).toBe(true);
  });
  it('rows for commands that are not registered are left out, and no separator dangles', () => {
    const m = menuItems('none', registry.filter((c) => !['select-body', 'fit'].includes(c.id)), false);
    expect(m.at(-1)!.separator).toBeFalsy();
    expect(m[0].separator).toBeFalsy();
  });
  it('gesture hints', () => {
    expect(gestureHint('round-new')).toMatch(/fillet/i);
    expect(gestureHint('placement')).toBeNull();
    expect(gestureHint(null)).toBeNull();
  });
});
