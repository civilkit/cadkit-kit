import '../i18n';
import { describe, expect, it, vi } from 'vitest';
import { hasIcon } from '@kit/ui';
import { buildCommands, matchShortcut, type Actions } from '../commands';
import type { InspectActions } from './inspectCommands';

const inspect = (o: Partial<InspectActions> = {}): InspectActions => ({
  toggleMeasure: vi.fn(), isMeasuring: () => false, massProps: vi.fn(), interference: vi.fn(), toggleSection: vi.fn(), isSectioned: () => false, hasSolid: () => true, ...o,
});
const build = (i: InspectActions) => buildCommands(new Proxy({ inspect: i, analysis: null, layer: () => false, mode: () => 'face', hasDocument: () => true } as unknown as Actions, { get: (t, k) => (k in t ? (t as never)[k] : () => {}) }));
const key = (k: string) => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false });

describe('Evaluate commands', () => {
  it('are on the Evaluate tab with labels and icons', () => {
    const cmds = build(inspect()).filter((c) => c.tab === 'Evaluate');
    expect(cmds.map((c) => c.id)).toEqual(['measure', 'mass-props', 'interference', 'section-view']);
    for (const c of cmds) { expect(c.label).not.toMatch(/^cmd\./); expect(hasIcon(c.id)).toBe(true); }
  });
  it('M runs Measure; no key clash with the other commands', () => {
    const i = inspect();
    const cmds = build(i);
    matchShortcut(cmds, key('m'))!.run();
    expect(i.toggleMeasure).toHaveBeenCalled();
    const keys = cmds.filter((c) => c.keys).map((c) => c.keys!.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('mass, interference and section call their actions; pressed state and enabled follow the actions', () => {
    const i = inspect({ isMeasuring: () => true, isSectioned: () => true, hasSolid: () => false });
    const cmds = build(i);
    const by = (id: string) => cmds.find((c) => c.id === id)!;
    by('mass-props').run(); by('interference').run(); by('section-view').run();
    expect(i.massProps).toHaveBeenCalled(); expect(i.interference).toHaveBeenCalled(); expect(i.toggleSection).toHaveBeenCalled();
    expect(by('measure').pressed!()).toBe(true); expect(by('section-view').pressed!()).toBe(true);
    expect(by('measure').enabled!()).toBe(false);
  });
});
