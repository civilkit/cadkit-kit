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
  { name: 'settings-kernel', caption: 'Settings window, Kernel tab, with Local service chosen: the service address, an access token field (the token is hidden; the picture uses a made-up one), Test connection and the status line.',
    async run(c) {
      await c.open({ sample: 'mounting-plate' });
      await c.page.eval(`localStorage.setItem('cad.settingsTab', JSON.stringify('kernel')); 0`);
      if (!(await c.click('button', 'Workspace settings'))) c.skip('no settings button'); await c.sleep(600);
      if (!(await c.click('[role=tab], button', 'Kernel'))) c.skip('no Kernel tab'); await c.sleep(400);
      if (!(await c.selectOption('Kernel to use', 'Local service (faster, runs on this computer)'))) c.skip('no kernel select'); await c.sleep(500);
      if (!(await c.fillField('Access token', 'example-token-not-real'))) c.skip('no token field'); await c.sleep(400);
      const r = await c.rect('[role=dialog]'); if (!r) c.skip('no dialog');
      return { x: r.x - 8, y: r.y - 8, w: r.w + 16, h: r.h - 28 };
    } },
  { name: 'interface-overview', caption: 'The default CadKit window with a small part open: top bar, ribbon, feature tree, viewport with view cube, and status bar.',
    async run(c) { await c.open({ sample: 'mounting-plate' }); await c.sleep(4500); } },
  { name: 'first-part-start', caption: 'A new empty part with the Start here card offering three Sketch on plane buttons.',
    async run(c) { await c.open({}); if (!(await c.find('button', 'Sketch on Front Plane'))) c.skip('no start card'); } },
  { name: 'first-part-dimensioned', caption: 'A rectangle sketch on the Front plane with 60 and 40 dimensions and the status chip showing the remaining degrees of freedom.',
    async run(c) {
      await c.open({ doc: newDoc('Part1', [rectSketch('F1', 'Sketch 1', 'front', 60, 40, { cx: -30, cy: -20 })]) });
      if (!(await c.editRow('Sketch 1'))) c.skip('no sketch row'); await c.viewport(1960, 900); await c.key('n'); await c.page.click(1000, 820); await c.settle(1200); await c.sleep(4000);
    } },

  { name: 'sketch-editor-open', caption: 'A sketch open on the top face of a plate: the Editing tab of the ribbon, the faded body, the status chip, and the pointer coordinates in the status bar.',
    async run(c) {
      const plate = rectSketch('F1', 'Base', 'front', 80, 50, { dims: true });
      const face = { type: 'sketch', id: 'F3', name: 'Face sketch', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'k', x: 40, y: 25 }, { id: 'k2', x: 55, y: 25 }], entities: [{ id: 'k1', type: 'circle', c: 'k', r: 10 }], constraints: [] };
      await c.open({ doc: newDoc('Plate', [plate, { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 12 }, face]) });
      await c.viewport(1960, 900);
      if (!(await c.editRow('Face sketch'))) c.skip('no sketch row'); await c.settle(1200);
      await c.page.mouse('mouseMoved', 700, 560); await c.sleep(300);
    } },
  { name: 'sketch-bar', caption: 'The one-row sketch bar at the top of an open sketch: the Editing tab, then Select, Finish, Make, Draw, Dimension, Constrain, Modify and Reference tools, and the degrees-of-freedom chip with Fully define, Sketch Report, Snaps and Look normal at the right.',
    async run(c) {
      await c.open({ doc: newDoc('Part1', [rectSketch('F1', 'Sketch 1', 'front', 60, 40, { cx: -30, cy: -20 })]) }); await c.viewport(1960, 900);
      if (!(await c.editRow('Sketch 1'))) c.skip('no sketch row'); await c.key('n'); await c.settle(1500);
      return { x: 0, y: 46, w: 1960, h: 110 };
    } },
  { name: 'constraints-list-open', caption: 'A dimensioned bracket sketch with relation glyphs in the view and the Constraints list opened from the status chip.',
    async run(c) {
      await c.open({ sample: 'parametric-bracket' }); await c.viewport(2100, 900);
      if (!(await c.editRow('Plate outline'))) c.skip('no sketch row'); await c.settle(1200); await c.key('n'); await c.sleep(600);
      if (!(await c.click('button', 'Fully defined')) && !(await c.click('button', 'DOF'))) c.skip('no status chip'); await c.settle(600);
    } },
  { name: 'sketch-tools-palette', caption: 'The Draw group of the sketch ribbon with the Rectangle flyout open, listing the tool names and their keys.',
    async run(c) {
      await c.open({ doc: newDoc('Part1', [rectSketch('F1', 'Sketch 1', 'front', 60, 40, { cx: -30, cy: -20 })]) }); await c.viewport(1960, 900);
      if (!(await c.editRow('Sketch 1'))) c.skip('no sketch row'); await c.settle(1000);
      const r = await c.find('button', 'More tools like Rectangle'); if (!r) c.skip('no flyout arrow'); await c.page.click(r.x, r.y); await c.sleep(500);
      return { x: 300, y: 74, w: 420, h: 250 };
    } },
  { name: 'ribbon-tabs', caption: 'The ribbon with the Home tab selected and the Extrude button flyout open, showing Extruded cut.',
    async run(c) {
      await c.open({ sample: 'mounting-plate' });
      const r = await c.find('button', 'More tools like Extrude'); if (!r) c.skip('no flyout arrow'); await c.page.click(r.x, r.y); await c.sleep(500);
      return { x: 0, y: 46, w: 700, h: 181 };
    } },
  { name: 'tab-strip', caption: 'The top bar with three open parts as document tabs, the first marked as changed, the Part / Drawing switch and command search at the right, and the ribbon tabs underneath.',
    async run(c) {
      await c.open({ sample: 'mounting-plate' });
      for (let i = 0; i < 2; i++) { if (!(await c.click('button', 'New part in a new tab'))) c.skip('no new tab button'); await c.settle(800); }
      await c.sleep(2000); return { x: 0, y: 0, w: 1440, h: 78 };
    } },

  { name: 'extrude-editor', caption: 'A block with a circle sketch on its top face and the Extrude editor open in the left panel, with End condition, Operation and Options sections and the preview in the view.',
    async run(c) {
      await c.open({ doc: boxWithCircle() });
      if (!(await c.selRow('Circle'))) c.skip('no sketch row');
      if (!(await c.click('button', 'Extrude'))) c.skip('no extrude button'); await c.settle(1200);
      return { x: 0, y: 46, w: 1160, h: 824 };
    } },

  { name: 'thin-wall', caption: 'A C-shaped open spline extruded as a thin wall, with the Thin wall section of the Extrude editor open showing Wall thickness, Side and End caps.',
    async run(c) {
      const pts = [[30, 20], [10, 28], [-10, 24], [-25, 8], [-25, -8], [-10, -24], [10, -28], [30, -20]].map(([x, y], i) => ({ id: 'p' + i, x, y }));
      const sk = { type: 'sketch', id: 'F1', name: 'C curve', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...pts], entities: [{ type: 'spline', id: 'e1', pts: pts.map((p) => p.id), closed: false }], constraints: [] };
      await c.open({ doc: newDoc('C wall', [sk, { type: 'extrude', id: 'F2', name: 'Wall', op: 'add', sketch: 'F1', end: 'blind', depth: 30, thin: { thickness: 3, side: 'mid', ends: 'flat', cornerStyle: 'mitre' } }]) });
      if (!(await c.editRow('Wall'))) c.skip('no extrude row'); await c.settle(1200); await c.scrollPanel('bottom');
      return { x: 0, y: 46, w: 1160, h: 824 };
    } },
  { name: 'loft-editor', caption: 'Three square sketches on offset planes lofted into a tapered solid, with the Profiles list showing three rows and the Guide curves section below.',
    async run(c) {
      const sq = (id, name, plane, r) => ({ type: 'sketch', id, name, plane, points: [{ id: 'a', x: -r, y: -r }, { id: 'b', x: r, y: -r }, { id: 'c', x: r, y: r }, { id: 'd', x: -r, y: r }], entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']].map(([i, p, q]) => ({ id: i, type: 'line', p1: p, p2: q })), constraints: [] });
      const f = [sq('F1', 'Base square', { kind: 'std', id: 'top' }, 25), { type: 'plane', id: 'F2', name: 'Plane 1', mode: 'offset', base: { kind: 'std', id: 'top' }, offset: 30 }, sq('F3', 'Middle square', { kind: 'feature', id: 'F2' }, 17),
        { type: 'plane', id: 'F4', name: 'Plane 2', mode: 'offset', base: { kind: 'std', id: 'top' }, offset: 60 }, sq('F5', 'Top square', { kind: 'feature', id: 'F4' }, 9), { type: 'loft', id: 'F6', name: 'Taper', op: 'add', sketches: ['F1', 'F3', 'F5'] }];
      await c.open({ doc: newDoc('Loft', f) });
      if (!(await c.editRow('Taper'))) c.skip('no loft row'); await c.settle(1500);
      return { x: 0, y: 46, w: 1160, h: 824 };
    } },
  { name: 'fillet-editor', caption: 'A plate with three edges around its top corner selected and the Fillet editor open showing Variable radius, Radius, Profile and Tangent chain.',
    async run(c) {
      await c.open({ doc: tutorialPlate({ hole: false }) });
      await c.key('e'); await c.page.click(722, 416); await c.sleep(300);
      await c.clickMod(878, 623, { shift: true }); await c.clickMod(920, 465, { shift: true });
      if (!(await c.click('button', 'Fillet'))) c.skip('no fillet button'); await c.settle(800);
      if (!(await c.fillField('Radius', '4'))) c.skip('no radius field'); await c.settle(800);
      return { x: 0, y: 46, w: 1160, h: 824 };
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
      await c.key('e'); await c.page.click(886, 610); await c.sleep(400);
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
      return { x: 0, y: 152, w: 1440, h: 600 };
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
      await c.scrollPanel('bottom'); return { x: 0, y: 46, w: 1160, h: 824 };
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
      return { x: 0, y: 46, w: 1160, h: 824 };
    } },
  { name: 'reference-plane', caption: 'A block with a reference plane drawn 10 mm above its top face and the Plane editor open showing Mode, Offset and Base plane.',
    async run(c) {
      const base = rectSketch('F1', 'Block outline', 'front', 80, 50, { cx: -40, cy: -25 });
      await c.open({ doc: newDoc('Plane demo', [base, { type: 'extrude', id: 'F2', name: 'Block', op: 'add', sketch: 'F1', end: 'blind', depth: 20 }, { type: 'plane', id: 'F3', name: 'Plane 1', mode: 'offset', base: { kind: 'face', id: 'F2.C1' }, offset: 10 }]) });
      if (!(await c.editRow('Plane 1'))) c.skip('no plane row'); await c.settle(1000);
      return { x: 0, y: 46, w: 1160, h: 824 };
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
      return { x: 0, y: 46, w: 1160, h: 824 };
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
      return { x: 0, y: 154, w: 1160, h: 678 };
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
  { name: 'navigation-viewcube', caption: 'The view cube in the top right corner with its arrow ring, and the Fit and projection buttons under it, the model in the Iso view.',
    async run(c) { await c.open({ sample: 'mounting-plate' }); await c.key('7'); await c.key('z'); await c.sleep(800); return { x: 300, y: 157, w: 1140, h: 520 }; } },
  { name: 'text-panel', caption: 'The Text tool open in a sketch with the text panel (characters, cap height, font, anchor grid, on an arc) and the lettering RPM x100 laid along an arc.',
    async run(c) {
      await c.open({}); if (!(await c.click('button', 'Sketch on Front Plane'))) c.skip('no start card'); await c.settle(1200); await c.key('n');
      await c.key('q'); await c.page.click(720, 560); await c.sleep(800);
      if (!(await c.fillField('Characters', 'RPM x100'))) c.skip('no Characters field');
      if (!(await c.fillField('Cap height', '8'))) c.skip('no Cap height field');
      if (!(await c.click('label', 'On an arc'))) c.skip('no On an arc'); await c.sleep(1000);
      return { x: 0, y: 46, w: 1440, h: 822 };
    } },

  // ---- pages written after the audit: bodies (Cut from), curves, measure, history, surfaces, interface, wizards ----

  { name: 'cut-from', caption: 'The Extrude editor with Operation set to Cut and a Cut from group listing All bodies the shape reaches and one tick per named body.',
    async run(c) {
      const plate = rectSketch('F1', 'Plate outline', 'front', 80, 50, { cx: -40, cy: -25 });
      const block = rectSketch('F3', 'Block outline', 'front', 24, 24, { cx: 60, cy: -12 });
      // a pocket sketched on the block's top face: the cut reaches the named body it is aimed at
      const pocket = { type: 'sketch', id: 'F5', name: 'Pocket outline', plane: { kind: 'face', id: 'F4.C1' },
        points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: -6, y: -4 }, { id: 'b', x: 6, y: -4 }, { id: 'c', x: 6, y: 4 }, { id: 'd', x: -6, y: 4 }],
        entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']].map(([i, p, q]) => ({ id: i, type: 'line', p1: p, p2: q })), constraints: [] };
      const f = [plate, { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 8 },
        block, { type: 'extrude', id: 'F4', name: 'Block', op: 'newBody', body: 'Block', sketch: 'F3', end: 'blind', depth: 24 },
        pocket, { type: 'extrude', id: 'F6', name: 'Pocket', op: 'cut', sketch: 'F5', end: 'blind', depth: 4, flip: true, target: [{ body: 'Block' }] }];
      await c.open({ doc: newDoc('Cut from', f) });
      if (!(await c.editRow('Pocket'))) c.skip('no Pocket row'); await c.settle(1200);
      await c.scrollPanel('top');
      return { x: 0, y: 46, w: 1160, h: 824 };
    } },

  { name: 'edit-curve-editor', caption: 'A two-line chain rebuilt as one smooth curve, with the Edit curve editor open showing the Curves list, Rebuild and Control point edits.',
    async run(c) {
      const plate = rectSketch('F1', 'Plate outline', 'front', 60, 40, { cx: -30, cy: -20 });
      // the chain floats on a plane above the plate, so the rebuilt curve is in front of the solid
      const chain = { type: 'sketch', id: 'F4', name: 'Corner chain', plane: { kind: 'feature', id: 'F3' },
        points: [{ id: 'a', x: 5, y: 5 }, { id: 'b', x: 20, y: 20 }, { id: 'c', x: 35, y: 5 }],
        entities: [['k1', 'a', 'b'], ['k2', 'b', 'c']].map(([i, p, q]) => ({ id: i, type: 'line', p1: p, p2: q })), constraints: [] };
      const f = [plate, { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 10 },
        { type: 'plane', id: 'F3', name: 'Plane 1', mode: 'offset', base: { kind: 'face', id: 'F2.C1' }, offset: 2 }, chain,
        { type: 'editCurve', id: 'F5', name: 'Edit curve', curves: [{ kind: 'sketchCurve', sketch: 'F4', entity: 'k1' }, { kind: 'sketchCurve', sketch: 'F4', entity: 'k2' }],
          method: 'tolerance', degree: 3, tolerance: 0.01, keepEnds: true, keepCorners: true, entries: [{ cv: 2, dx: 0, dy: 0, dz: 6 }] }];
      await c.open({ doc: newDoc('Curve chain', f) });
      if (!(await c.editRow('Edit curve'))) c.skip('no Edit curve row'); await c.settle(1200);
      return { x: 0, y: 46, w: 1160, h: 824 };
    } },

  { name: 'project-curve-editor', caption: 'A plate with one face picked and the Project curve editor open, showing Project, Onto faces, Direction, Degree and Fit tolerance.',
    async run(c) {
      const plate = rectSketch('F1', 'Plate outline', 'front', 80, 50, { cx: -40, cy: -25 });
      const polyline = { type: 'sketch', id: 'F3', name: 'Curve sketch', plane: { kind: 'std', id: 'front' },
        points: [{ id: 'a', x: 5, y: 5 }, { id: 'b', x: 20, y: 20 }, { id: 'c', x: 35, y: 5 }],
        entities: [['k1', 'a', 'b'], ['k2', 'b', 'c']].map(([i, p, q]) => ({ id: i, type: 'line', p1: p, p2: q })), constraints: [] };
      const f = [plate, { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }, polyline,
        { type: 'projectCurve', id: 'F4', name: 'Project curve', sketch: 'F3', faces: ['F2.C1'], degree: 3, tolerance: 0.001, direction: 'both' }];
      await c.open({ doc: newDoc('Projected curve', f) });
      if (!(await c.editRow('Project curve'))) c.skip('no Project curve row'); await c.settle(1200);
      return { x: 0, y: 46, w: 1160, h: 824 };
    } },

  { name: 'freeform-editor', caption: 'A wavy surface with one face picked, the Freeform editor open on the left, and the face rebuilt as a net with a control point lifted.',
    async run(c) {
      // The kernel returns the rebuilt face's net as a marker, but the viewport draws no markers (ViewBody.markers is only
      // typed, never read: packages/viewport/src/viewport.ts:59), so "the net with a control point lifted" cannot be shown.
      c.skip('the Freeform control net is not drawn in the view: markers are not rendered');
    } },

  { name: 'quick-measure', caption: 'The bottom-right corner of the view with the quick readout card showing the diameter, radius and circumference of a picked circular edge.',
    async run(c) {
      const plate = rectSketch('F1', 'Plate outline', 'front', 80, 50, { cx: -40, cy: -25 });
      const hole = { type: 'sketch', id: 'F3', name: 'Hole centre', plane: { kind: 'face', id: 'F2.C1' },
        points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 10 }], constraints: [] };
      await c.open({ doc: newDoc('Quick measure', [plate, { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 8 },
        hole, { type: 'extrude', id: 'F4', name: 'Hole', op: 'cut', sketch: 'F3', end: 'through', flip: true }]) });
      // face-on: the hole's rim is a closed circle centred in the view, so a ray from the centre crosses it first
      await c.key('2'); await c.key('z'); await c.settle(900); await c.key('e'); await c.settle(400);
      const cv = await c.canvasRect(); if (!cv) c.skip('no canvas');
      const cx = cv.x + cv.w / 2, cy = cv.y + cv.h / 2;
      let hit = null;
      for (let d = 3; d < Math.min(cv.w, cv.h) * 0.45 && !hit; d += 2) {
        await c.page.mouse('mouseMoved', cx + d, cy); await c.sleep(70);
        if (await c.page.eval(`!!document.querySelector('.st-hover')`)) hit = { x: cx + d, y: cy };
      }
      if (!hit) c.skip('no edge under the pointer ray');
      const cardText = () => c.page.eval(`(document.querySelector('.quick-measure')?.textContent || '').replace(/\\s+/g, ' ')`);
      let got = false;
      for (const dx of [0, -3, 3, -6, 6]) {
        await c.page.click(hit.x + dx, hit.y); await c.settle(700);
        if ((await cardText()).includes('Circumference')) { got = true; break; }
        await c.key('Escape'); await c.settle(300);
      }
      if (!got) c.skip('the quick readout did not answer for a circular edge');
      const vp = await c.rect('#vp');
      return vp ? { x: Math.max(0, vp.x + vp.w - 620), y: Math.max(0, vp.y + vp.h - 330), w: 620, h: 330 } : null;
    } },

  { name: 'repeat-last', keepPointer: true, caption: "The Home ribbon's Edit group with the cursor on Repeat last command, after a fillet was applied.",
    async run(c) {
      await c.open({ doc: tutorialPlate({ hole: false }) });
      await c.key('e'); await c.page.click(886, 610); await c.sleep(400);
      if (!(await c.click('button', 'Fillet'))) c.skip('no fillet button'); await c.settle(800);
      if (!(await c.fillField('Radius', '5'))) c.skip('no radius field'); await c.settle(800);
      if (!(await c.click('button', 'Confirm'))) c.skip('no confirm'); await c.settle(1000);
      const r = await c.find('button', 'Repeat last command'); if (!r) c.skip('no Repeat last command button');
      await c.page.mouse('mouseMoved', r.x, r.y); await c.sleep(700);
      return { x: 0, y: 46, w: 1440, h: 186 };
    } },

  { name: 'thicken-variable', caption: 'The Thicken editor with Variable thickness ticked, Ramp along set to Z axis, and two stops: position 0 at 4 mm and position 10 at 2 mm.',
    async run(c) {
      const wave = { type: 'sketch', id: 'F1', name: 'Blade curve', plane: { kind: 'std', id: 'front' },
        points: [{ id: 'w1', x: -30, y: -12 }, { id: 'w2', x: -15, y: -4 }, { id: 'w3', x: 0, y: -16 }, { id: 'w4', x: 15, y: 2 }, { id: 'w5', x: 30, y: -10 }],
        entities: [{ id: 'sp', type: 'spline', pts: ['w1', 'w2', 'w3', 'w4', 'w5'], closed: false }], constraints: [] };
      // thickness 4 is the ramp's first stop; the second is half of it (surfaceRules.ts:87, patchThickenVariable)
      const f = [wave, { type: 'surfaceExtrude', id: 'F2', name: 'Blade sheet', sketch: 'F1', end: 'blind', depth: 10 },
        { type: 'thicken', id: 'F3', name: 'Thicken', surface: 'F2', thickness: 4, side: 'front', thicknessAt: { along: [0, 0, 1], stops: [[0, 4], [10, 2]] } }];
      await c.open({ doc: newDoc('Tapered sheet', f) });
      if (!(await c.editRow('Thicken'))) c.skip('no Thicken row'); await c.settle(1500);
      await c.scrollPanel('top');
      return { x: 0, y: 46, w: 1160, h: 824 };
    } },

  { name: 'tool-rail', caption: 'The tool rail down the left edge of the view, with the Create section opened on its flyout.',
    async run(c) {
      await c.open({ sample: 'mounting-plate', workspace: 'plasticity' }); await c.settle(900);
      const r = await c.find('button', 'More tools like Extrude'); if (!r) c.skip('no flyout arrow on the rail'); await c.page.click(r.x, r.y); await c.sleep(700);
      return { x: 260, y: 46, w: 470, h: 680 };
    } },

  { name: 'wizard-screw', caption: 'The Screw wizard open in the left panel with an M3 pan-head screw previewed on the top plane, showing Size, Length, Head, Drive, Bearing face centre and Shank points.',
    async run(c) {
      await c.open({}); if (!(await c.panelTab('Catalog'))) c.skip('no Catalog tab'); await c.click('[role=tab]', 'Primitives'); await c.settle(600);
      if (!(await c.click('button', 'Screw'))) c.skip('no Screw button'); await c.settle(2500);
      await c.key('z'); await c.settle(1200);
    } },

  { name: 'wizard-washer', caption: 'The Washer wizard open in the left panel with the Standard list filtered to M8 and an M8 flat washer previewed.',
    async run(c) {
      await c.open({}); if (!(await c.panelTab('Catalog'))) c.skip('no Catalog tab'); await c.click('[role=tab]', 'Primitives'); await c.settle(600);
      if (!(await c.click('button', 'Washer'))) c.skip('no Washer button'); await c.settle(2500);
      const f = await c.find('[data-testid="washer-size-filter"]'); if (!f) c.skip('no size filter'); await c.page.click(f.x, f.y); await c.type('M8'); await c.settle(800);
      await c.click('[data-row="iso7089-M8"]'); await c.settle(1500);
      await c.page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.title === 'Fit'); if (b) b.click(); return 0; })()`); await c.settle(800);
    } },

  // ---- sheet metal: the chapter's rule, flange, flat pattern and DXF options ----

  { name: 'sheet-rule-editor', caption: 'The Rules editor on the Sheet metal tab: the Stock section (rule name, thickness, k-factor, bend radius) and the Relief section (relief width and depth, corner relief and its shape, the gaps).',
    async run(c) {
      await c.open({ doc: sheetTray() });
      if (!(await c.editRow('Tray 2 mm'))) c.skip('no rule row'); await c.settle(1200);
      await c.scrollPanel('top');
      return { x: 0, y: 46, w: 1160, h: 824 };
    } },

  { name: 'sheet-edge-flange-editor', caption: 'The Edge flange editor with four edges picked: Height, Angle, Bend radius, Height measured and Flange position, with the four legs previewed on the plate.',
    async run(c) {
      await c.open({ doc: sheetTray() });
      if (!(await c.editRow('Edge flange'))) c.skip('no edge flange row'); await c.settle(1200);
      return { x: 0, y: 46, w: 1160, h: 824 };
    } },

  { name: 'sheet-flat-pattern', caption: 'The flat pattern panel for the tray: the blank outline and bend zones, the bend lines B1 to B5 with their angles, the blank size and rule, the bend table and the three export buttons.',
    async run(c) {
      await c.open({ doc: sheetTray({ hem: true }) }); await c.settle(900);
      if (!(await c.click('.rb-tab', 'Sheet metal'))) c.skip('no Sheet metal tab');
      if (!(await c.click('button', 'Flat pattern'))) c.skip('no Flat pattern button'); await c.settle(2000);
      const r = await c.rect('.sheet-flat'); if (!r) c.skip('no flat pattern panel');
      const top = Math.max(0, r.y - 8);
      return { x: Math.max(0, r.x - 8), y: top, w: r.w + 16, h: Math.min(r.h + 16, 892 - top) };
    } },

  { name: 'sheet-dxf-options', caption: 'The Flat pattern DXF dialog: DXF version, units, layers, layer names, bend lines, tangent lines and bend notes.',
    async run(c) {
      await c.open({ doc: sheetTray({ hem: true }) }); await c.settle(900);
      if (!(await c.click('.rb-tab', 'Sheet metal'))) c.skip('no Sheet metal tab');
      if (!(await c.click('button', 'Flat pattern'))) c.skip('no Flat pattern button'); await c.settle(2000);
      if (!(await c.click('button', 'Flat pattern DXF'))) c.skip('no DXF button'); await c.settle(800);
      const r = await c.rect('.sheet-dxf-dlg'); if (!r) c.skip('no DXF dialog');
      return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), w: r.w + 16, h: r.h - 28 };
    } },
  { name: 'import-skp', caption: 'A SketchUp file imported as a Reference mesh, with the chair and table test file from the OpenSKP project (MIT): the chair and table in the viewport in their SketchUp colours, the imported mesh listed in the feature tree as chair_and_table (mesh), and the open-surface warning in the status bar.',
    async run(c) {
      const path = process.env.SKP_FIXTURE; if (!path) c.skip('SKP_FIXTURE is not set (path to chair_and_table.skp from the OpenSKP test files)');
      const b64 = (await import('node:fs')).readFileSync(path).toString('base64');
      await c.open({ doc: newDoc('Imported SketchUp model', []) });
      // the same path as a file dropped on the window: a synthetic drop event carrying the file
      await c.page.eval(`(() => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([u], 'chair_and_table.skp')); for (const t of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true })); return 0; })()`);
      await c.sleep(800);
      if (!(await c.click('[data-testid=import-kind-ok]'))) c.skip('no import choice box');
      await c.settle(2500);
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

/** The tray of the sheet metal chapter: 100 x 60 of 2 mm stock, four 15 mm edge flanges and, optionally, a hem on the first leg's tip. */
export const sheetTray = ({ hem = false, relief = 'round' } = {}) => {
  const rule = { type: 'sheetRules', id: 'R1', name: 'Tray 2 mm', thickness: 2, kFactor: 0.44, bendRadius: 2, reliefWidth: 2, reliefDepth: 1, cornerRelief: 4, cornerReliefShape: relief, gap: 2, hemGap: 0.01, active: true };
  const base = { type: 'baseFlange', id: 'B1', name: 'Base flange', sketch: 'S1', rule: 'Tray 2 mm' };
  const flange = { type: 'edgeFlange', id: 'E1', name: 'Edge flange', edges: [[50, 0, 2], [100, 30, 2], [50, 60, 2], [0, 30, 2]], height: 15, angle: 90, radius: 2, heightFrom: 'outer', position: 'inside' };
  const rim = { type: 'hem', id: 'H1', name: 'Hem', edges: ['P1.tip'], length: 5, gap: 0.01 };
  return newDoc('Tray', [rectSketch('S1', 'Tray outline', 'front', 100, 60), rule, base, flange, ...(hem ? [rim] : [])]);
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
