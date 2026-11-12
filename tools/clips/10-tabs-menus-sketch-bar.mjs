// Document tabs in the top bar, the right-click menus (a feature in the tree, a plane, an open sketch) and the one-row sketch bar.
const PRESET = { ribbon: 'off', leftPanel: 'docked', leftTabs: true, leftCollapsed: false, rightPanel: 'off', toolRail: true, sketchPalette: false, toolLabels: 'icons-and-text', selectionBar: true, commandBar: true, drawerOpen: false, handles: true, opacity: 0.62, blur: 14, lineWidth: 3 };
const row = (re) => `[...document.querySelectorAll('.tree .row')].find((e) => ${re}.test(e.querySelector('.row-name')?.textContent ?? ''))`;
const menuRow = (re) => `[...document.querySelectorAll('.ctx-menu button, .ctx-menu [role=menuitem]')].find((e) => ${re}.test(e.textContent))`;
export default {
  id: 'tabs-menus-sketch-bar',
  async run(rec, ctx) {
    const rightClick = async (expr, dx = 0) => {
      const [x0, y] = await rec.rect(expr); const x = x0 + dx;
      await rec.glide(x, y); await rec.wait(200);
      await rec.page.mouse('mousePressed', x, y, 'right'); await rec.page.mouse('mouseReleased', x, y, 'right');
      await rec.waitFor(`!!document.querySelector('.ctx-menu')`, 'the menu');
      await rec.paint();
    };
    // the layout with the tool rail and the sketch bar (the first-visit layout has the ribbon carry the sketch tools)
    await ctx.openApp();
    await ctx.page.eval(`localStorage.setItem('cad.workspace', ${JSON.stringify(JSON.stringify(PRESET))})`);
    await ctx.openApp();
    // the sample by its name (it has no thumbnail file to find it by)
    await ctx.page.eval(`document.querySelector('button[aria-label="Library"]').click()`);
    await rec.waitFor(`[...document.querySelectorAll('.dlg-item')].some((e) => /Mounting plate/.test(e.textContent))`, 'the library');
    await ctx.page.eval(`[...document.querySelectorAll('.dlg-item')].find((e) => /Mounting plate/.test(e.textContent)).click()`);
    await rec.waitFor(`/Mounting plate/.test(document.querySelector('.topbar .tab.active')?.textContent ?? '') && document.querySelectorAll('.tree .row[data-id]').length > 2`, 'the part to load');
    await new Promise((r) => setTimeout(r, 1500));
    await rec.begin();
    await rec.wait(900);
    // a second document: its tab stands in the top bar
    await rec.click(`document.querySelector('.topbar [data-action="new-tab"]')`);
    await rec.waitFor(`document.querySelectorAll('.topbar .tab').length === 2`, 'the second tab');
    await rec.wait(1300);
    await rec.click(`document.querySelector('.topbar .tab:not(.active)')`);
    await rec.waitFor(`/Mounting plate/.test(document.querySelector('.topbar .tab.active')?.textContent ?? '')`, 'the first tab');
    await rec.wait(1300);
    // a feature's menu
    await rightClick(row('/^Extrude/'), -20);
    await rec.wait(2200);
    await rec.key('Escape');
    await rec.wait(500);
    // a plane's menu starts a sketch
    await rightClick(`document.querySelector('[data-ref="front"]')`, -40);
    await rec.wait(1300);
    await rec.click(menuRow('/Sketch on this plane/'));
    await rec.waitFor(`!!document.querySelector('.sketch-bar')`, 'the sketch bar');
    await rec.wait(2200);
    // the sketch's own menu
    const [cx, cy] = await rec.rect(`document.querySelector('#vp canvas')`);
    await rec.glide(cx + 190, cy + 40); await rec.wait(200);
    await rec.page.mouse('mousePressed', cx + 190, cy + 40, 'right'); await rec.page.mouse('mouseReleased', cx + 190, cy + 40, 'right');
    await rec.waitFor(`!!document.querySelector('.ctx-menu')`, 'the sketch menu');
    await rec.wait(1400);
    rec.mark('poster');
    await rec.wait(1400);
    await rec.click(menuRow('/Cancel sketch/'));
    await rec.waitFor(`!document.querySelector('.sketch-bar')`, 'the sketch to close');
    await rec.wait(1800);
    return rec.finish('tabs-menus-sketch-bar', ctx.outDir, ctx.posterDir);
  },
};
