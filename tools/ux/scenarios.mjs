// UX review scenarios. Each is { id, title, run(ctx) }. ctx helpers are defined in shots.mjs (see makeCtx).
// A scenario that cannot find its UI calls ctx.skip('why'): the run goes on and report.md lists the skip.
// Add a scenario by appending to SCENARIOS; keep each one small and use only the helpers.

const DEFAULTS = { drawerOpen: false, selectionBar: false, commandBar: false };
/** Workspace presets as the app stores them (key cad.workspace). Mirrors packages/store WORKSPACE_PRESETS; unknown keys are ignored by the app. */
export const WS = {
  plasticity: { ribbon: 'off', leftPanel: 'docked', leftTabs: true, leftCollapsed: false, rightPanel: 'off', toolRail: true, sketchPalette: false, toolLabels: 'icons-and-text', selectionBar: true, commandBar: true, drawerOpen: true, handles: true, opacity: 0.62, blur: 14, lineWidth: 3 },
  classic: { ribbon: 'full', leftPanel: 'docked', leftTabs: false, leftCollapsed: false, rightPanel: 'docked', toolRail: false, sketchPalette: false, toolLabels: 'icons-and-text', selectionBar: false, commandBar: false, drawerOpen: false, handles: true, opacity: 1, blur: 0, lineWidth: 3 },
  minimal: { ribbon: 'off', leftPanel: 'floating', leftTabs: false, leftCollapsed: false, rightPanel: 'off', toolRail: false, sketchPalette: false, toolLabels: 'icons-and-text', selectionBar: false, commandBar: false, drawerOpen: false, handles: true, opacity: 0.5, blur: 14, lineWidth: 3 },
};
void DEFAULTS;

const tab = (name) => ({
  id: `ribbon-${name.toLowerCase()}`,
  title: `Ribbon tab: ${name} (classic layout, a small part open)`,
  async run(c) {
    await c.open({ sample: 'mounting-plate', workspace: 'classic' });
    if (!(await c.click(`.rb-tab`, name))) return c.skip(`ribbon tab ${name} not found`);
    await c.settle();
  },
});

