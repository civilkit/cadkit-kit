// Teardrop hole (0.8.1): a plate with four round holes; right-click a Hole in the tree, Teardrop hole, and the box asks which way is up and the overhang angle, says how far the
// peak reaches, and "Add peak" puts a peak on all four holes at once, in one "Teardrop" folder. The folder's eye then shows the plate with and without the peaks.
// The part is kept outside the repository: CLIP_PLATE_DOC is the path of a ck-part (JSON) of a plate with four holes (see the script in the note of this clip's commit).
// Load-tolerant (see clipkit.mjs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDoc, kit } from './clipkit.mjs';

const DOC = process.env.CLIP_PLATE_DOC ? resolve(process.env.CLIP_PLATE_DOC) : null;
const MENU = (re) => `[...document.querySelectorAll('[role=menuitem]')].find((e) => ${re}.test(e.innerText.trim()))`;
const HOLE = `[...document.querySelectorAll('.tree .row[data-id]')].find((e) => /^Hole/.test(e.querySelector('.row-name')?.textContent.trim() ?? ''))`;

export default {
  id: 'teardrop-hole',
  async run(rec, ctx) {
    const { page } = ctx;
    if (!DOC) throw new Error('set CLIP_PLATE_DOC to a ck-part file (a plate with four holes)');
    const doc = JSON.parse(readFileSync(DOC, 'utf8'));
    await ctx.openApp();
    await openDoc(ctx, doc);
    const k = kit(rec, ctx);
    const wait0 = rec.wait.bind(rec);
    rec.wait = async (ms) => { for (let t = 0; t < ms; t += 700) await wait0(Math.min(700, ms - t)); };
    await rec.begin();
    rec.x = 700; rec.y = 420;
    await rec.wait(1500);
    // ---- right-click a Hole in the tree: Select its faces in the view; then the command search finds Teardrop hole
    const row = await k.rect(HOLE);
    await k.rightClick(row.x, row.y);
    await k.waitUi(`!!(${MENU('/Select its faces/')})`, 'the row menu');
    await k.clickEl(MENU('/Select its faces/'), 'left', 900);
    await k.settle(600);
    const SEARCH = `document.querySelector('.search-btn')`;
    await k.clickEl(SEARCH, 'left', 400);
    await k.typeOut('Teardrop', 120);
    await rec.wait(900);
    try { await k.waitUi(`!![...document.querySelectorAll('.plist [role=option]')].find((e) => /Teardrop hole/.test(e.textContent))`, 'the search result', 20000); }
    catch (e) { await k.snap('36x-fail'); throw e; }
    await k.snap('36a-search');
    await k.clickEl(`[...document.querySelectorAll('.plist [role=option]')].find((e) => /Teardrop hole/.test(e.textContent))`, 'left', 300);
    await k.waitUi(`!!document.querySelector('[data-testid="teardrop"]')`, 'the teardrop box');
    await k.settle(600);
    await k.snap('36b-box');
    await rec.wait(3500);   // read: the hole, the direction (up), the reach
    // ---- the peak stays pointed (flat top off), then add
    await rec.wait(1500);
    await k.clickEl(`document.querySelector('[data-testid="teardrop-add"]')`, 'left', 300);
    await k.waitUi(`!document.querySelector('[data-testid="teardrop"]') && /Teardrop/.test(document.querySelector('.tree')?.innerText || '')`, 'the peaks to be added', 300000);
    await k.settle(1500);
    await k.snap('36d-added');
    await rec.wait(2500);
    rec.mark('poster');
    // ---- look from above, then the folder's eye: with and without the peaks
    const vp = await k.rect(`document.querySelector('canvas')`);
    await k.drag(vp.x + 60, vp.y + 80, vp.x + 60, vp.y - 40, 8);
    await k.settle(600);
    await rec.wait(1800);
    const eye = `[...document.querySelectorAll('.tree .row.folder')].find((e) => /Teardrop/.test(e.textContent)).querySelector('.folder-sup')`;
    await k.clickEl(eye, 'left', 300);
    await k.settle(800);
    await rec.wait(1800);
    await k.snap('36e-off');
    await k.clickEl(eye, 'left', 300);
    await k.settle(800);
    await rec.wait(2200);
    await k.snap('36f-on');
  },
};
