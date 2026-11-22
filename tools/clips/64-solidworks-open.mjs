// Open a SolidWorks part (0.8.8): a NIST test part (public domain, a .SLDPRT file) is opened with More file actions > Import ... SolidWorks; the notice says it came in with
// its feature history, the view is turned a little, then Search commands > Mass properties fills the Inspect card (volume, area, mass) while the status bar stays on Errors 0.
// The part is kept outside the repository: CLIP_SLDPRT_DIR names the folder that holds the file CLIP_SLDPRT_FILE (default part.SLDPRT). The file chooser is replaced by a stub that
// hands the page the file (off camera). Load-tolerant (see clipkit.mjs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const FILE = process.env.CLIP_SLDPRT_FILE ?? 'part.SLDPRT';
const DIR = process.env.CLIP_SLDPRT_DIR ? resolve(process.env.CLIP_SLDPRT_DIR) : null;
const TITLE = 'NIST_CTC_01.SLDPRT';
const MENU = (re) => `[...document.querySelectorAll('[role=menuitem]')].find((e) => ${re}.test(e.innerText.trim()))`;

export default {
  id: 'solidworks-open',
  async run(rec, ctx) {
    const { page } = ctx;
    if (!DIR) throw new Error('set CLIP_SLDPRT_DIR to the folder with the SolidWorks part (' + FILE + ')');
    const b64 = readFileSync(resolve(DIR, FILE)).toString('base64');
    await ctx.openApp();
    await openDoc(ctx, newDoc('New part', []), { workspace: undefined });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    await page.eval(`(() => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); window.__file = new File([u], ${JSON.stringify(TITLE)});
      const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type !== 'file') return orig.call(this); const dt = new DataTransfer(); dt.items.add(window.__file); Object.defineProperty(this, 'files', { value: dt.files }); setTimeout(() => this.onchange && this.onchange(), 400); }; return 0; })()`);
    await k.settle();
    await rec.begin();
    rec.x = 700; rec.y = 420;
    await k.caption('An empty part: open a SolidWorks file', 1);
    await hold(2200);
    await k.clickEl(`document.querySelector('button[aria-label="More file actions"]')`, 'left', 700);
    await k.waitUi(`!!(${MENU('/Import STEP/')})`, 'the file menu');
    await k.snap('64a-menu');
    await hold(1500);
    await k.caption('Import ... SolidWorks (.SLDPRT)', 2);
    await k.clickEl(MENU('/Import STEP/'), 'left', 300);
    await k.waitUi(`/Opened .*\\(SolidWorks\\)/.test(document.body.innerText) && !!document.querySelector('.tree .row.folder')`, 'the part to open', 600000);
    await k.settle(1500);
    await k.snap('64b-opened');
    await k.caption('It opens with its feature history, rebuilt feature by feature', 3);
    rec.mark('poster');
    await hold(4500);
    await page.eval(`document.querySelectorAll('.toast button').forEach((b) => b.click()); 0`);
    await k.caption('Turn it around: a real part, not a picture', 4);
    const vp = await k.rect(`document.querySelector('#vp canvas') || document.querySelector('canvas')`);
    await k.drag(vp.x + 60, vp.y + 80, vp.x - 140, vp.y + 40, 9);
    await k.settle(600);
    await hold(1500);
    await k.drag(vp.x - 100, vp.y + 40, vp.x + 80, vp.y - 40, 9);
    await k.settle(600);
    await k.snap('64c-orbit');
    await hold(1500);
    await k.caption('Search commands > Mass properties', 5);
    await k.clickEl(`[...document.querySelectorAll('button, input')].find((b) => /Search commands/.test((b.textContent ?? '') + (b.getAttribute('placeholder') ?? '') + (b.getAttribute('aria-label') ?? '')))`, 'left', 500);
    await k.typeOut('mass prop', 120);
    await rec.wait(900);
    await k.clickEl(`[...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Mass properties')`, 'left', 600);
    await k.settle(1500);
    await k.waitUi(`/Volume/.test(document.querySelector('#mass-card, .insp-card')?.innerText ?? '') && /\\d/.test(document.querySelector('.insp-table, .insp-rows, .insp-card')?.innerText ?? '')`, 'the mass card');
    await k.settle(800);
    await k.snap('64d-mass');
    await k.caption('Volume, area and mass, with Errors 0 in the status bar', 6);
    await hold(6000);
    if (process.env.CLIP_DRY) return { id: 'solidworks-open', dry: true };
    return rec.finish('solidworks-open', ctx.outDir, ctx.posterDir);
  },
};
