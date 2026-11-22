// STEP round trip (0.8.8): the Marine propeller sample (3 blades, 250 mm) is measured (Mass properties: volume and mass), exported with Export > Export STEP, and the file just written
// is opened again with More file actions > Import STEP; Mass properties of the re-imported solid gives the same volume and mass, with Errors 0 in the status bar.
// The download is caught inside the page (the file chooser stub then hands that same file back), all off camera. Load-tolerant (see clipkit.mjs).
import { kit } from './clipkit.mjs';

const MENU = (re) => `[...document.querySelectorAll('[role=menuitem]')].find((e) => ${re}.test(e.innerText.trim()))`;

export default {
  id: 'step-round-trip',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await ctx.openSample('marine-propeller');
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    // catch the download; the chooser stub returns the caught file
    await page.eval(`(() => {
      const mk = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__saved = b; return mk(b); };
      const ac = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__savedName = this.download; return; } return ac.call(this); };
      const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type !== 'file') return orig.call(this); const f = new File([window.__saved], window.__savedName); const dt = new DataTransfer(); dt.items.add(f); Object.defineProperty(this, 'files', { value: dt.files }); setTimeout(() => this.onchange && this.onchange(), 400); };
      return 0; })()`);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    const mass = async (density = null) => {
      await k.clickEl(`[...document.querySelectorAll('button, input')].find((b) => /Search commands/.test((b.textContent ?? '') + (b.getAttribute('placeholder') ?? '') + (b.getAttribute('aria-label') ?? '')))`, 'left', 500);
      await k.typeOut('mass prop', 100);
      await rec.wait(700);
      await k.clickEl(`[...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Mass properties')`, 'left', 600);
      if (density) {
        // the imported solid has no material: the density of bronze is typed in, then Compute
        const DEN = `document.querySelector('.insp-card input[aria-label="Density"]')`;
        await k.clickEl(DEN, 'left', 300);
        await k.step(() => page.eval(`(() => { const i = ${DEN}; i.focus(); i.select(); })()`), 250);
        await k.typeOut(density, 200);
        await k.step(() => page.key('Tab'), 250);
        await k.clickEl(`[...document.querySelectorAll('.insp-card button')].find((b) => b.textContent.trim() === 'Compute')`, 'left', 500);
      }
      try { await k.waitUi(`/Volume/.test(document.querySelector('.insp-card')?.innerText ?? '')`, 'the mass card', 30000); } catch (e) { await k.snap('65x-nomass'); throw e; }
      await k.settle(1200);
    };
    await rec.begin();
    rec.x = 800; rec.y = 480;
    await k.caption('The Marine propeller sample: three blades, 250 mm', 1);
    await hold(1500);
    await k.caption('Mass properties: the volume and mass to match later', 2);
    await mass();
    await k.snap('65a-mass');
    rec.mark('poster');
    await hold(3000);
    await k.caption('Export > Export STEP', 3);
    await k.clickEl(`document.querySelector('[aria-label="Export"]')`, 'left', 900);
    await k.waitUi(`!!document.querySelector('.export-pop')`, 'the export menu');
    await k.snap('65b-menu');
    await hold(1200);
    await k.clickEl(`[...document.querySelectorAll('.export-row')].find((b) => /Export STEP/.test(b.textContent))`, 'left', 400);
    await k.waitUi(`!!window.__saved`, 'the STEP file', 120000);
    await k.settle(800);
    const size = await page.eval(`Math.round(window.__saved.size / 1024)`);
    await k.caption(`The STEP file is written: ${size} KB`, 3);
    await hold(1500);
    await k.caption('Open it again: More file actions > Import STEP', 4);
    await k.clickEl(`document.querySelector('button[aria-label="More file actions"]')`, 'left', 700);
    await k.waitUi(`!!(${MENU('/Import STEP/')})`, 'the file menu');
    await hold(900);
    await k.clickEl(MENU('/Import STEP/'), 'left', 300);
    const IMPORT = `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Import')`;
    await k.waitUi(`!!(${IMPORT})`, 'the import dialog');
    await k.caption('Import it as a part feature', 4);
    await hold(1500);
    await k.clickEl(IMPORT, 'left', 400);
    await k.waitUi(`!(${IMPORT}) && /ready/i.test(document.querySelector('.status')?.textContent || '')`, 'the import to finish', 300000);
    await k.settle(2000);
    // the Recognise features offer (a beta dialog after a STEP import) is closed off camera
    await rec.skip(async () => { for (let i = 0; i < 15; i++) { const done = await page.eval(`(() => { const b = [...document.querySelectorAll('button')].filter((x) => x.textContent.trim() === 'Close').find((x) => { for (let e = x; e; e = e.parentElement) if (/Recognise features/.test(e.innerText || '') && e.querySelectorAll('button').length < 6) return true; return false; }); if (b) { b.click(); return 1; } return 0; })()`); if (done) break; await k.sleep(500); } await k.sleep(800); });
    await k.settle(1500);
    await page.eval(`document.querySelectorAll('.toast button').forEach((b) => b.click()); 0`);
    await k.snap('65c-reimported');
    await k.caption('Back in: a new part holding the solid', 4);
    await hold(1500);
    await k.caption('Bronze density again: same volume, area and mass, Errors 0', 5);
    await mass('8.8');
    await k.snap('65d-mass2');
    await hold(4500);
    if (process.env.CLIP_DRY) return { id: 'step-round-trip', dry: true };
    return rec.finish('step-round-trip', ctx.outDir, ctx.posterDir);
  },
};
