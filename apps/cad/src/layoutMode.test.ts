import { describe, it, expect, afterEach, vi } from 'vitest';
import { DEFAULT_WORKSPACE } from '@kit/store';
import { computeLayout, effectiveWorkspace, narrowTablet, asLayoutPref, layout, layoutPref, viewportInfo, watchViewport } from './layoutMode';

const v = (w: number, h: number, coarse = false) => ({ w, h, coarse });

describe('computeLayout', () => {
  it('phones are narrower than 700 px', () => {
    expect(computeLayout(v(390, 844, true))).toBe('phone');
    expect(computeLayout(v(699, 900))).toBe('phone');
    expect(computeLayout(v(700, 900))).toBe('tablet');
  });
  it('a phone turned sideways is still a phone, a tablet turned sideways is not', () => {
    expect(computeLayout(v(844, 390, true))).toBe('phone');
    expect(computeLayout(v(1180, 820, true))).toBe('tablet');
    expect(computeLayout(v(844, 390, false))).toBe('tablet');   // a short desktop window is not a phone
  });
  it('tablets are narrower than 1100 px or have a coarse pointer', () => {
    expect(computeLayout(v(820, 1180, true))).toBe('tablet');
    expect(computeLayout(v(1099, 800))).toBe('tablet');
    expect(computeLayout(v(1100, 800))).toBe('desktop');
    expect(computeLayout(v(1366, 1024, true))).toBe('tablet');
    expect(computeLayout(v(1920, 1080))).toBe('desktop');
  });
});

describe('layout signal', () => {
  afterEach(() => { layoutPref.value = 'auto'; viewportInfo.value = v(1440, 900); });
  it('follows the viewport and the user override wins', () => {
    viewportInfo.value = v(390, 844, true);
    expect(layout.value).toBe('phone');
    viewportInfo.value = v(1440, 900);
    expect(layout.value).toBe('desktop');
    layoutPref.value = 'tablet';
    expect(layout.value).toBe('tablet');
    layoutPref.value = 'auto';
    expect(layout.value).toBe('desktop');
  });
  it('a stored value that is not a layout means auto', () => {
    expect(asLayoutPref('phone')).toBe('phone');
    expect(asLayoutPref('watch')).toBe('auto');
    expect(asLayoutPref(null)).toBe('auto');
  });
});

describe('effectiveWorkspace', () => {
  it('desktop is the stored workspace, untouched', () => {
    expect(effectiveWorkspace(DEFAULT_WORKSPACE, 'desktop')).toBe(DEFAULT_WORKSPACE);
  });
  it('a tablet docks the tree and the properties and takes the compact ribbon', () => {
    const e = effectiveWorkspace(DEFAULT_WORKSPACE, 'tablet');
    expect(e).toMatchObject({ ribbon: 'compact', leftPanel: 'docked', rightPanel: 'docked' });
    expect(effectiveWorkspace({ ...DEFAULT_WORKSPACE, ribbon: 'off', leftPanel: 'hidden', rightPanel: 'off' }, 'tablet')).toMatchObject({ ribbon: 'off', leftPanel: 'hidden', rightPanel: 'off' });
  });
  it('a narrow (portrait) tablet docks only the tabbed left panel, so the canvas keeps the width; a hidden panel stays hidden', () => {
    const e = effectiveWorkspace(DEFAULT_WORKSPACE, 'tablet', true);
    expect(e).toMatchObject({ ribbon: 'compact', leftPanel: 'docked', leftTabs: true, rightPanel: 'off' });
    expect(effectiveWorkspace({ ...DEFAULT_WORKSPACE, leftPanel: 'hidden' }, 'tablet', true)).toMatchObject({ leftPanel: 'hidden', rightPanel: 'off' });
    expect(effectiveWorkspace(DEFAULT_WORKSPACE, 'tablet', false)).toMatchObject({ rightPanel: 'docked' });
  });
  it('narrowTablet: a tablet no wider than 900px', () => {
    const was = viewportInfo.value;
    viewportInfo.value = { w: 820, h: 1180, coarse: true }; expect(narrowTablet.value).toBe(true);
    viewportInfo.value = { w: 1180, h: 820, coarse: true }; expect(narrowTablet.value).toBe(false);
    viewportInfo.value = { w: 390, h: 844, coarse: true }; expect(narrowTablet.value).toBe(false);
    viewportInfo.value = was;
  });
  it('a phone keeps panels, rail and drawer off the canvas (they are sheets) and does not change the stored workspace', () => {
    const before = JSON.stringify(DEFAULT_WORKSPACE);
    const e = effectiveWorkspace({ ...DEFAULT_WORKSPACE, toolRail: true, drawerOpen: true }, 'phone');
    expect(e).toMatchObject({ leftPanel: 'hidden', rightPanel: 'off', toolRail: false, drawerOpen: false, leftTabs: true, ribbon: 'compact', toolLabels: 'icons' });
    expect(JSON.stringify(DEFAULT_WORKSPACE)).toBe(before);
  });
});

describe('watchViewport', () => {
  afterEach(() => { viewportInfo.value = v(1440, 900); document.documentElement.removeAttribute('style'); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 }); });
  it('reads the window size, follows resizes and stops when told', () => {
    const stop = watchViewport(window);
    expect(viewportInfo.value.w).toBe(window.innerWidth);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    window.dispatchEvent(new Event('resize'));
    expect(viewportInfo.value.w).toBe(390);
    expect(layout.value).toBe('phone');
    stop();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    window.dispatchEvent(new Event('resize'));
    expect(viewportInfo.value.w).toBe(390);
  });
  it('publishes the keyboard inset from the visual viewport', () => {
    const listeners: Record<string, () => void> = {};
    const vv = { height: 500, offsetTop: 0, addEventListener: (n: string, f: () => void) => { listeners[n] = f; }, removeEventListener: vi.fn() };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const stop = watchViewport(window);
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('300px');
    expect(document.documentElement.style.getPropertyValue('--vvh')).toBe('500px');
    expect(document.documentElement.hasAttribute('data-kb')).toBe(true);   // the phone layout hands the room of its bars to the sheet and the canvas
    vv.height = 800; listeners.resize!();
    expect(document.documentElement.hasAttribute('data-kb')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('0px');
    stop();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
  });
});
