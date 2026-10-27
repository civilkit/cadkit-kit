// Shot definitions for tools/doc_shots.mjs: { name, caption, run(ctx) -> optional clip {x,y,w,h} }.

/** A rectangle sketch on a standard plane. `fixed` pins the first corner; `dims` adds the two size dimensions. */
export const rectSketch = (id, name, plane, w, h, { fixed = false, dims = true, cx = 0, cy = 0, origin = true } = {}) => ({
  type: 'sketch', id, name, plane: { kind: 'std', id: plane },
  points: [...(origin ? [{ id: 'O', x: 0, y: 0, fixed: true }] : []), { id: 'p1', x: cx, y: cy, ...(fixed ? { fixed: true } : {}) }, { id: 'p2', x: cx + w, y: cy }, { id: 'p3', x: cx + w, y: cy + h }, { id: 'p4', x: cx, y: cy + h }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })),
  constraints: [{ id: 'c1', type: 'horizontal', refs: ['e1'] }, { id: 'c2', type: 'vertical', refs: ['e2'] }, { id: 'c3', type: 'horizontal', refs: ['e3'] }, { id: 'c4', type: 'vertical', refs: ['e4'] },
    ...(dims ? [{ id: 'c5', type: 'hdist', refs: ['p1', 'p2'], value: w }, { id: 'c6', type: 'vdist', refs: ['p2', 'p3'], value: h }] : [])],
});
export const newDoc = (name, features, extra = {}) => ({ format: 'ck-part', version: 1, name, features, seq: features.length + 1, rollback: null, material: 'steel', counters: {}, ...extra });

