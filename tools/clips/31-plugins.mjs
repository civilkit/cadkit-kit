// Plugins (0.7.5): Features > Plugins lists the generators; "Allow plugins from other people" is switched on and a small plugin (made for this clip, see demo_plugin.mjs) is installed from a zip
// (the confirmation card, then Install); the built-in Case generator: a field changed with the preview following, Add; Edit parameters on its folder (change a size, Update: rebuilt in place);
// Move folder (drag with the ball): the ball's handle dragged, the whole case moves. Load-tolerant (see clipkit.mjs). The zip is chosen off camera (a file dialog cannot be filmed).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';
import { demoPluginZip } from './demo_plugin.mjs';

export const emptyDoc = () => newDoc('Plugins', []);
const TID = (id) => `document.querySelector('[data-testid="${id}"]')`;
const FIELD = (path) => `document.querySelector('[data-path="${path}"] input')`;
const MENU = (text) => `[...document.querySelectorAll('[role=menuitem]')].find((e) => e.innerText.trim() === ${JSON.stringify(text)})`;
const CASE_ROW = `[...document.querySelectorAll('.tree .row')].find((x) => /^Case\\s*\\d+ features/.test((x.innerText || '').trim().replace(/\\s+/g, ' ')))`;

export default {
  id: 'plugins',
  async run(rec, ctx) {
    const { page } = ctx;
    const zip = join(mkdtempSync(join(process.env.UX_TMP ?? tmpdir(), 'plug-')), 'plates.zip');
    writeFileSync(zip, demoPluginZip());
    await ctx.openApp();
    await openDoc(ctx, emptyDoc(), { workspace: {} });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    k.log('loaded');
    await rec.begin();
    rec.x = 700; rec.y = 520;
    await rec.wait(1200);
    // ---- Features > Plugins: the generators that come with the app
    await k.clickEl(TID('ribbon-tab-Features'), 'left', 500);
    k.log('features tab');
    await k.clickEl(TID('cmd-add-plugin'), 'left', 300);
    k.log('plugins clicked');
    await k.waitUi(`!!${TID('plugin-manage')}`, 'the Plugins panel');
    await k.settle();
    await rec.wait(2600);
    await k.snap('31a-list');
    // ---- allow plugins from other people, then install a zip: the card shows what is inside and its hash
    k.log('list');
    await k.clickEl(TID('plugin-thirdparty'), 'left', 900);
    k.log('switch');
    await k.waitUi(`!!${TID('plugin-file')}`, 'the install box');
    const btn = await k.rect(`[...document.querySelectorAll('label.fedit-card-btn')].find((b) => /\\.zip/.test(b.innerText))`);
    await k.glide(btn.x, btn.y, 3);
    await rec.wait(700);
    await rec.skip(async () => {
      const doc = (await page.send('DOM.getDocument')).root.nodeId;
      const node = (await page.send('DOM.querySelector', { nodeId: doc, selector: '[data-testid=plugin-file]' })).nodeId;
      await page.send('DOM.setFileInputFiles', { nodeId: node, files: [zip] });
    });
    await k.waitUi(`!!${TID('plugin-install')}`, 'the confirmation card');
    await k.settle(800);
    await k.rect(TID('plugin-install'));           // scrolls the card into view
    await rec.wait(3600);
    await k.snap('31b-card');
    await k.clickEl(TID('plugin-install'), 'left', 300);
    await k.waitUi(`!!${TID('plugin-row-demo.plates')}`, 'the installed plugin');
    await k.settle(800);
    await rec.wait(2200);
    await k.snap('31c-installed');
    k.log('installed');
    // ---- the built-in Case generator: the form and a live preview, change a size, Add
    await k.waitUi(`!!${TID('plugin-item-civilkit.enclosures-case')}`, 'the Case entry');
    await k.step(() => page.eval(`${TID('plugin-item-civilkit.enclosures-case')}.scrollIntoView({ block: 'center', behavior: 'instant' }); 0`), 900, false);   // the list was scrolled to the install box; bring Case back before the pointer goes to it
    await k.clickEl(TID('plugin-item-civilkit.enclosures-case'), 'left', 300);
    await k.waitUi(`!!${FIELD('width')} && !!${TID('plugin-apply')}`, 'the Case form');
    await k.settle();
    await rec.wait(2600);
    await k.snap('31d-form');
    const typeInto = async (path, text, hold = 2200) => {
      const f = await k.rect(FIELD(path));
      await k.click(f.x, f.y, 'left', 200);
      await k.step(() => page.eval(`(() => { const i = ${FIELD(path)}; i.focus(); i.select(); })()`), 250);
      await k.typeOut(text, 260);
      await k.step(() => page.key('Tab'), 300);
      await k.settle();
      await rec.wait(hold);
    };
    await typeInto('width', '90', 2400);
    await k.snap('31e-wide');
    await k.clickEl(TID('plugin-apply'), 'left', 300);
    await k.waitUi(`!${TID('plugin-apply')}`, 'the case to be added');
    await k.settle();
    await k.clickEl(`[...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title) === 'Fit')`, 'left', 300);
    await k.settle();
    await rec.wait(1800);
    await k.snap('31f-added');
    k.log('added');
    // ---- Edit parameters on its folder: change a size, Update rebuilds it in place
    const folderMenu = async (item) => {
      const r = await k.rect(CASE_ROW);
      await k.glide(r.x - r.w / 2 + 80, r.y, 3);
      await k.step(() => page.eval(`(() => { const e = ${CASE_ROW}; const r = e.getBoundingClientRect(); e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 80, clientY: r.y + 8 })); })()`), 500);
      await k.waitUi(`!!(${MENU(item)})`, 'the folder menu');
      await rec.wait(900);
      await k.clickEl(MENU(item), 'left', 300);
    };
    await folderMenu('Edit parameters…');
    await k.waitUi(`!!${FIELD('height')} && !!${TID('plugin-apply')}`, 'the edit form');
    await k.settle();
    await rec.wait(2200);
    await k.snap('31g-edit');
    await typeInto('height', '40', 2200);
    await k.clickEl(TID('plugin-apply'), 'left', 300);
    await k.waitUi(`!${TID('plugin-apply')}`, 'the case to be rebuilt');
    await k.settle();
    await rec.wait(1800);
    await k.snap('31h-updated');
    k.log('updated');
    // ---- Move folder (drag with the ball): drag a handle, the whole case follows
    await folderMenu('Move folder (drag with the ball)');
    await k.settle();
    await rec.wait(2200);
    await k.snap('31i-ball');
    await k.drag(724, 463, 820, 500, 8);
    await k.settle();
    await rec.wait(2600);
    rec.mark('poster');
    await k.snap('31j-moved');
    k.log('moved');
    await rec.wait(800);
  },
};
