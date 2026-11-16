// Recognise features (0.8.1): a STEP file is imported (More file actions > Import), the "Recognise features (beta)" box reads it, says what it found and that the rebuild has
// the same volume, and "Open as a new part" builds the steps in a "From STEP" folder. Then the comparison: the folder's eye off and the file's exact body (Original (STEP)) on, and back.
// The STEP file is kept outside the repository: CLIP_STEP_FILE is its path (a plate with four holes and rounded corners, made with the kit's own script, e.g. 70 x 44 x 10).
// Load-tolerant (see clipkit.mjs).
import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const FILE = process.env.CLIP_STEP_FILE ? resolve(process.env.CLIP_STEP_FILE) : null;
const MENU = (re) => `[...document.querySelectorAll('[role=menuitem]')].find((e) => ${re}.test(e.innerText.trim()))`;
const FOLDER = `document.querySelector('.tree .row.folder')`;
const FOLDER_EYE = `${FOLDER}.querySelector('.folder-sup')`;
const ORIGINAL = `[...document.querySelectorAll('.tree .row[data-id]')].find((e) => /Original \\(STEP\\)/.test(e.textContent))`;
const ORIGINAL_EYE = `(${ORIGINAL}).querySelector('.row-sup')`;

export default {
  id: 'recognise-features',
  async run(rec, ctx) {
    const { page } = ctx;
    if (!FILE) throw new Error('set CLIP_STEP_FILE to a STEP file (a plate with holes)');
    const b64 = readFileSync(FILE).toString('base64');
    await ctx.openApp();
    await openDoc(ctx, newDoc('New part', []), { workspace: undefined });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const wait0 = rec.wait.bind(rec);
    rec.wait = async (ms) => { for (let t = 0; t < ms; t += 700) await wait0(Math.min(700, ms - t)); };
    await page.eval(`(() => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); window.__file = new File([u], ${JSON.stringify(basename(FILE).replace(/\.\w+$/, '') + '.step')});
      const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type !== 'file') return orig.call(this); const dt = new DataTransfer(); dt.items.add(window.__file); Object.defineProperty(this, 'files', { value: dt.files }); setTimeout(() => this.onchange && this.onchange(), 400); }; return 0; })()`);
    await rec.begin();
    rec.x = 700; rec.y = 420;
    await rec.wait(800);
    // ---- More file actions > Import STEP: the recogniser box opens on the file
    await k.clickEl(`document.querySelector('button[aria-label="More file actions"]')`, 'left', 700);
    await k.waitUi(`!!(${MENU('/Import STEP/')})`, 'the file menu');
    await k.clickEl(MENU('/Import STEP/'), 'left', 300);
    // the import box (Part feature is chosen): Import
    const IMPORT_BTN = `[...document.querySelectorAll('[role=dialog] button')].find((e) => e.textContent.trim() === 'Import')`;
    await k.waitUi(`!!(${IMPORT_BTN})`, 'the import box');
    await rec.wait(1500);
    await k.clickEl(IMPORT_BTN, 'left', 300);
    // the notice offers it: Recognise features
    const OFFER = `[...document.querySelectorAll('.toast button')].find((e) => /Recognise features/.test(e.textContent))`;
    await k.waitUi(`!!(${OFFER})`, 'the Recognise features notice', 300000);
    await k.step(() => page.eval(`(${OFFER})?.click(); 0`), 300, false);
    try { await k.waitUi(`!!document.querySelector('[data-testid="recog-verdict"]')`, 'the recogniser to answer', 120000); }
    catch (e) { await k.snap('35x-fail'); console.error(await page.eval(`document.body.innerText.slice(0, 600)`)); throw e; }
    await k.settle(800);
    await k.snap('35a-box');
    await rec.wait(4200);   // read what it found and the match
    // ---- open it as a new part: the steps arrive in the From STEP folder
    await k.clickEl(`document.querySelector('[data-testid="recog-open"]')`, 'left', 300);
    await k.waitUi(`!!${FOLDER} && !document.querySelector('[data-testid="recog"]')`, 'the part to open', 300000);
    await k.settle(1500);
    await k.snap('35b-opened');
    await rec.wait(2500);
    rec.mark('poster');
    // ---- compare: the file's exact body on and the rebuild off, then back
    await k.step(() => page.eval(`${FOLDER}.scrollIntoView({ block: 'nearest' }); 0`), 300, false);
    await k.clickEl(FOLDER_EYE, 'left', 300);
    await k.settle(800);
    await k.clickEl(ORIGINAL_EYE, 'left', 300);
    await k.settle(800);
    await rec.wait(2200);
    await k.snap('35c-original');
    await k.clickEl(ORIGINAL_EYE, 'left', 300);
    await k.settle(800);
    await k.clickEl(FOLDER_EYE, 'left', 300);
    await k.settle(800);
    await rec.wait(2200);
    await k.snap('35d-rebuilt');
    const vp = await k.rect(`document.querySelector('canvas')`);
    await k.drag(vp.x + 40, vp.y + 40, vp.x - 120, vp.y + 10, 8);
    await k.settle(600);
    await rec.wait(1600);
  },
};