export const SHOTS = [
  { name: 'interface-overview', caption: 'The default CadKit window with a small part open: top bar, ribbon, feature tree, viewport with view cube, and status bar.',
    async run(c) { await c.open({ sample: 'mounting-plate' }); await c.sleep(4500); } },
  { name: 'first-part-start', caption: 'A new empty part with the Start here card offering three Sketch on plane buttons.',
    async run(c) { await c.open({}); if (!(await c.find('button', 'Sketch on Front Plane'))) c.skip('no start card'); } },
  { name: 'first-part-dimensioned', caption: 'A rectangle sketch on the Front plane with 60 and 40 dimensions and the status chip showing the remaining degrees of freedom.',
    async run(c) {
      await c.open({ doc: newDoc('Part1', [rectSketch('F1', 'Sketch 1', 'front', 60, 40, { cx: -30, cy: -20 })]) });
      if (!(await c.editRow('Sketch 1'))) c.skip('no sketch row'); await c.viewport(1860, 900); await c.key('n'); await c.page.click(1000, 820); await c.settle(1200); await c.sleep(4000);
    } },

  { name: 'sketch-editor-open', caption: 'A sketch open on the top face of a plate: the Editing tab of the ribbon, the faded body, the status chip, and the pointer coordinates in the status bar.',
    async run(c) {
      const plate = rectSketch('F1', 'Base', 'front', 80, 50, { dims: true });
      const face = { type: 'sketch', id: 'F3', name: 'Face sketch', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'k', x: 40, y: 25 }, { id: 'k2', x: 55, y: 25 }], entities: [{ id: 'k1', type: 'circle', c: 'k', r: 10 }], constraints: [] };
      await c.open({ doc: newDoc('Plate', [plate, { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 12 }, face]) });
      await c.viewport(1860, 900);
      if (!(await c.editRow('Face sketch'))) c.skip('no sketch row'); await c.settle(1200);
      await c.page.mouse('mouseMoved', 700, 560); await c.sleep(300);
    } },
  { name: 'constraints-list-open', caption: 'A dimensioned bracket sketch with relation glyphs in the view and the Constraints list opened from the status chip.',
    async run(c) {
      await c.open({ sample: 'parametric-bracket' }); await c.viewport(1920, 900);
      if (!(await c.editRow('Plate outline'))) c.skip('no sketch row'); await c.settle(1200); await c.key('n'); await c.sleep(600);
      if (!(await c.click('button', 'Fully defined')) && !(await c.click('button', 'DOF'))) c.skip('no status chip'); await c.settle(600);
    } },
  { name: 'sketch-tools-palette', caption: 'The Draw group of the sketch ribbon with the Rectangle flyout open, listing the tool names and their keys.',
    async run(c) {
      await c.open({ doc: newDoc('Part1', [rectSketch('F1', 'Sketch 1', 'front', 60, 40, { cx: -30, cy: -20 })]) }); await c.viewport(1860, 900);
      if (!(await c.editRow('Sketch 1'))) c.skip('no sketch row'); await c.settle(1000);
      const r = await c.find('button', 'More tools like Rectangle'); if (!r) c.skip('no flyout arrow'); await c.page.click(r.x, r.y); await c.sleep(500);
      return { x: 300, y: 112, w: 420, h: 200 };
    } },
  { name: 'ribbon-tabs', caption: 'The ribbon with the Home tab selected and the Extrude button flyout open, showing Extruded cut.',
    async run(c) {
      await c.open({ sample: 'mounting-plate' });
      const r = await c.find('button', 'More tools like Extrude'); if (!r) c.skip('no flyout arrow'); await c.page.click(r.x, r.y); await c.sleep(500);
      return { x: 0, y: 80, w: 700, h: 185 };
    } },
  { name: 'tab-strip', caption: 'The top bar and tab strip with three open parts, the first marked as changed.',
    async run(c) {
      await c.open({ sample: 'mounting-plate' });
      for (let i = 0; i < 2; i++) { if (!(await c.click('button', 'New part in a new tab'))) c.skip('no new tab button'); await c.settle(800); }
      await c.sleep(2000); return { x: 0, y: 0, w: 1440, h: 84 };
    } },

  { name: 'extrude-editor', caption: 'A block with a circle sketch on its top face and the Extrude editor open in the left panel, with End condition, Operation and Options sections and the preview in the view.',
    async run(c) {
      await c.open({ doc: boxWithCircle() });
      if (!(await c.selRow('Circle'))) c.skip('no sketch row');
      if (!(await c.click('button', 'Extrude'))) c.skip('no extrude button'); await c.settle(1200);
      return { x: 0, y: 80, w: 1160, h: 790 };
    } },

  { name: 'thin-wall', caption: 'A C-shaped open spline extruded as a thin wall, with the Thin wall section of the Extrude editor open showing Wall thickness, Side and End caps.',
    async run(c) {
      const pts = [[30, 20], [10, 28], [-10, 24], [-25, 8], [-25, -8], [-10, -24], [10, -28], [30, -20]].map(([x, y], i) => ({ id: 'p' + i, x, y }));
      const sk = { type: 'sketch', id: 'F1', name: 'C curve', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...pts], entities: [{ type: 'spline', id: 'e1', pts: pts.map((p) => p.id), closed: false }], constraints: [] };
      await c.open({ doc: newDoc('C wall', [sk, { type: 'extrude', id: 'F2', name: 'Wall', op: 'add', sketch: 'F1', end: 'blind', depth: 30, thin: { thickness: 3, side: 'mid', ends: 'flat', cornerStyle: 'mitre' } }]) });
      if (!(await c.editRow('Wall'))) c.skip('no extrude row'); await c.settle(1200); await c.scrollPanel('bottom');
      return { x: 0, y: 80, w: 1160, h: 790 };
    } },
  { name: 'loft-editor', caption: 'Three square sketches on offset planes lofted into a tapered solid, with the Profiles list showing three rows and the Guide curves section below.',
    async run(c) {
      const sq = (id, name, plane, r) => ({ type: 'sketch', id, name, plane, points: [{ id: 'a', x: -r, y: -r }, { id: 'b', x: r, y: -r }, { id: 'c', x: r, y: r }, { id: 'd', x: -r, y: r }], entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']].map(([i, p, q]) => ({ id: i, type: 'line', p1: p, p2: q })), constraints: [] });
      const f = [sq('F1', 'Base square', { kind: 'std', id: 'top' }, 25), { type: 'plane', id: 'F2', name: 'Plane 1', mode: 'offset', base: { kind: 'std', id: 'top' }, offset: 30 }, sq('F3', 'Middle square', { kind: 'feature', id: 'F2' }, 17),
        { type: 'plane', id: 'F4', name: 'Plane 2', mode: 'offset', base: { kind: 'std', id: 'top' }, offset: 60 }, sq('F5', 'Top square', { kind: 'feature', id: 'F4' }, 9), { type: 'loft', id: 'F6', name: 'Taper', op: 'add', sketches: ['F1', 'F3', 'F5'] }];
      await c.open({ doc: newDoc('Loft', f) });
      if (!(await c.editRow('Taper'))) c.skip('no loft row'); await c.settle(1500);
      return { x: 0, y: 80, w: 1160, h: 790 };
    } },
  { name: 'fillet-editor', caption: 'A plate with three edges around its top corner selected and the Fillet editor open showing Variable radius, Radius, Profile and Tangent chain.',
    async run(c) {
      await c.open({ doc: tutorialPlate({ hole: false }) });
      await c.key('e'); await c.page.click(722, 416); await c.sleep(300);
      await c.clickMod(878, 623, { shift: true }); await c.clickMod(920, 465, { shift: true });
      if (!(await c.click('button', 'Fillet'))) c.skip('no fillet button'); await c.settle(800);
      if (!(await c.fillField('Radius', '4'))) c.skip('no radius field'); await c.settle(800);
      return { x: 0, y: 80, w: 1160, h: 790 };
    } },
  { name: 'corner-holes', caption: 'A rectangular plate seen face-on with the hole sketch open, the Corner holes card at the top right of the canvas, and four hole points placed in the corners.',
    async run(c) {
      const plate = rectSketch('F1', 'Plate outline', 'front', 80, 50, { cx: -40, cy: -25 });
      await c.open({ doc: newDoc('Plate', [plate, { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 8 }]) });
      await c.key('q'); await c.page.click(600, 520); await c.sleep(400);
      if (!(await c.click('button', 'Hole'))) c.skip('no Hole button'); await c.settle(1200);
      if (!(await c.click('button', 'Place holes'))) c.skip('no Place holes button'); await c.settle(600);
      await c.key('n'); await c.sleep(800);
    } },
  { name: 'first-part-finished', caption: 'The finished plate with a hole and a rounded corner, in the Iso view with the feature tree listing the extrude, hole and fillet.',
    async run(c) {
      await c.open({ doc: tutorialPlate() });
      await c.key('e'); await c.page.click(920, 465); await c.sleep(400);
      if (!(await c.click('button', 'Fillet'))) c.skip('no fillet button'); await c.settle(800);
      if (!(await c.fillField('Radius', '5'))) c.skip('no radius field'); await c.settle(800);
      if (!(await c.click('button', 'Confirm'))) c.skip('no confirm'); await c.settle(1000);
      await c.key('Escape'); await c.key('7'); await c.key('z'); await c.settle(800);
    } },
  { name: 'inspect-drawer', caption: 'The Inspect tab of the drawer under a part, showing the Mass properties card and the result of measuring the distance between two corners.',
    async run(c) {
      await c.open({ sample: 'mounting-plate' }); await c.openDrawer('Inspect'); await c.resizeDrawer(500);
      if (!(await c.click('button', 'Start measuring'))) c.skip('no measure button'); await c.sleep(300);
      await c.key('v'); await c.page.click(647, 263); await c.sleep(300); await c.page.click(787, 449); await c.sleep(700);
      return { x: 0, y: 0, w: 1440, h: 790 };
    } },
  { name: 'check-tab', caption: 'The Check tab with the FDM 3D printing profile run on a part with two separate solids and a thin fin: issues are grouped under Errors and Warnings and the faces are tinted on the part.',
    async run(c) {
      const d = newDoc('Check demo', [rectSketch('F1', 'Base', 'front', 60, 40, { cx: -30, cy: -20 }), { type: 'extrude', id: 'F2', name: 'Base', op: 'add', sketch: 'F1', end: 'blind', depth: 8 },
        rectSketch('F3', 'Fin', 'front', 50, 0.6, { cx: -25, cy: 30 }), { type: 'extrude', id: 'F4', name: 'Thin fin', op: 'new', sketch: 'F3', end: 'blind', depth: 30 }]);
      await c.open({ doc: d }); await c.openDrawer('Check'); await c.resizeDrawer(430);
      await c.click('summary', 'Rules and limits'); await c.sleep(300);
      if (!(await c.selectOption('Single solid', 'Block'))) c.skip('no rule severity select'); await c.sleep(300);
      await c.click('summary', 'Rules and limits'); await c.sleep(200);
      if (!(await c.click('button', 'Run check'))) c.skip('no Run check'); await c.settle(2500);
      await c.click('label', 'Show on part'); await c.sleep(800);
      return { x: 0, y: 190, w: 1440, h: 545 };
    } },
  { name: 'catalog-primitives', caption: 'The Catalog panel on the Primitives tab: the Placement row, then the Add material and Remove material columns of shapes.',
    async run(c) {
      await c.open({ sample: 'mounting-plate' }); await c.viewport(1440, 1250);
      if (!(await c.panelTab('Catalog'))) c.skip('no Catalog tab'); await c.click('[role=tab]', 'Primitives'); await c.settle(800);
      const r = await c.rect('.tree-wrap'); return r ? { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: Math.min(r.h + 8, 870) } : null;
    } },
  { name: 'library-tab', caption: 'The Catalog panel open on the Libraries tab with the search box, the All, Included and Add-ons chips and a grid of cards.',
    async run(c) {
      await c.open({ sample: 'mounting-plate' }); await c.viewport(1440, 1000);
      if (!(await c.panelTab('Catalog'))) c.skip('no Catalog tab'); await c.click('[role=tab]', 'Libraries'); await c.settle(2500);
      const r = await c.rect('.tree-wrap'); return r ? { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 } : null;
    } },
  { name: 'wizard-propeller', caption: 'The Propeller wizard open in the left panel on its Blade step, with the live preview of a three-blade propeller in the viewport.',
    async run(c) {
      await c.open({}); if (!(await c.panelTab('Catalog'))) c.skip('no Catalog tab'); await c.click('[role=tab]', 'Primitives'); await c.settle(500);
      if (!(await c.click('button', 'Propeller'))) c.skip('no Propeller button'); await c.settle(2500);
      if (!(await c.click('button', 'Next'))) c.skip('no Next button'); await c.settle(2500); await c.key('z'); await c.settle(1000);
    } },
  { name: 'script-tab', caption: 'The Script tab in the left panel with the bracket example in the code box and the Run button, and the resulting plate with two holes and rounded edges in the viewport.',
    async run(c) {
      await c.open({}); if (!(await c.panelTab('Script'))) c.skip('no Script tab'); await c.widenPanel(470); await c.settle(400);
      if (!(await c.click('button', 'Run'))) c.skip('no Run'); await c.settle(2500);
      if (!(await c.panelTab('Script'))) c.skip('no Script tab'); await c.key('7'); await c.key('z'); await c.settle(800);
    } },
  { name: 'variables-panel', caption: 'The Variables tab for a parametric bracket with four variables (width, depth, thick and hole) and the Configurations list below with Small, Standard and Large.',
    async run(c) {
      await c.open({ sample: 'parametric-bracket' }); await c.viewport(1440, 1000);
      if (!(await c.panelTab('Variables'))) c.skip('no Variables tab'); await c.settle(600);
      const r = await c.rect('.tree-wrap'); return r ? { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 } : null;
    } },
  { name: 'bodies-panel', caption: 'The Bodies tab for a part with three bodies: a plate, a block and a copy, with the plate hidden and the Copy, Delete, Join, Cut and Intersect buttons above the list.',
    async run(c) {
      const f = [rectSketch('F1', 'Plate outline', 'front', 80, 50, { cx: -40, cy: -25 }), { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 6 },
        rectSketch('F3', 'Block outline', 'front', 24, 24, { cx: 60, cy: -12 }), { type: 'extrude', id: 'F4', name: 'Block', op: 'newBody', sketch: 'F3', end: 'blind', depth: 24 }];
      await c.open({ doc: newDoc('Three bodies', f) });
      if (!(await c.panelTab('Bodies'))) c.skip('no Bodies tab');
      await c.click('.tree-wrap span, .tree-wrap div', 'Block'); await c.sleep(300);
      if (!(await c.click('button', 'Make a copy of the body'))) c.skip('no Copy button'); await c.settle(1200);
      if (!(await c.click('button', 'Hide body: Plate'))) c.skip('no eye button'); await c.settle(600);
      const a = await c.find('.tree-wrap span, .tree-wrap div', 'Block'); const b = await c.find('.tree-wrap span, .tree-wrap div', 'Body 3');
      if (a && b) { await c.page.click(a.x, a.y); await c.sleep(300); await c.clickMod(b.x, b.y, { shift: true }); await c.sleep(500); }
      const r = await c.rect('.tree-wrap'); return r ? { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: 480 } : null;
    } },
  { name: 'feature-tree', caption: 'The Features tab for a bracket plate: sketch rows tucked under their extrude and hole, a thread nested beneath the hole, a fillet, one failed hole row in red, and the rollback line at the bottom.',
    async run(c) { await c.open({ doc: bracketDoc({ failing: true }) }); await c.viewport(1440, 900); await c.sleep(300); } },
  { name: 'tree-error', caption: 'The feature tree after the first extrude lost its sketch: the failed row is red and the rows that depend on it are muted and carry blocked-by chips.',
    async run(c) { await c.open({ doc: bracketDoc({ breakExtrude: true }) }); await c.sleep(300); } },
  { name: 'edit-breaks-model', caption: 'The Extrude editor with the depth reduced to 2 mm: a note says the edit would break the rim fillet that comes later, and the Confirm tick is greyed.',
    async run(c) {
      await c.open({ doc: bracketDoc({}) });
      if (!(await c.editRow('Plate'))) c.skip('no extrude row'); await c.settle(800);
      if (!(await c.fillField('Depth', '2'))) c.skip('no depth field'); await c.settle(1500);
      await c.scrollPanel('bottom'); return { x: 0, y: 80, w: 1160, h: 790 };
    } },
  { name: 'display-menu', caption: 'The Display popover open on a part, showing Style, Appearance swatches, Scene presets and the Show list.',
    async run(c) {
      await c.open({ sample: 'parametric-bracket' }); await c.viewport(1440, 1250);
      if (!(await c.click('button', 'Display'))) c.skip('no Display button'); await c.sleep(800);
      const r = await c.page.eval(`(() => { const e = [...document.querySelectorAll('*')].find((x) => x.children.length === 0 && (x.textContent || '').trim() === 'Light strength'); let n = e; while (n && !(getComputedStyle(n).position === 'absolute' || getComputedStyle(n).position === 'fixed')) n = n.parentElement; if (!n) return null; const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`);
      return r ? { x: r.x - 6, y: r.y - 6, w: r.w + 12, h: r.h + 12 } : null;
    } },
  { name: 'bodies-glass', caption: 'The Bodies tab with several bodies listed and one body selected after choosing the Glass preset, with its Appearance group visible.',
    async run(c) {
      const f = [rectSketch('F1', 'Plate outline', 'front', 80, 50, { cx: -40, cy: -25 }), { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 6 },
        rectSketch('F3', 'Block outline', 'front', 24, 24, { cx: 60, cy: -12 }), { type: 'extrude', id: 'F4', name: 'Block', op: 'newBody', sketch: 'F3', end: 'blind', depth: 24 }];
      await c.open({ doc: newDoc('Glass demo', f) });
      if (!(await c.panelTab('Bodies'))) c.skip('no Bodies tab');
      const a = await c.find('.tree-wrap span, .tree-wrap div', 'Block'); if (!a) c.skip('no Block row'); await c.page.click(a.x, a.y); await c.sleep(400);
      if (!(await c.click('button', 'Glass'))) c.skip('no Glass button'); await c.settle(1200);
    } },
  { name: 'expression-field', caption: 'The Extrude editor with the Depth field holding =thick*2, showing the blue fx badge and the evaluated value under the field.',
    async run(c) {
      await c.open({ sample: 'parametric-bracket' });
      if (!(await c.editRow('Plate'))) c.skip('no extrude row'); await c.settle(800);
      const r = await c.page.eval(`(() => { const lab = [...document.querySelectorAll('.tree-wrap *')].find((e) => e.children.length < 3 && /^Depth/.test((e.textContent || '').trim())); let n = lab; for (let i = 0; i < 3 && n; i++, n = n.parentElement) { const inp = n.querySelector('input'); if (inp) { const b = inp.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; } } return null; })()`);
      if (!r) c.skip('no depth field'); await c.page.click(r.x, r.y); await c.page.eval('document.activeElement.select(); 0'); await c.page.send('Input.insertText', { text: '=thick*2' }); await c.sleep(700);
      return { x: 0, y: 80, w: 1160, h: 790 };
    } },
  { name: 'reference-plane', caption: 'A block with a reference plane drawn 10 mm above its top face and the Plane editor open showing Mode, Offset and Base plane.',
    async run(c) {
      const base = rectSketch('F1', 'Block outline', 'front', 80, 50, { cx: -40, cy: -25 });
      await c.open({ doc: newDoc('Plane demo', [base, { type: 'extrude', id: 'F2', name: 'Block', op: 'add', sketch: 'F1', end: 'blind', depth: 20 }, { type: 'plane', id: 'F3', name: 'Plane 1', mode: 'offset', base: { kind: 'face', id: 'F2.C1' }, offset: 10 }]) });
      if (!(await c.editRow('Plane 1'))) c.skip('no plane row'); await c.settle(1000);
      return { x: 0, y: 80, w: 1160, h: 790 };
    } },
  { name: 'linear-pattern', caption: 'A bar with a pocket repeated three times along its length and the Linear pattern editor open showing Count and Spacing.',
    async run(c) {
      const bar = rectSketch('F1', 'Bar outline', 'front', 120, 24, { cx: -60, cy: -12 });
      const pk = { type: 'sketch', id: 'F3', name: 'Pocket outline', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: -50, y: -7 }, { id: 'b', x: -35, y: -7 }, { id: 'c', x: -35, y: 7 }, { id: 'd', x: -50, y: 7 }],
        entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']].map(([i, p, q]) => ({ id: i, type: 'line', p1: p, p2: q })), constraints: [] };
      const f = [bar, { type: 'extrude', id: 'F2', name: 'Bar', op: 'add', sketch: 'F1', end: 'blind', depth: 12 }, pk, { type: 'extrude', id: 'F4', name: 'Pocket', op: 'cut', sketch: 'F3', end: 'blind', depth: 5 },
        { type: 'lpattern', id: 'F5', name: 'Pocket pattern', seeds: ['F4'], dir: { kind: 'axis', axis: 'x' }, count: 3, spacing: 40, reverse: false }];
      await c.open({ doc: newDoc('Pattern demo', f) });
      if (!(await c.editRow('Pocket pattern'))) c.skip('no pattern row'); await c.settle(1200);
      return { x: 0, y: 80, w: 1160, h: 790 };
    } },
  { name: 'surfaces-tab', caption: 'The Surfaces tab of the ribbon with a wavy extruded surface standing on a plate, tinted teal, and the Create and Edit groups visible.',
    async run(c) {
      await c.open({ sample: 'surface-patch' }); if (!(await c.click('.rb-tab', 'Surfaces'))) c.skip('no Surfaces tab'); await c.settle(1200);
    } },
  { name: 'drawing-sheet', caption: 'The Drawing view for the mounting plate sample: front, top, right and isometric views with dimensions and the title block.',
    async run(c) {
      await c.open({ sample: 'mounting-plate' }); if (!(await c.click('button', 'Drawing'))) c.skip('no Drawing button'); await c.settle(2500);
    } },
  { name: 'assembly-panel', caption: 'The left panel on the Outliner tab with the Parts section open for the gear train assembly sample, components listed with their degrees-of-freedom badges.',
    async run(c) {
      await c.open({ sample: 'assembly-gear-train' }); await c.viewport(1440, 1000); if (!(await c.panelTab('Outliner'))) c.skip('no Outliner tab'); await c.widenPanel(400); await c.settle(1000);
      { const r = await c.rect('.tree-wrap'); return r ? { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: Math.min(r.h + 8, 660) } : null; }
    } },
  { name: 'mate-editor', caption: 'The Mates section with a Gear mate being edited: both references picked, the ratio filled in and the Test drive slider visible.',
    async run(c) {
      await c.open({ sample: 'assembly-gear-train' }); await c.viewport(1440, 1000); if (!(await c.panelTab('Outliner'))) c.skip('no Outliner tab'); await c.widenPanel(400);
      if (!(await c.click('[role=tab]', 'Mates'))) c.skip('no Mates tab'); await c.settle(600);
      if (!(await c.clickNth('.tree-wrap button', 'Edit', 2))) c.skip('no mate edit button'); await c.settle(1000);
      { const r = await c.rect('.tree-wrap'); return r ? { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 } : null; }
    } },
  { name: 'size-box', caption: 'An extruded block selected from the feature tree with its size box shown: face handles, corner handles, the anchor diamond and the three dimension labels.',
    async run(c) {
      const base = rectSketch('F1', 'Block outline', 'front', 60, 40, { cx: -30, cy: -20 });
      await c.open({ doc: newDoc('Block', [base, { type: 'extrude', id: 'F2', name: 'Block', op: 'add', sketch: 'F1', end: 'blind', depth: 25 }]) });
      if (!(await c.selRow('Block'))) c.skip('no extrude row'); await c.sleep(1000);
      return { x: 0, y: 192, w: 1160, h: 678 };
    } },
  { name: 'move-rotate-ball', keepPointer: true, caption: 'A block selected whole with the move and rotate ball at its centre, shown while dragging an axis end dot, with the Distance readout above the ball.',
    async run(c) {
      const base = rectSketch('F1', 'Block outline', 'front', 60, 40, { cx: -30, cy: -20 });
      await c.open({ doc: newDoc('Block', [base, { type: 'extrude', id: 'F2', name: 'Block', op: 'add', sketch: 'F1', end: 'blind', depth: 25 }]) });
      await c.selRow('Block'); await c.sleep(800); await c.page.mouse('mouseMoved', 1300, 800); await c.key('Escape');   // same warm-up as the layout the dot coordinates were taken from
      const p = c.page; await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 500, button: 'left', buttons: 1, clickCount: 1, modifiers: 1 });
      await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 700, y: 500, button: 'left', clickCount: 1, modifiers: 1 }); await c.sleep(500);
      await c.key('F10'); await c.sleep(800);
      await p.mouse('mouseMoved', 635, 574); await c.sleep(400); await p.mouse('mousePressed', 635, 574); await c.sleep(200); for (let i = 1; i <= 8; i++) { await p.mouse('mouseMoved', 635 - i * 8, 574 + i * 2); await c.sleep(60); } await c.sleep(500);   // the X end dot at the left of the ball
    } },
  { name: 'navigation-viewcube', caption: 'The view cube in the top right corner with the Fit and projection buttons beside it, the model in the Iso view.',
    async run(c) { await c.open({ sample: 'mounting-plate' }); await c.key('7'); await c.key('z'); await c.sleep(800); return { x: 300, y: 195, w: 1140, h: 520 }; } },
  { name: 'text-panel', caption: 'The Text tool open in a sketch with the text panel (characters, cap height, font, anchor grid, on an arc) and the lettering RPM x100 laid along an arc.',
    async run(c) {
      await c.open({}); if (!(await c.click('button', 'Sketch on Front Plane'))) c.skip('no start card'); await c.settle(1200); await c.key('n');
      await c.key('q'); await c.page.click(720, 560); await c.sleep(800);
      if (!(await c.fillField('Characters', 'RPM x100'))) c.skip('no Characters field');
      if (!(await c.fillField('Cap height', '8'))) c.skip('no Cap height field');
      if (!(await c.click('label', 'On an arc'))) c.skip('no On an arc'); await c.sleep(1000);
      return { x: 0, y: 80, w: 1440, h: 788 };
    } },
];


