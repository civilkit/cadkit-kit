import { describe, it, expect } from 'vitest';
import { componentAppearances, componentKey, LOOK_VERSION, sanitizeLook, DEFAULT_LOOK, withAppearance, appearanceOf, effectiveAppearance, hideSelection, NOTHING_HIDDEN, createLookStore, anyHidden, bodyLook } from './look';
import type { LookActions } from './lookCommands';
import { buildCommands, matchShortcut, type Actions } from './commands';

describe('look state', () => {
  it('sanitises garbage to the defaults', () => {
    expect(sanitizeLook(null)).toEqual(DEFAULT_LOOK);
    expect(sanitizeLook({ style: 'x', ghostOpacity: 'a', light: 3, background: [], appearances: 5 })).toEqual(DEFAULT_LOOK);
  });
  it('round-trips through JSON', () => {
    const l = withAppearance({ ...DEFAULT_LOOK, style: 'ghost', ghostOpacity: 0.6, light: 'flat', background: 'gradient' }, 'bracket', { color: '#d0463b', material: 'plastic' });
    expect(sanitizeLook(JSON.parse(JSON.stringify(l)))).toEqual(l);
  });
  it('appearance is per part name, and the default is not stored', () => {
    let l = withAppearance(DEFAULT_LOOK, 'a', { color: '#e8730c' });
    expect(appearanceOf(l, 'a').color).toBe('#e8730c');
    expect(appearanceOf(l, 'b').color).toBe('#c3ccd8');
    l = withAppearance(l, 'a', { color: '#c3ccd8' });
    expect(l.appearances).toEqual({});
    expect(bodyLook(DEFAULT_LOOK, 'a').style).toBe('shadedEdges');
  });
});

describe('material colour', () => {
  it('shows the material colour unless the user picked one in Display > Appearance, or the toggle is off', () => {
    expect(effectiveAppearance(DEFAULT_LOOK, 'a', '#c8774a').color).toBe('#c8774a');
    expect(effectiveAppearance(DEFAULT_LOOK, 'a', '#c8774a', false).color).toBe('#c3ccd8');
    expect(effectiveAppearance(DEFAULT_LOOK, 'a', null).color).toBe('#c3ccd8');
    const picked = withAppearance(DEFAULT_LOOK, 'a', { color: '#d0463b' });
    expect(effectiveAppearance(picked, 'a', '#c8774a').color).toBe('#d0463b');
    expect(effectiveAppearance(picked, 'b', '#c8774a').color).toBe('#c8774a');
    expect(effectiveAppearance(withAppearance(DEFAULT_LOOK, 'a', { material: 'brushed' }), 'a', '#c8774a')).toMatchObject({ color: '#c8774a', material: 'brushed' });
  });
});

describe('hiding', () => {
  it('face selection hides the body', () => {
    expect(hideSelection(NOTHING_HIDDEN, { names: ['f1'] })).toEqual({ body: true, ids: [] });
  });
  it('a selected sketch or plane feature is hidden by id, a fillet is not', () => {
    expect(hideSelection(NOTHING_HIDDEN, { names: [], featureId: 's1', featureType: 'sketch' }).ids).toEqual(['s1']);
    expect(hideSelection(NOTHING_HIDDEN, { names: [], featureId: 'p1', featureType: 'plane' }).ids).toEqual(['p1']);
    expect(hideSelection(NOTHING_HIDDEN, { names: [], featureId: 'x', featureType: 'fillet' })).toBe(NOTHING_HIDDEN);
    expect(hideSelection(NOTHING_HIDDEN, { names: [] })).toBe(NOTHING_HIDDEN);
  });
  it('show all clears it', () => {
    const s = createLookStore();
    s.hide({ names: ['f'] }); s.hide({ names: [], featureId: 's', featureType: 'sketch' });
    expect(anyHidden(s.hidden.value)).toBe(true);
    s.showAll();
    expect(anyHidden(s.hidden.value)).toBe(false);
  });
});

