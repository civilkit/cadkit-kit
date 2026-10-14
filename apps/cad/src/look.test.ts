import { describe, it, expect } from 'vitest';
import { sanitizeLook, DEFAULT_LOOK, withAppearance, appearanceOf, hideSelection, NOTHING_HIDDEN, createLookStore, anyHidden, bodyLook } from './look';
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
    expect(appearanceOf(l, 'b').color).toBe('#b8c4d6');
    l = withAppearance(l, 'a', { color: '#b8c4d6' });
    expect(l.appearances).toEqual({});
    expect(bodyLook(DEFAULT_LOOK, 'a').style).toBe('shadedEdges');
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