export const SCENARIOS = [
  { id: 'empty-home', title: 'Empty new part, Home tab (classic layout)', async run(c) { await c.open({ workspace: 'classic' }); } },
  { id: 'empty-plasticity', title: 'Empty new part, default (Plasticity) layout', async run(c) { await c.open({ workspace: 'plasticity' }); } },
  ...['Home', 'Features', 'Surfaces', 'View', 'Select', 'Evaluate', 'Assembly'].slice(1).map(tab),
  {
    id: 'selected-properties', title: 'Part with a feature selected (properties panel)',
    async run(c) {
      await c.open({ sample: 'mounting-plate', workspace: 'classic' });
      if (!(await c.clickRow('Base')) && !(await c.clickRow('F2'))) return c.skip('no feature row to select');
      await c.settle();
    },
  },
  {
    id: 'feature-editor-extrude', title: 'Feature editor open for an extrude',
    async run(c) {
      await c.open({ sample: 'mounting-plate', workspace: 'classic' });
      if (!(await c.clickRow('Extrude', { dbl: true })) && !(await c.clickRow('F2', { dbl: true }))) {
        if (!(await c.click('button', 'Extrude'))) return c.skip('no extrude row or button');
      }
      await c.settle();
    },
  },
  {
    id: 'sketch-enter', title: 'Entering a new sketch on the Front plane (contextual Sketch tab, sketch bar)',
    async run(c) {
      await c.open({ workspace: 'classic' });
      if (!(await c.click('button', 'Sketch on Front Plane'))) return c.skip('no "Sketch on Front Plane" button');
      await c.settle(1200);
    },
  },
  {
    id: 'sketch-constraints', title: 'Editing an existing sketch with constraints and dimensions',
    async run(c) {
      await c.open({ sample: 'parametric-bracket', workspace: 'classic' });
      if (!(await c.clickRow('Plate outline', { dbl: true }))) return c.skip('no sketch row "Plate outline"');
      await c.settle(1500);
    },
  },
  {
    id: 'sketch-on-face', title: 'Sketch on a face (a face selected, then Sketch)',
    async run(c) {
      await c.open({ sample: 'mounting-plate', workspace: 'classic' });
      // click the model top face in the viewport (centre of the canvas), then the sketch command
      const r = await c.canvasRect(); if (!r) return c.skip('no canvas');
      await c.pressKey('q');
      await c.page.click(r.x + r.w / 2, r.y + r.h / 2); await c.settle(300);
      if (!(await c.click('button', 'Sketch on selected face or plane'))) return c.skip('no sketch command');
      await c.settle(1500);
    },
  },
  {
    id: 'plasticity-model', title: 'Plasticity preset, tool column in model mode (part open)',
    async run(c) { await c.open({ sample: 'mounting-plate', workspace: 'plasticity' }); },
  },
  {
    id: 'plasticity-sketch', title: 'Plasticity preset, tool column in sketch mode',
    async run(c) {
      await c.open({ sample: 'mounting-plate', workspace: 'plasticity' });
      if (!(await c.clickRow('Front Plane'))) return c.skip('no Front Plane row');
      if (!(await c.click('button', 'Sketch on selected face or plane'))) return c.skip('no sketch command');
      await c.settle(1200);
    },
  },
  {
    id: 'hole-thread', title: 'Hole feature with the thread editor',
    async run(c) {
      await c.open({ sample: 'threaded-bolt', workspace: 'classic' });
      if (!(await c.clickRow('M8 tapped hole', { dbl: true })) && !(await c.clickRow('M8 thread', { dbl: true }))) return c.skip('no hole/thread row');
      await c.settle();
    },
  },
  {
    id: 'assembly-mates', title: 'Assembly with mates (Assembly tab)',
    async run(c) {
      await c.open({ sample: 'assembly-block-bolt', workspace: 'classic' });
      await c.click('.rb-tab', 'Assembly'); await c.settle();
    },
  },
  {
    id: 'drawing', title: 'Drawing tab', async run(c) {
      await c.open({ sample: 'mounting-plate', workspace: 'classic' });
      if (!(await c.click('[role=tab]', 'Drawing'))) return c.skip('no Drawing tab');
      await c.settle(1000);
    },
  },
  {
    id: 'catalog', title: 'Catalog panel',
    async run(c) {
      await c.open({ workspace: 'plasticity' });
      if (!(await c.click('button', 'Catalog'))) return c.skip('no Catalog button');
      await c.settle(800);
    },
  },
  {
    id: 'script', title: 'Script panel',
    async run(c) {
      await c.open({ workspace: 'plasticity' });
      if (!(await c.click('button', 'Script'))) return c.skip('no Script button');
      await c.settle(800);
    },
  },
  {
    id: 'settings', title: 'Settings dialog',
    async run(c) {
      await c.open({ sample: 'mounting-plate', workspace: 'classic' });
      if (!(await c.click('button', 'Workspace settings'))) return c.skip('no settings button');
      await c.settle(600);
    },
  },
  {
    id: 'command-search', title: 'Command search (F)',
    async run(c) { await c.open({ sample: 'mounting-plate', workspace: 'classic' }); await c.pressKey('f'); await c.settle(500); },
  },
  {
    id: 'error-state', title: 'A failing feature (extrude referencing a missing sketch)',
    async run(c) {
      await c.open({ sample: 'mounting-plate', workspace: 'plasticity', mutate: (d) => { const e = d.features.find((f) => f.type === 'extrude'); if (e) e.sketch = 'F99'; } });
      await c.settle(800);
    },
  },
  {
    id: 'large-loading', title: 'Large sample loading overlay (heavy part, captured while it rebuilds)',
    async run(c) {
      await c.open({ sample: 'heavy/matx-case', workspace: 'plasticity', wait: false });
      await c.sleep(2500);
    },
  },
];
