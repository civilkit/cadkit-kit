// Standalone HTML viewer (0.8.8): Export > Export standalone HTML viewer writes one .html file with the part inside it. The file the app wrote is then opened in
// the browser (the page is saved to a scratch folder and loaded from there, as a user double-clicking it would): drag to orbit, untick a body, switch on the
// section plane and drag its slider. Load-tolerant (see clipkit.mjs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { openDoc, kit } from './clipkit.mjs';
import { doc } from './60-print-plate.mjs';

const OUT = process.env.CLIP_HTML_DIR || join(tmpdir(), 'clip-html-viewer');

export default {
  id: 'html-viewer',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc());
    const k = kit(rec, ctx);
    const cap = async (text, n) => { await k.caption(text, n); await rec.skip(() => page.eval(`(() => { const e = document.getElementById('__cap'); e.style.left = '640px'; e.style.bottom = 'auto'; e.style.top = '16px'; e.style.maxWidth = '760px'; })()`)); await rec.paint(); };
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    // the browser's download cannot be seen: the file the app hands to the download is kept, to be opened afterwards
    await page.eval(`(() => { const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { if (b && /html/.test(b.type)) window.__html = b; return o(b); }; return 0; })()`);
    await k.settle();
    await rec.begin();
    rec.x = 700; rec.y = 560;
    await cap('Export > Export standalone HTML viewer', 1);
    await hold(1500);
    await k.clickEl(`document.querySelector('[aria-label="Export"]')`, 'left', 900);
    await k.waitUi(`!!document.querySelector('.export-pop')`, 'the export menu');
    await hold(1500);
    await k.snap('62a-menu');
    await k.clickEl(`[...document.querySelectorAll('.export-row')].find((b) => /standalone HTML/.test(b.textContent))`, 'left', 700);
    await k.waitUi(`!!window.__html`, 'the exported file', 60000);
    await hold(2500);
    const html = await rec.skip(() => page.eval(`window.__html.text()`));
    mkdirSync(OUT, { recursive: true });
    const file = resolve(OUT, 'desk-set.html');
    writeFileSync(file, html);
    await cap('One .html file, no install: open it in any browser', 2);
    await rec.skip(async () => { await page.goto(pathToFileURL(file).href); await rec.waitFor(`document.querySelectorAll('#body-list .body-row').length > 0`, 'the viewer', 60000); await new Promise((r) => setTimeout(r, 1500)); });
    await rec.paint();
    await cap('One .html file, no install: open it in any browser', 2);
    await k.snap('62b-viewer');
    rec.mark('poster');
    await hold(3500);
    const [cx, cy, cw, ch] = await rec.rect(`document.getElementById('gl')`);
    await cap('Drag to orbit', 3);
    rec.x = cx; rec.y = cy;
    await k.drag(cx - 80, cy + 20, cx + 160, cy - 40, 8);
    await hold(2500);
    await cap('Untick a body to hide it', 4);
    await k.clickEl(`document.querySelectorAll('#body-list .body-row input')[1]`, 'left', 600);
    await k.snap('62c-hidden');
    await hold(3000);
    await k.clickEl(`document.querySelectorAll('#body-list .body-row input')[1]`, 'left', 600);
    await cap('Section: switch it on and drag the plane through the part', 5);
    await k.clickEl(`document.getElementById('clip-on')`, 'left', 700);
    const [sx, sy, sw] = await rec.rect(`document.getElementById('clip-slider')`);
    const x0 = sx + sw * 0.46 - sw / 2 + sw * 0.04;
    await k.drag(sx, sy, sx - sw * 0.4, sy, 6);
    await k.snap('62d-section');
    await hold(1500);
    await k.drag(sx - sw * 0.4, sy, sx + sw * 0.35, sy, 10);
    await k.snap('62e-section2');
    await hold(3500);
    if (process.env.CLIP_DRY) return { id: 'html-viewer', dry: true };
    return rec.finish('html-viewer', ctx.outDir, ctx.posterDir);
  },
};