/** The tutorial plate: 60 x 40 x 10 with a hole at the centre of its front face (hole feature included when `hole`). */
export const tutorialPlate = ({ hole = true } = {}) => {
  const plate = rectSketch('F1', 'Plate outline', 'front', 60, 40, { cx: -30, cy: -20 });
  const hs = { type: 'sketch', id: 'F3', name: 'Hole centre', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'h', x: 0, y: 0 }], entities: [{ id: 'e1', type: 'point', p: 'h' }], constraints: [] };
  return newDoc('Part1', [plate, { type: 'extrude', id: 'F2', name: 'Extrude', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }, ...(hole ? [hs, { type: 'hole', id: 'F4', name: 'Hole', sketch: 'F3', kind: 'simple', size: 'M6', fit: 'normal', end: 'through' }] : [])]);
};

export const boxWithCircle = () => {
  const base = rectSketch('F1', 'Block outline', 'front', 80, 50, { cx: -40, cy: -25 });
  const circ = { type: 'sketch', id: 'F3', name: 'Circle', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'k', x: 0, y: 0 }], entities: [{ id: 'k1', type: 'circle', c: 'k', r: 12 }], constraints: [] };
  return newDoc('Block', [base, { type: 'extrude', id: 'F2', name: 'Block', op: 'add', sketch: 'F1', end: 'blind', depth: 20 }, circ]);
};

