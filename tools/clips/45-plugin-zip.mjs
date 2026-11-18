// Install a plugin from its own zip (0.8.3): Features > Plugins, "Allow plugins from other people" on, the author's SolidCraft release zip (the third-party Woodwork
// plugin, MIT licensed, installed as released) is chosen off camera (a file dialog cannot be filmed), the confirmation card, Install; its Cabinet form (made from the
// plugin's parameters, live preview) and Add; the Plugins ribbon tab it adds; its Cut list run from there, with the result table and the CSV download.
// CLIP_PLUGIN_ZIP names the zip (kept outside the repository). Load-tolerant (see clipkit.mjs).
import { resolve } from 'node:path';
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const ZIP = process.env.CLIP_PLUGIN_ZIP ? resolve(process.env.CLIP_PLUGIN_ZIP) : null;
const TID = (id) => `document.querySelector('[data-testid="${id}"]')`;
const FIELD = (path) => `document.querySelector('[data-path="${path}"] input')`;

export default {
  id: 'plugin-zip',
  async run(rec, ctx) {
    const { page } = ctx;
    if (!ZIP) throw new Error('set CLIP_PLUGIN_ZIP to the plugin zip');
    await ctx.openApp();
    await openDoc(ctx, newDoc('Kitchen', []), { workspace: {} });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    await rec.begin();
    rec.x = 700; rec.y = 520;
    await rec.wait(1200);
    // ---- Features > Plugins, allow plugins from other people, choose the zip
    await k.clickEl(TID('ribbon-tab-Features'), 'left', 500);
    await k.clickEl(TID('cmd-add-plugin'), 'left', 300);
    await k.waitUi(`!!${TID('plugin-manage')}`, 'the Plugins panel');
    await k.settle();
    await rec.wait(1600);
    await k.clickEl(TID('plugin-thirdparty'), 'left', 900);
    await k.waitUi(`!!${TID('plugin-file')}`, 'the install box');
    const btn = await k.rect(`[...document.querySelectorAll('label.fedit-card-btn')].find((b) => /\\.zip/.test(b.innerText))`);
    await k.glide(btn.x, btn.y, 3);
    await rec.wait(700);
    await rec.skip(async () => {
      const doc = (await page.send('DOM.getDocument')).root.nodeId;
      const node = (await page.send('DOM.querySelector', { nodeId: doc, selector: '[data-testid=plugin-file]' })).nodeId;
      await page.send('DOM.setFileInputFiles', { nodeId: node, files: [ZIP] });
    });
    await k.waitUi(`!!${TID('plugin-install')}`, 'the confirmation card', 120000);
    await k.settle(800);
    await k.rect(TID('plugin-install'));
    await rec.wait(3600);
    await k.snap('45a-card');
    await k.clickEl(TID('plugin-install'), 'left', 300);
    await k.waitUi(`!!${TID('plugin-item-tomasdjo.woodwork-cabinet')}`, 'the Cabinet entry', 120000);
    await k.settle(800);
    await k.snap('45b-installed');
    await rec.wait(1800);
    // ---- its Cabinet form and live preview, Add
    await k.step(() => page.eval(`${TID('plugin-item-tomasdjo.woodwork-cabinet')}.scrollIntoView({ block: 'center', behavior: 'instant' }); 0`), 600, false);
    await k.clickEl(TID('plugin-item-tomasdjo.woodwork-cabinet'), 'left', 300);
    await k.waitUi(`!!${TID('plugin-apply')}`, 'the Cabinet form', 120000);
    await k.settle();
    await rec.wait(2600);
    await k.snap('45c-form');
    await k.clickEl(TID('plugin-apply'), 'left', 300);
    await k.waitUi(`!${TID('plugin-apply')}`, 'the cabinet to be added', 120000);
    await k.settle();
    await k.clickEl(`[...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title) === 'Fit')`, 'left', 300);
    await k.settle();
    await rec.wait(1800);
    await k.snap('45d-added');
    // ---- the Plugins ribbon tab and its Cut list
    await k.clickEl(TID('ribbon-tab-Plugins'), 'left', 1500);
    await k.snap('45e-tab');
    await k.clickEl(TID('cmd-plugin:tomasdjo.woodwork:cutlist'), 'left', 300);
    await k.waitUi(`!!${TID('plugin-run')}`, 'the Cut list panel', 60000);
    await k.settle();
    await rec.wait(1400);
    const f = await k.rect(FIELD('file'));
    await k.click(f.x, f.y, 'left', 200);
    await k.step(() => page.eval(`(() => { const i = ${FIELD('file')}; i.focus(); i.select(); })()`), 250);
    await k.typeOut('cut-list.csv', 140);
    await k.step(() => page.key('Tab'), 300);
    await k.clickEl(TID('plugin-run'), 'left', 300);
    await k.waitUi(`!!${TID('plugin-result')}`, 'the cut list', 120000);
    await k.settle();
    await k.snap('45f-result');
    rec.mark('poster');
    await rec.wait(3600);
    await k.clickEl(TID('plugin-result-file-0'), 'left', 1500);
    await k.snap('45g-download');
    await rec.wait(1800);
    if (process.env.CLIP_DRY) return { id: 'plugin-zip', dry: true };
    return rec.finish('plugin-zip', ctx.outDir, ctx.posterDir);
  },
};
