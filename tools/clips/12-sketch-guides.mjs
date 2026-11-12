// Midpoint alignment guides in a sketch, and the value box that grows with a typed formula: draw two lines, bring the pointer in line with the
// middle of each (a dotted guide) and with both at once (the crossing), then type a long formula into the length box of a new line.
// The sketch redraws on every pointer event, which can take a while on a busy machine, so each move, click and key is made inside rec.skip
// (its time is cut) and the clip holds between them for a fixed, readable time: the pace of the clip does not depend on the machine.
const PRESET = { ribbon: 'off', leftPanel: 'docked', leftTabs: true, leftCollapsed: false, rightPanel: 'off', toolRail: true, sketchPalette: false, toolLabels: 'icons-and-text', selectionBar: true, commandBar: true, drawerOpen: false, handles: true, opacity: 0.62, blur: 14, lineWidth: 3 };
const menuRow = (re) => `[...document.querySelectorAll('.ctx-menu button, .ctx-menu [role=menuitem]')].find((e) => ${re}.test(e.textContent))`;
const FRONT = `[...document.querySelectorAll('.tree .row')].find((e) => /^Front Plane/.test(e.querySelector('.row-name')?.textContent ?? ''))`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default {
  id: 'sketch-guides',
  async run(rec, ctx) {
    const { page } = ctx;
    const T0 = Date.now();
    const log = (n) => { if (process.env.CLIP_TIME) console.error(((Date.now() - T0) / 1000).toFixed(1), n); };
    // ---- off camera: the layout, and two variables in the Variables panel
    await ctx.openApp();
    await page.eval(`localStorage.setItem('cad.workspace', ${JSON.stringify(JSON.stringify(PRESET))})`);
    await ctx.openApp();
    await rec.waitFor(`!!document.querySelector('[aria-label="Variables"]')`, 'the Variables tab'); await sleep(500);
    const tab = async (name) => { await page.eval(`document.querySelector('[aria-label="${name}"]').click()`); await sleep(600); };
    await tab('Variables');
    for (const [n, e] of [['width', '20'], ['wall', '3']]) {
      await page.eval(`document.querySelector('[data-testid="vars-add"]').click()`); await sleep(400);
      await page.eval(`(() => { const r = [...document.querySelectorAll('.vars-row[data-var]')].find((x) => /^var\\d+$/.test(x.dataset.var)); const i = r.querySelector('.vars-name'); i.focus(); i.select(); })()`);
      await page.send('Input.insertText', { text: n }); await page.key('Enter'); await sleep(500);
      await page.eval(`(() => { const i = document.querySelector('.vars-row[data-var="${n}"]').querySelectorAll('input')[1]; i.focus(); i.select(); })()`);
      await page.send('Input.insertText', { text: e }); await page.key('Enter'); await sleep(500);
    }
    await tab('Features');
    await page.mouse('mouseMoved', 700, 500); await sleep(500);
    // ---- the clip's own helpers
    const canvas = async () => { const [x, y, w, h] = await rec.rect(`document.querySelector('#vp canvas')`); return { x, y, w, h }; };
    /** one step made off the clock, then a short hold on the result (the pointer moving is itself a new frame; other steps force one) */
    const step = async (fn, hold = 130, still = true) => { await rec.skip(async () => { await fn(); if (still) await rec.paint(); await sleep(150); }); if (still) await rec.paint(); await sleep(hold); };
    const hop = (x, y) => step(async () => { await page.mouse('mouseMoved', x, y); rec.x = x; rec.y = y; }, 70, false);
    /** the pointer moves in n eased hops */
    const glide = async (x, y, n = 4) => { const x0 = rec.x, y0 = rec.y; for (let i = 1; i <= n; i++) { const k = i / n, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; await hop(x0 + (x - x0) * e, y0 + (y - y0) * e); } };
    const click = async (x, y, btn = 'left') => { await glide(x, y, 3); await step(async () => { await page.mouse('mousePressed', x, y, btn); await page.mouse('mouseReleased', x, y, btn); await sleep(200); }, 220); };
    const key = (k) => step(async () => { await page.eval(`document.activeElement?.blur?.(); 0`); await page.key(k); }, 120);
    const typeOut = async (text) => { for (const ch of text) await step(() => page.send('Input.insertText', { text: ch }), 170); };
    const waitUi = (expr, what) => rec.skip(() => rec.waitFor(expr, what));
    log('setup done');
    await rec.begin();
    await rec.wait(900);
    // ---- a sketch on a plane
    const [px, py] = await rec.rect(FRONT);
    rec.x = 640; rec.y = 400;
    await glide(px - 30, py, 4);
    await rec.wait(250);
    await step(async () => { await page.mouse('mousePressed', px - 30, py, 'right'); await page.mouse('mouseReleased', px - 30, py, 'right'); await rec.waitFor(`!!document.querySelector('.ctx-menu')`, 'the menu'); }, 1000);
    const [mx, my] = await rec.rect(menuRow('/Sketch on this plane/'));
    await click(mx, my);
    await waitUi(`!!document.querySelector('.sketch-bar')`, 'the sketch bar');
    await rec.wait(1300);
    log('sketch open');
    const c = await canvas();
    const at = (dx, dy) => [c.x + dx, c.y + dy];
    await key('l');
    // ---- two lines: line 1 low on the left, line 2 diagonal at the upper right
    const L1 = [at(-320, 190), at(-120, 190)], L2 = [at(80, -180), at(240, -20)];
    for (const [a, b] of [L1, L2]) { await click(a[0], a[1]); await glide(b[0], b[1], 4); await click(b[0], b[1]); await key('Escape'); await key('l'); }
    log('two lines');
    // ---- a third line: its start, then the pointer in line with the middle of line 1 (a vertical dotted guide); nothing is placed there
    const S = at(40, 90), g1 = at(-220, 30);
    await click(S[0], S[1]);
    await glide(g1[0] + 40, g1[1], 4); await glide(g1[0], g1[1], 2);
    log('guide 1 shown');
    await rec.wait(3300);
    rec.mark('poster');
    await rec.wait(300);
    await glide(g1[0] + 30, g1[1] - 30, 2);
    await key('Escape'); await key('l');
    // ---- another line from a free point: in line with the middle of line 1 and of line 2 at once, where the two guides cross
    const S2 = at(-290, 60), g2 = at(-220, -100);
    await click(S2[0], S2[1]);
    await glide(g2[0] + 60, g2[1] + 20, 4); await glide(g2[0], g2[1], 2);
    log('crossing shown');
    await rec.wait(3800);
    await click(g2[0], g2[1]);
    await key('Escape'); await key('l');
    // ---- a value box: a new line, a formula typed into its length box
    const T = at(-180, 250);
    await click(T[0], T[1]);
    await glide(T[0] + 160, T[1] - 30, 4);
    await waitUi(`!!document.querySelector('#vp .sketch-fields input')`, 'the value boxes');
    await rec.wait(900);
    await step(() => page.eval(`(() => { const i = document.querySelector('#vp .sketch-fields input'); i.focus(); i.select(); })()`), 500);
    log('typing');
    await typeOut('=width*2+wall');
    await rec.wait(2300);
    log('typed');
    await step(() => page.key('Enter'), 900);
    await click(rec.x, rec.y);
    await rec.wait(2300);
    log('done');
    if (process.env.CLIP_DRY) return { id: 'sketch-guides', dry: true };
    return rec.finish('sketch-guides', ctx.outDir, ctx.posterDir);
  },
};