describe('style commands and keys', () => {
  const s = createLookStore();
  const look: LookActions = {
    style: () => s.look.value.style, setStyle: (style) => s.set({ style }), light: () => s.look.value.light, setLight: (light) => s.set({ light }),
    background: () => s.look.value.background, setBackground: (background) => s.set({ background }),
    hideSelection: () => s.hide({ names: ['f'] }), canHide: () => true, showAll: () => s.showAll(), anyHidden: () => anyHidden(s.hidden.value),
  };
  const cmds = buildCommands({ look, hasDocument: () => true, layer: () => true } as unknown as Actions);
  const ev = (key: string, code: string, alt = false) => ({ key, code, shiftKey: false, ctrlKey: false, metaKey: false, altKey: alt });
  it('runs the style state machine', () => {
    for (const [id, style] of [['style-wireframe', 'wireframe'], ['style-ghost', 'ghost'], ['style-shaded', 'shaded']] as const) {
      cmds.find((c) => c.id === id)!.run();
      expect(s.look.value.style).toBe(style);
      expect(cmds.find((c) => c.id === id)!.pressed!()).toBe(true);
    }
  });
  it('H hides, Alt+H (even when the OS turns it into another character) shows all', () => {
    expect(matchShortcut(cmds, ev('h', 'KeyH'))?.id).toBe('hide-selection');
    expect(matchShortcut(cmds, ev('Ó', 'KeyH', true))?.id).toBe('show-all');
    expect(matchShortcut(cmds, ev('2', 'Digit2', true))?.id).toBe('style-shadedEdges');
    expect(matchShortcut(cmds, { ...ev('H', 'KeyH'), shiftKey: true })?.id).not.toBe('hide-selection');   // Shift+H is Hole
  });
});

describe('hide with surface bodies', () => {
  const owners: Record<string, string> = { 'F5.S.sp': 'F5', 'F5.S.e1|F5.S.e2#0': 'F5', 'F8.S.q1': 'F8' };
  const surfaceOf = (n: string) => owners[n] ?? null;
  it('a selected sheet face hides that surface body, not the solid', () => {
    expect(hideSelection(NOTHING_HIDDEN, { names: ['F5.S.sp'], surfaceOf })).toEqual({ body: false, ids: ['F5'] });
    expect(hideSelection(NOTHING_HIDDEN, { names: ['F5.S.e1|F5.S.e2#0'], surfaceOf })).toEqual({ body: false, ids: ['F5'] });
  });
  it('faces of the solid and of two sheets hide all three', () => {
    expect(hideSelection(NOTHING_HIDDEN, { names: ['F2.C1', 'F5.S.sp', 'F8.S.q1'], surfaceOf })).toEqual({ body: true, ids: ['F5', 'F8'] });
  });
  it('does not list a body twice', () => {
    const once = hideSelection(NOTHING_HIDDEN, { names: ['F5.S.sp'], surfaceOf });
    expect(hideSelection(once, { names: ['F5.S.sp'], surfaceOf })).toBe(once);
  });
  it('a corner of a part with no solid hides nothing', () => {
    expect(hideSelection(NOTHING_HIDDEN, { names: ['v:1,2,3'], surfaceOf, solid: false })).toBe(NOTHING_HIDDEN);
  });
  it('a surface feature selected in the tree hides its body', () => {
    expect(hideSelection(NOTHING_HIDDEN, { names: [], featureId: 'F5', featureType: 'surfaceExtrude', surfaceIds: ['F5'] }).ids).toEqual(['F5']);
    expect(hideSelection(NOTHING_HIDDEN, { names: [], featureId: 'F2', featureType: 'extrude', surfaceIds: ['F5'] })).toBe(NOTHING_HIDDEN);
  });
  it('Show all clears surface bodies too', () => {
    const s = createLookStore();
    s.hide({ names: ['F5.S.sp'], surfaceOf });
    expect(anyHidden(s.hidden.value)).toBe(true);
    s.showAll();
    expect(anyHidden(s.hidden.value)).toBe(false);
  });
});

