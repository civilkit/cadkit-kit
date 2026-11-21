import '../i18n';
import { describe, expect, it, vi } from 'vitest';
import { hasIcon } from '@kit/ui';
import { buildCommands, matchShortcut, type Actions } from '../commands';
import type { InspectActions } from './inspectCommands';
import { RIBBON_LAYOUT } from '../toolbarModel';

const inspect = (o: Partial<InspectActions> = {}): InspectActions => ({
  toggleMeasure: vi.fn(), isMeasuring: () => false, massProps: vi.fn(), interference: vi.fn(), intersection: vi.fn(), toggleSection: vi.fn(), isSectioned: () => false, hasSolid: () => true, ...o,
});
const build = (i: InspectActions) => buildCommands(new Proxy({ inspect: i, analysis: null, layer: () => false, mode: () => 'face', hasDocument: () => true } as unknown as Actions, { get: (t, k) => (k in t ? (t as never)[k] : () => {}) }));
const key = (k: string) => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false });

describe('Evaluate commands', () => {
  it('are on the Evaluate tab with labels and icons', () => {
    const cmds = build(inspect()).filter((c) => c.tab === 'Evaluate');
    expect(cmds.map((c) => c.id)).toEqual(['measure', 'mass-props', 'interference', 'check-intersection', 'section-view']);
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
    by('mass-props').run(); by('interference').run(); by('check-intersection').run(); by('section-view').run();
    expect(i.massProps).toHaveBeenCalled(); expect(i.interference).toHaveBeenCalled(); expect(i.intersection).toHaveBeenCalled(); expect(i.toggleSection).toHaveBeenCalled();
    expect(by('measure').pressed!()).toBe(true); expect(by('section-view').pressed!()).toBe(true);
    expect(by('measure').enabled!()).toBe(false);
  });
});

describe('Measure enablement', () => {
  const by = (i: InspectActions, id: string) => build(i).find((c) => c.id === id)!.enabled!();
  it('a part of reference meshes only can measure; the tools that need a solid stay off', () => {
    const i = inspect({ hasSolid: () => false, hasRefMesh: () => true });
    expect(by(i, 'measure')).toBe(true);
    for (const id of ['mass-props', 'interference', 'check-intersection', 'section-view']) expect(by(i, id), id).toBe(false);
  });
  it('nothing at all: off; a solid only: as before, everything on', () => {
    const none = inspect({ hasSolid: () => false, hasRefMesh: () => false });
    for (const id of ['measure', 'mass-props', 'interference', 'check-intersection', 'section-view']) expect(by(none, id), id).toBe(false);
    expect(by(inspect({ hasSolid: () => false }), 'measure')).toBe(false);   // a host that does not say
    const solid = inspect({ hasSolid: () => true, hasRefMesh: () => false });
    for (const id of ['measure', 'mass-props', 'interference', 'check-intersection', 'section-view']) expect(by(solid, id), id).toBe(true);
  });
});

describe('Evaluate ribbon', () => {
  it('Mass properties is its own button in the Measure group, not inside a dropdown, and its tooltip name is the full one', () => {
    const entries = RIBBON_LAYOUT.Evaluate.find((g) => g.id === 'Measure')!.entries;
    expect(entries).toEqual(['measure', 'mass-props', 'interference', 'check-intersection', 'section-view']);
    expect(build(inspect()).find((c) => c.id === 'mass-props')!.label).toBe('Mass properties');
  });
});
