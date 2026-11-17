// Extrude end scale (Unreleased): a 60 x 40 plate sketch extruded 30 mm; open the Extrude editor, type End scale 0.5, the preview tapers to half size at the far end, accept.
// The part is made from numbers in this file. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { rectSketch, newDoc } from '../doc_shots_defs.mjs';

const part = () => newDoc('Tapered block', [rectSketch('F1', 'Outline', 'front', 60, 40, { cx: -30, cy: -20 }), { type: 'extrude', id: 'F2', name: 'Block', op: 'add', sketch: 'F1', end: 'blind', depth: 30 }]);
const FIELD = `document.querySelector('label[data-path="endScale"] input')`;

export default {
  id: 'extrude-end-scale',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, part());
    const k = kit(rec, ctx);
    await page.key('7'); await k.sleep(600);   // an oblique view shows the taper
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click()`); await k.settle();
    await k.snap('37a-view');
    await rec.begin();
    rec.x = 900; rec.y = 640;
    await rec.wait(1600);
    // ---- open the Extrude editor from its row
    await k.step(() => page.eval(`${k.row('/^Block/')}.scrollIntoView({ block: 'nearest' }); 0`), 100, false);
    const row = await k.rect(k.row('/^Block/'));
    await k.glide(row.x, row.y, 3);
    await k.step(() => page.eval(`${k.row('/^Block/')}.querySelector('.row-edit').click(); 0`), 300, false);
    try { await k.waitUi(`!!(${FIELD})`, 'the End scale field', 20000); }
    catch (e) { await k.snap('37x-fail'); console.error(await page.eval(`document.querySelector('.tree-wrap')?.innerText.slice(0, 600) + ' || ' + [...document.querySelectorAll('.tree-wrap label[data-path]')].map((l) => l.dataset.path).join(',')`)); throw e; }
    await k.settle();
    await k.snap('37b-editor');
    await rec.wait(2200);   // read the editor: depth, End scale (1 = none)
    // ---- type 0.5
    const f = await k.rect(FIELD);
    await k.click(f.x, f.y, 'left', 300);
    await k.step(() => page.eval(`(() => { const i = ${FIELD}; i.focus(); i.select(); })()`), 250);
    await k.step(() => page.send('Input.insertText', { text: '0.5' }), 500);
    await k.step(() => page.key('Tab'), 250);
    await k.settle();
    await k.step(() => page.eval(`document.activeElement?.blur?.(); 0`), 100, false);
    await k.glide(1050, 660, 4);
    await k.snap('37c-preview');
    await rec.wait(3200);   // the preview tapers
    rec.mark('poster');
    // ---- accept
    await k.clickEl(`document.querySelector('[data-testid="feature-ok"]')`, 'left', 300);
    await k.waitUi(`!document.querySelector('[data-testid="feature-ok"]')`, 'the editor to close');
    await k.settle();
    await k.key('Escape');
    await k.settle();
    await k.glide(1050, 640, 3);
    await k.snap('37d-accepted');
    await rec.wait(2000);
    const vp = await k.rect(`document.querySelector('canvas')`);
    await k.drag(vp.x + 60, vp.y + 80, vp.x - 80, vp.y + 60, 8);
    await k.settle(600);
    await rec.wait(2200);
    if (process.env.CLIP_DRY) return { id: 'extrude-end-scale', dry: true };
    return rec.finish('extrude-end-scale', ctx.outDir, ctx.posterDir);
  },
};
