// A large STEP file (0.8.3): a STEP assembly of 8,000,000+ characters (CLIP_STEP_FILE names it; kept outside the repository) dropped on the window opens as a
// mesh-only preview: the import dialog (View only), the assembly tree in the left panel, eye toggles (hide two products), Show all.
// The import itself runs off the clock (rec.skip). Load-tolerant (see clipkit.mjs).
import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { kit } from './clipkit.mjs';

const FILE = process.env.CLIP_STEP_FILE ? resolve(process.env.CLIP_STEP_FILE) : null;

export default {
  id: 'step-preview',
  async run(rec, ctx) {
    const { page } = ctx;
    // hiding part of a 1.7M-triangle model keeps the page busy for a while: wait longer than the default 30 s for each CDP reply
    const send = page.send.bind(page);
    page.send = (method, params = {}, timeout = 300000) => send(method, params, timeout);
    if (!FILE) throw new Error('set CLIP_STEP_FILE to the big STEP file');
    await ctx.openApp();
    await rec.waitFor(`/ready/i.test(document.querySelector('.status')?.textContent ?? '')`, 'the app to be ready');
    const k = kit(rec, ctx);
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    // the file arrives as a drop (a synthetic drop event carrying a File made from the bytes, sent in pieces)
    const b64 = readFileSync(FILE).toString('base64');
    await page.eval(`window.__chunks = []; 0`);
    for (let i = 0; i < b64.length; i += 2_000_000) await page.eval(`window.__chunks.push(${JSON.stringify(b64.slice(i, i + 2_000_000))}); 0`);
    await rec.begin();
    rec.x = 760; rec.y = 400;
    await rec.wait(1200);
    await k.snap('44a-empty');
    await rec.skip(async () => {
      await page.eval(`(() => { const bin = atob(window.__chunks.join('')); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([u], ${JSON.stringify(basename(FILE))})); for (const t of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true })); window.__chunks = null; return 0; })()`);
      await rec.waitFor(`!!document.querySelector('[data-testid=import-kind]')`, 'the import dialog');
    });
    await rec.wait(1800);
    await k.clickEl(`document.querySelector('[data-testid=import-kind-view]')`, 'left', 700);
    await k.snap('44b-dialog');
    await k.clickEl(`document.querySelector('[data-testid=import-kind-ok]')`, 'left', 300);
    await rec.skip(async () => {
      await rec.waitFor(`!!document.querySelector('.ptree .ptree-row')`, 'the assembly tree', 300000);
      await k.settle(2500);
    });
    await k.snap('44c-preview');
    rec.x = 1250; rec.y = 760;
    await rec.wait(3500);
    // open the root: its products list
    await k.clickEl(`document.querySelector('.ptree-row button.ptree-chev')`, 'left', 1500);
    await k.settle(800);
    // the tree's rows, read off camera: the hide toggles go on products under the root
    const rows = await page.eval(`[...document.querySelectorAll('.ptree-row')].map((r, i) => ({ i, name: r.querySelector('.ptree-name')?.textContent, pad: parseInt(r.style.paddingLeft) || 0, kids: !!r.querySelector('button.ptree-chev') }))`);
    k.log('rows ' + JSON.stringify(rows.slice(0, 12)));
    const min = Math.min(...rows.map((r) => r.pad));
    let pick = rows.filter((r) => r.pad > min);
    if (pick.length < 2) pick = rows.slice(0, 2);
    // the big visible parts first (the cover, then a motor carrier), when this file has them
    const named = [/^cover$/, /^leftmotorcarrier/].map((re) => rows.find((r) => re.test(r.name ?? ''))).filter(Boolean);
    if (named.length === 2) pick = named;
    const eyeOf = (i) => `document.querySelectorAll('.ptree-row')[${i}].querySelector('.ptree-eye')`;
    await k.clickEl(eyeOf(pick[0].i), 'left', 1800);
    await k.snap('44d-hide1');
    await k.clickEl(eyeOf(pick[Math.min(1, pick.length - 1)].i), 'left', 1800);
    await k.snap('44e-hide2');
    rec.mark('poster');
    await rec.wait(1200);
    await k.clickEl(`document.querySelector('.ptree-all')`, 'left', 2500);
    await k.snap('44g-all');
    if (process.env.CLIP_DRY) return { id: 'step-preview', dry: true };
    return rec.finish('step-preview', ctx.outDir, ctx.posterDir);
  },
};
