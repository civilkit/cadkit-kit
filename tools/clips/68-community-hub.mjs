// Community Hub (0.8.9): Search commands > Community Hub opens the built-in curated catalog (no network registry is used). Search the catalog, narrow it to one kind and to verified items, read the SPDX licence and
// "SHA-256 verified" badges on a card, then the plugin kind and a #tag filter. (Adding an item is not shown: the starter catalog's sources are placeholders and answer 404.) Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const TID = (id) => `document.querySelector('[data-testid="${id}"]')`;
const PKG = process.env.CLIP_HUB_PKG ?? 'metric-fasteners-lib';

export default {
  id: 'community-hub',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, newDoc('New part', []), { workspace: undefined });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    await k.settle();
    await rec.begin();
    rec.x = 900; rec.y = 520;
    await k.caption('Search commands > Community Hub', 1);
    await hold(1500);
    await k.clickEl(`[...document.querySelectorAll('button, input')].find((b) => /Search commands/.test((b.textContent ?? '') + (b.getAttribute('placeholder') ?? '') + (b.getAttribute('aria-label') ?? '')))`, 'left', 500);
    await k.typeOut('community', 110);
    await rec.wait(900);
    await k.snap('68a-search');
    await k.clickEl(`[...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^Community Hub/.test(e.textContent.trim()) && e.closest('.pal, [role=dialog], [role=listbox]'))`, 'left', 600);
    try { await k.waitUi(`!!${TID('hub-dialog')} && document.querySelectorAll('.hub-card').length > 0`, 'the Hub', 30000); } catch (e) { await k.snap('68x-hub'); throw e; }
    await k.settle(600);
    await k.snap('68b-hub');
    await k.caption('A curated catalog of parts, libraries and plugins', 2);
    rec.mark('poster');
    await hold(3500);
    await k.caption('Search and filter', 3);
    await k.clickEl(TID('hub-search'), 'left', 400);
    await k.typeOut('gear', 140);
    await k.settle(500);
    await k.snap('68c-search');
    await hold(2200);
    await k.step(() => page.eval(`(() => { const i = ${TID('hub-search')}; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); })()`), 700);
    await k.clickEl(TID('hub-kind-library'), 'left', 1500);
    await k.snap('68d-kind');
    await k.clickEl(TID('hub-verified-only'), 'left', 1500);
    await k.snap('68e-verified');
    await k.caption('Each card shows its SPDX licence and a SHA-256 verified badge', 4);
    await k.step(() => page.eval(`${TID('hub-card-' + PKG)}?.scrollIntoView({ block: 'center', behavior: 'instant' }); 0`), 500, false);
    const c = await k.rect(TID('hub-badge-sha-' + PKG));
    await k.glide(c.x, c.y, 4);
    await hold(4200);
    // the licence of another card, then the tag filter and the other kinds
    await k.caption('Click a #tag to filter by it, or pick another kind', 5);
    await k.clickEl(TID('hub-verified-only'), 'left', 900);
    await k.clickEl(TID('hub-kind-plugin'), 'left', 2200);
    await k.snap('68f-plugins');
    await k.clickEl(TID('hub-kind-all'), 'left', 1200);
    await k.clickEl(`document.querySelector('[data-testid^="hub-tag-"][data-testid$="-motion"]')`, 'left', 2500);
    await k.snap('68g-tag');
    await hold(3500);
    if (process.env.CLIP_DRY) return { id: 'community-hub', dry: true };
    return rec.finish('community-hub', ctx.outDir, ctx.posterDir);
  },
};