/** A bracket plate with two holes (one threaded), a rim fillet and, optionally, a failing extra hole or a broken first extrude. */
export const bracketDoc = ({ failing = false, breakExtrude = false } = {}) => {
  const plate = rectSketch('F1', 'Plate outline', 'front', 60, 40, { cx: -30, cy: -20 });
  const pts = { type: 'sketch', id: 'F3', name: 'Hole centres', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'h1', x: -15, y: 0 }, { id: 'h2', x: 15, y: 0 }], entities: [{ id: 'e1', type: 'point', p: 'h1' }, { id: 'e2', type: 'point', p: 'h2' }], constraints: [] };
  const rim = (a, x, y) => ({ faces: ['F2.C1', 'F2.S.' + a], at: [x, y, 12] });
  const bad = { type: 'sketch', id: 'F7', name: 'Spare hole', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'g', x: 0, y: 12 }], entities: [{ id: 'e1', type: 'point', p: 'g' }], constraints: [] };
  const f = [plate, { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: breakExtrude ? 'F99' : 'F1', end: 'blind', depth: 12 }, pts,
    { type: 'hole', id: 'F4', name: 'Mounting holes', sketch: 'F3', kind: 'simple', standard: 'iso', size: 'M5', fit: 'tap', end: 'through' },
    { type: 'thread', id: 'F5', name: 'M5 thread', face: 'F4.S.h1~1', standard: 'metric', size: 'M5', class: '6H', length: 'full', hand: 'right', modeled: false },
    { type: 'fillet', id: 'F6', name: 'Rim fillet', radius: 3, edges: [rim('e1', 0, -20), rim('e2', 30, 0), rim('e3', 0, 20), rim('e4', -30, 0)] },
    ...(failing ? [bad, { type: 'hole', id: 'F8', name: 'Spare hole', sketch: 'F7', kind: 'simple', size: 'M6', fit: 'normal', end: 'through', flip: true }] : [])];
  return newDoc('Bracket', f);
};
