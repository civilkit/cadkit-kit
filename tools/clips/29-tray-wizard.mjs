// The Tray wizard (Features > Create > Tray or bin): a small bin (end walls on both ends) on a 3 x 2 grid with the foot on, added; then the same wizard with Make set to Baseplate
// for the plate its foot seats in (4 x 3, one unit larger each way), added; the view ends with the tray and the baseplate both in view. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

// the slot of the wizards shows the one used last (Gear at first, then Tray)
const SLOT = `[...document.querySelectorAll('button')].find((b) => /^(Gear|Tray)/.test(b.getAttribute('aria-label') || b.title))`;
const FIELD = (path) => `document.querySelector('.tree-wrap label[data-path="${path}"] input')`;

export default {
  id: 'tray-wizard',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, newDoc('Tray', []));
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    await k.key('f');                                      // off camera: the camera's up axis to Z, so the tray stands on its floor
    await k.waitUi(`!!document.querySelector('[role=dialog] input, .cmdk input, input[placeholder*="Search"]')`, 'the command search');
    await page.send('Input.insertText', { text: 'up axis' }); await k.sleep(600);
    await page.key('Enter'); await k.sleep(800);
    await page.key('7'); await k.sleep(600);
    await rec.begin();
    rec.x = 760; rec.y = 560;
    await rec.wait(1200);
    // ---- the Create group of the Features tab: the wizards share a slot with Gear; right-click opens the list
    const openWizard = async (again) => {
      const g = again ? null : await k.rect(SLOT);
      if (again) {
        await k.key('f');                                  // the command search: Tray
        await k.waitUi(`!!document.querySelector('[role=dialog] input, .cmdk input, input[placeholder*="Search"]')`, 'the command search');
        await k.step(() => page.send('Input.insertText', { text: 'Tray' }), 900);
        await k.step(() => page.key('Enter'), 300);
      } else {
        await k.glide(g.x, g.y, 3);
        await k.step(async () => { await page.mouse('mousePressed', g.x, g.y, 'right'); await page.mouse('mouseReleased', g.x, g.y, 'right'); }, 600);
        await k.waitUi(`!!document.querySelector('[data-testid=cmd-add-tray]')`, 'the Tray command');
        await rec.wait(1000);
        await k.clickEl(`document.querySelector('[data-testid=cmd-add-tray]')`, 'left', 300);
      }
      await k.waitUi(`!!document.querySelector('.tree-wrap [data-testid=tray-wizard]')`, 'the Tray wizard');
      await k.settle();
    };
    const edit = async (path, text, hold = 1800) => {
      const f = await k.rect(FIELD(path));
      await k.click(f.x, f.y, 'left', 200);
      await k.step(() => page.eval(`(() => { const i = ${FIELD(path)}; i.focus(); i.select(); })()`), 250);
      await k.typeOut(text, 300);
      await k.step(() => page.key('Tab'), 300);
      await k.settle();
      await rec.wait(hold);
    };
    await openWizard();
    await rec.wait(2200);
    await k.snap('29a-wizard');
    await edit('widthUnits', '3');
    await edit('lengthUnits', '2');
    await k.choose(`document.querySelector('.tree-wrap label[data-path="endWalls"] select')`, '/^Both/', 2400);   // end walls on both ends: a closed bin, not an open channel
    await k.snap('29b-size');
    await k.clickEl(`document.querySelector('[data-testid=tray-apply]')`, 'left', 40);
    await k.hop(760, 560);
    await k.waitUi(`!document.querySelector('.tree-wrap [data-testid=tray-wizard]')`, 'the tray to be added');
    await k.settle();
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click()`); await k.settle();
    await rec.wait(2000);
    await k.snap('29c-tray');
    // ---- the baseplate: Make = Baseplate, the same grid
    await openWizard(true);
    await k.choose(`document.querySelector('.tree-wrap label[data-path="kind"] select')`, '/^Baseplate$/', 2400);
    await edit('widthUnits', '4', 1400);                    // a plate one unit larger each way: the tray seats in it, with a margin of plate round it
    await edit('lengthUnits', '3', 1800);
    await k.snap('29d-baseplate');
    await k.clickEl(`document.querySelector('[data-testid=tray-apply]')`, 'left', 40);
    await k.hop(760, 560);
    await k.waitUi(`!document.querySelector('.tree-wrap [data-testid=tray-wizard]')`, 'the baseplate to be added');
    await k.settle();
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click()`); await k.settle();
    await rec.wait(1800);
    rec.mark('poster');
    await k.snap('29e-both');
    await rec.wait(1600);
    if (process.env.CLIP_DRY) return { id: 'tray-wizard', dry: true };
    return rec.finish('tray-wizard', ctx.outDir, ctx.posterDir);
  },
};
