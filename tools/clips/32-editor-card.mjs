// The feature editor as a card (0.7.5): double-click Extrude in the tree and its editor opens as a floating card over the viewport while the tree stays on the left;
// the Depth is typed (the plate thickens as the number changes), the card is confirmed and closes; the Hole opens the same way and its Size is changed (M5 to M6),
// then it is confirmed. The tree stays on the left throughout. Load-tolerant (see clipkit.mjs).
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDoc, kit } from './clipkit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = JSON.parse(readFileSync(resolve(here, '../../apps/cad/public/samples/mounting-plate.ckpart'), 'utf8'));
const CARD = `document.querySelector('[data-testid=editor-card]')`;
const FIELD = (path) => `document.querySelector('[data-testid=editor-card] label[data-path="${path}"] input')`;

export default {
  id: 'editor-card',
  async run(rec, ctx) {
    const { page } = ctx;
    await openDoc(ctx, SAMPLE);
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    // a still hold longer than 1.5 s is cut short by the encoder (frame durations are capped): paint every 0.7 s so a hold keeps its length
    const wait0 = rec.wait.bind(rec);
    rec.wait = async (ms) => { for (let t = 0; t < ms; t += 700) await wait0(Math.min(700, ms - t)); };
    const open = async (id) => {
      await k.step(() => page.eval(`document.querySelector('.tree .row[data-id="${id}"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); 0`), 300);
      await k.waitUi(`!!${CARD}`, 'the editor card');
      await k.settle();
    };
    await rec.begin();
    rec.x = 900; rec.y = 520;
    await rec.wait(1800);
    // ---- Extrude: the card opens over the viewport, the tree stays
    const ex = await k.rect(`document.querySelector('.tree .row[data-id="F2"] .row-name')`);
    await k.glide(ex.x, ex.y, 3);
    await open('F2');
    await rec.wait(2400);
    await k.snap('32a-extrude');
    // ---- the Depth, typed: the model follows
    const f = await k.rect(FIELD('depth'));
    await k.click(f.x, f.y, 'left', 200);
    await k.step(() => page.eval(`(() => { const i = ${FIELD('depth')}; i.focus(); i.select(); })()`), 250);
    await k.typeOut('16', 350);
    await k.step(() => page.key('Tab'), 300);
    await k.settle();
    await rec.wait(2200);
    await k.snap('32b-depth');
    rec.mark('poster');
    await k.clickEl(`${CARD}.querySelector('.fedit-confirm')`, 'left', 300);
    await k.waitUi(`!${CARD}`, 'the card to close');
    await k.settle();
    await rec.wait(1800);
    await k.snap('32c-closed');
    // ---- Hole: another editor, the same card
    const ho = await k.rect(`document.querySelector('.tree .row[data-id="F4"] .row-name')`);
    await k.glide(ho.x, ho.y, 3);
    await open('F4');
    await rec.wait(1800);
    await k.choose(`${CARD}.querySelector('label[data-path="size"] select')`, '/^M6$/', 2400);
    await k.snap('32d-hole');
    await k.clickEl(`${CARD}.querySelector('.fedit-confirm')`, 'left', 300);
    await k.waitUi(`!${CARD}`, 'the card to close');
    await k.settle();
    await rec.wait(2400);
    await k.snap('32e-end');
    if (process.env.CLIP_DRY) return { id: 'editor-card', dry: true };
    return rec.finish('editor-card', ctx.outDir, ctx.posterDir);
  },
};
