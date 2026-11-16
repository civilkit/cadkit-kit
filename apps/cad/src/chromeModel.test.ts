import { describe, it, expect } from 'vitest';
import { DEFAULT_WORKSPACE, WORKSPACE_PRESETS, createStore, sanitizeWorkspace, hasToolSurface, type Workspace } from '@kit/store';
import { effectiveWorkspace, isTouchTablet, type Layout } from './layoutMode';
import { navHidden, railMode, restoreHandles, toolSurfaces, undoRedoPlace, undoRedoVisible } from './chromeModel';

const LAYOUTS: Layout[] = ['phone', 'tablet', 'desktop'];
/** Every combination of the switches that decide which chrome is drawn. */
function* combos(): Generator<Workspace> {
  for (const ribbon of ['full', 'compact', 'off'] as const) for (const leftPanel of ['docked', 'floating', 'hidden'] as const) for (const leftCollapsed of [false, true])
    for (const rightPanel of ['off', 'docked', 'floating'] as const) for (const toolRail of [false, true]) for (const sketchPalette of [false, true]) for (const drawerOpen of [false, true])
      yield { ...DEFAULT_WORKSPACE, ribbon, leftPanel, leftCollapsed, rightPanel, toolRail, sketchPalette, drawerOpen };
}

describe('layout model: the tools can always be got back', () => {
  it('every stored combination, once loaded, shows a tool surface (Minimal alone is the exception and has its Show tools handle)', () => {
    let n = 0;
    for (const raw of combos()) {
      const ws = sanitizeWorkspace(raw);
      n++;
      const isMinimal = ws.ribbon === 'off' && !ws.toolRail;
      if (!isMinimal) expect(hasToolSurface(ws), JSON.stringify(raw)).toBe(true);
      for (const l of LAYOUTS) {
        const eff = effectiveWorkspace(ws, l, l === 'tablet');
        const surfaces = toolSurfaces(eff, l);
        const handles = restoreHandles(eff, l);
        // at least one tool surface, or the "Show tools" handle that brings one back
        expect(surfaces.length > 0 || handles.includes('show-tools'), `${l} ${JSON.stringify(raw)}`).toBe(true);
        // a touch layout never lacks a surface at all, whatever is stored
        if (l !== 'desktop') expect(surfaces.length, `${l} ${JSON.stringify(raw)}`).toBeGreaterThan(0);
        // the side panel can always be brought back unless the layout has its own bottom bar for it
        if (l !== 'phone') expect(handles).toContain('nav');
      }
    }
    expect(n).toBe(3 * 3 * 2 * 3 * 2 * 2 * 2);
  });
  it('the presets each have tools, and hiding the panel never removes the only tool surface', () => {
    for (const p of Object.values(WORKSPACE_PRESETS)) for (const l of LAYOUTS) {
      const hidden = { ...p, leftCollapsed: true };
      const eff = effectiveWorkspace(hidden, l, l === 'tablet');
      expect(toolSurfaces(eff, l).length > 0 || restoreHandles(eff, l).includes('show-tools')).toBe(true);
    }
    // Plasticity: ribbon off, so the folded panel leaves the tool column in its compact form (it is the only tool surface)
    expect(railMode({ ...WORKSPACE_PRESETS.plasticity, leftCollapsed: true }, 'tablet')).toBe('compact');
    expect(railMode(WORKSPACE_PRESETS.plasticity, 'tablet')).toBe('full');
    // with a ribbon the column goes with the panel
    expect(railMode({ ...WORKSPACE_PRESETS.plasticity, ribbon: 'compact', leftCollapsed: true }, 'tablet')).toBe('hidden');
    expect(railMode(WORKSPACE_PRESETS.classic, 'tablet')).toBe('none');
    expect(railMode(WORKSPACE_PRESETS.plasticity, 'phone')).toBe('none');
  });
  it('a persisted state without any tools is repaired on load; Minimal keeps its handle', () => {
    expect(sanitizeWorkspace({ ribbon: 'off', toolRail: false, leftPanel: 'hidden' }).ribbon).toBe('compact');
    expect(sanitizeWorkspace({ ribbon: 'off', toolRail: false, leftPanel: 'docked', rightPanel: 'docked' }).ribbon).toBe('compact');
    expect(sanitizeWorkspace({ ...WORKSPACE_PRESETS.minimal }).ribbon).toBe('off');
    expect(restoreHandles(WORKSPACE_PRESETS.minimal, 'desktop')).toContain('show-tools');
    expect(effectiveWorkspace(WORKSPACE_PRESETS.minimal, 'tablet', true).ribbon).toBe('compact');   // never strand a touch user
  });
  it('turning switches off one by one in Settings never ends with nothing', () => {
    const s = createStore();
    for (const patch of [{ ribbon: 'off' as const }, { toolRail: false }, { ribbon: 'off' as const }, { toolRail: false }, { leftPanel: 'hidden' as const }, { leftCollapsed: true }, { ribbon: 'off' as const }]) {
      s.setWorkspace(patch);
      const w = s.workspace.value;
      expect(hasToolSurface(w) || (w.ribbon === 'off' && !w.toolRail && w.leftPanel === 'floating')).toBe(true);
    }
  });
  it('Reset layout brings the panel, its size and the tools back', () => {
    const s = createStore();
    s.applyPreset('minimal');
    s.setWorkspace({ leftPanel: 'hidden', leftCollapsed: true });   // custom now: stored as given (ribbon repaired)
    s.setWorkspace({ leftWidth: 999 });
    s.resetLayout();
    const w = s.workspace.value;
    expect(w.leftPanel).toBe('docked'); expect(w.leftCollapsed).toBe(false); expect(hasToolSurface(w)).toBe(true); expect(w.leftWidth).toBe(280);
  });
  it('the panel is hidden by the fold or by Settings; Undo and Redo are drawn on every touch layout', () => {
    expect(navHidden({ leftPanel: 'docked', leftCollapsed: true })).toBe(true);
    expect(navHidden({ leftPanel: 'hidden', leftCollapsed: false })).toBe(true);
    expect(navHidden({ leftPanel: 'floating', leftCollapsed: false })).toBe(false);
    expect(undoRedoPlace('tablet')).toBe('card'); expect(undoRedoPlace('phone')).toBe('top-bar'); expect(undoRedoPlace('desktop')).toBe('ribbon');
    expect(undoRedoVisible('tablet')).toBe(true); expect(undoRedoVisible('phone')).toBe(false);
  });
  it('an iPad that reports a Mac user agent is a touch tablet', () => {
    expect(isTouchTablet('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 5)).toBe(true);
    expect(isTouchTablet('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isTouchTablet('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)', 0)).toBe(true);
  });
});