describe('studio defaults and persistence', () => {
  it('default look is studio light on a gradient with a silhouette and thin edges', () => {
    expect(DEFAULT_LOOK).toMatchObject({ light: 'studio', background: 'gradient', intensity: 1, reflections: true, edgeWidth: 'thin', silhouette: true });
  });
  it('a look stored before the studio defaults gets them once, keeping style and appearances', () => {
    const old = sanitizeLook({ style: 'ghost', light: 'flat', background: 'theme', appearances: { a: { color: '#d0463b', material: 'plastic' } } });
    expect(old).toMatchObject({ style: 'ghost', light: 'studio', background: 'gradient', v: LOOK_VERSION });
    expect(old.appearances.a.color).toBe('#d0463b');
    // from then on the user's choice is kept
    expect(sanitizeLook({ ...old, light: 'flat', background: 'theme' })).toMatchObject({ light: 'flat', background: 'theme' });
  });
  it('round-trips the new scene settings and clamps garbage', () => {
    const l = sanitizeLook({ v: LOOK_VERSION, light: 'technical', intensity: 1.4, reflections: false, edgeWidth: 'bold', silhouette: false });
    expect(sanitizeLook(JSON.parse(JSON.stringify(l)))).toEqual(l);
    expect(l).toMatchObject({ light: 'technical', intensity: 1.4, reflections: false, edgeWidth: 'bold', silhouette: false });
    expect(sanitizeLook({ v: LOOK_VERSION, intensity: 99, edgeWidth: 'huge', reflections: 'yes' })).toMatchObject({ intensity: 2, edgeWidth: 'thin', reflections: true });
  });
  it('the store persists the settings through set()', () => {
    const s = createLookStore();
    s.set({ light: 'technical', intensity: 1.5, reflections: false });
    expect(s.look.value).toMatchObject({ light: 'technical', intensity: 1.5, reflections: false });
  });
});

describe('component appearances', () => {
  const mat = (n: string | null | undefined) => (n === 'gasket' ? { color: '#e8802a', material: 'matte' as const } : n === 'steel' ? { color: '#aab4c2', material: 'default' as const } : null);
  const parts = [{ id: 'F1', material: 'steel' }, { id: 'F2', material: 'gasket' }, { id: 'F3', material: null }];
  it('each component takes its material colour and finish; the gasket is orange', () => {
    const m = componentAppearances(DEFAULT_LOOK, 'asm', parts, mat);
    expect(m.get('F1')!.color).toBe('#aab4c2');
    expect(m.get('F2')).toEqual({ color: '#e8802a', material: 'matte' });
    expect(m.get('F3')).toEqual(DEFAULT_LOOK.appearances.asm ?? { color: '#c3ccd8', material: 'default' });
  });
  it('a per-component override wins over the material and survives the store', () => {
    const l = withAppearance(DEFAULT_LOOK, componentKey('asm', 'F2'), { color: '#3f8f5f' });
    const m = componentAppearances(l, 'asm', parts, mat);
    expect(m.get('F2')!.color).toBe('#3f8f5f');
    expect(m.get('F2')!.material).toBe('matte');   // the finish stays the material's
    expect(m.get('F1')!.color).toBe('#aab4c2');
    expect(sanitizeLook(JSON.parse(JSON.stringify(l))).appearances[componentKey('asm', 'F2')].color).toBe('#3f8f5f');
  });
  it('with Use material colour off every component takes the assembly look', () => {
    const m = componentAppearances(DEFAULT_LOOK, 'asm', parts, mat, false);
    expect(new Set([...m.values()].map((a) => a.color))).toEqual(new Set(['#c3ccd8']));
  });
});
