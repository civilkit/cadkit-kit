// SolidWorks history (0.7.5): a SolidWorks part (a NIST test part, public domain) is opened with More file actions > Import ... SolidWorks, and the app rebuilds its feature history:
// the notice says it was opened with its feature history, the "SolidWorks history" folder opens in the tree (sketches, extrudes, fillets, drafts), the tree scrolls, the folder's eye is switched off
// (the file's exact body shows) and on again (the rebuilt history), two features are clicked and the view is orbited a little.
// The part is kept outside the repository: CLIP_SLDPRT_DIR names the folder that holds the file named below. The file chooser is replaced by a stub that hands the page the file (off camera).
// Load-tolerant (see clipkit.mjs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const FILE = process.env.CLIP_SLDPRT_FILE ?? 'part.SLDPRT';
const DIR = process.env.CLIP_SLDPRT_DIR ? resolve(process.env.CLIP_SLDPRT_DIR) : null;
const TITLE = 'NIST_CTC_04.SLDPRT';   // the name the file is opened under (shown in the notice and the part name)
const MENU = (re) => `[...document.querySelectorAll('[role=menuitem]')].find((e) => ${re}.test(e.innerText.trim()))`;
const FOLDER = `document.querySelector('.tree .row.folder')`;
const EYE = `document.querySelector('.tree .row.folder .folder-sup')`;

export default {
  id: 'solidworks-history-2',
  async run(rec, ctx) {
    const { page } = ctx;
    if (!DIR) throw new Error('set CLIP_SLDPRT_DIR to the folder with the SolidWorks part (' + FILE + ')');
    const b64 = readFileSync(resolve(DIR, FILE)).toString('base64');
    await ctx.openApp();
    await openDoc(ctx, newDoc('New part', []), { workspace: undefined });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const wait0 = rec.wait.bind(rec);
    rec.wait = async (ms) => { for (let t = 0; t < ms; t += 700) await wait0(Math.min(700, ms - t)); };
    // the file chooser stub: the next file input clicked gets the part
    await page.eval(`(() => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); window.__file = new File([u], ${JSON.stringify(TITLE)});
      const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type !== 'file') return orig.call(this); const dt = new DataTransfer(); dt.items.add(window.__file); Object.defineProperty(this, 'files', { value: dt.files }); setTimeout(() => this.onchange && this.onchange(), 400); }; return 0; })()`);
    await rec.begin();
    rec.x = 700; rec.y = 420;
    await rec.wait(800);
    // ---- More file actions > Import ... SolidWorks
    await k.clickEl(`document.querySelector('button[aria-label="More file actions"]')`, 'left', 700);
    await k.waitUi(`!!(${MENU('/Import STEP/')})`, 'the file menu');
    await k.snap('34a-menu');
    await k.clickEl(MENU('/Import STEP/'), 'left', 300);
    k.log('importing');
    await k.waitUi(`/Opened .*\\(SolidWorks\\)/.test(document.body.innerText) && !!document.querySelector('.tree .row.folder')`, 'the part to open', 600000);
    k.log('opened');
    await k.snap('34b-opened');
    await rec.wait(3000);   // the notice is up
    await k.settle(1500);
    // ---- the history folder opens
    const open = await k.rect(`${FOLDER}.querySelector('.folder-toggle') || ${FOLDER}`);
    if (!(await page.eval(`${FOLDER}.querySelector('[aria-expanded]')?.getAttribute('aria-expanded') === 'true' || ${FOLDER}.querySelector('.folder-toggle')?.getAttribute('aria-expanded') === 'true' || /open/.test(${FOLDER}.innerHTML.slice(0, 600)) && false`))) await k.click(open.x, open.y, 'left', 300);
    await k.settle();
    await rec.wait(1600);
    await k.snap('34c-folder');
    // ---- scroll the tree a little
    const tree = await k.rect(`document.querySelector('.tree')`);
    await k.glide(tree.x, tree.y, 3);
    for (const dy of [300, 300, 'top']) { await k.step(() => page.eval(`(() => { const t = document.querySelector('.tree'); const s = [t, ...t.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== 'visible'); const e0 = s || t; e0.scrollTo({ top: ${typeof dy === 'number' ? 'e0.scrollTop + ' + dy : 0}, behavior: 'instant' }); })()`), 1000); }
    await k.snap('34d-scrolled');
    // ---- the folder's eye: off shows the file's exact body, on shows the rebuilt history
    await k.step(() => page.eval(`${FOLDER}.scrollIntoView({ block: 'nearest' }); 0`), 300, false);
    await k.clickEl(EYE, 'left', 300);
    await k.settle(800);
    await rec.wait(1800);
    await k.snap('34e-off');
    await k.clickEl(EYE, 'left', 300);
    await k.settle(800);
    await rec.wait(1800);
    await k.snap('34f-on');
    // ---- click a couple of features: the viewport highlights them
    const rows = await page.eval(`(() => { const all = [...document.querySelectorAll('.tree .row[data-id]')]; const pick = (re) => all.find((e) => re.test(e.querySelector('.row-name')?.textContent.trim() ?? '')); return [pick(/^Fillet/), pick(/^Draft/)].filter(Boolean).map((e) => e.dataset.id); })()`);
    for (const id of rows) {
      await k.clickEl(`document.querySelector('.tree .row[data-id="${id}"]')`, 'left', 300, -20);
      await k.settle(600);
      await rec.wait(1500);
    }
    await k.snap('34g-picked');
    rec.mark('poster');
    // ---- orbit a little
    const vp = await k.rect(`document.querySelector('canvas')`);
    await k.drag(vp.x + 40, vp.y + 40, vp.x - 120, vp.y + 10, 8);
    await k.settle(600);
    await rec.wait(1600);
    await k.snap('34h-orbit');
  },
};
