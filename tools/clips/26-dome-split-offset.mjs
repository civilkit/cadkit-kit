// Dome and Offset surface on a plain round boss: pick the flat top, raise a dome, then pick the side and offset it to a new surface.
// Load-tolerant (see clipkit.mjs). Public sample: a cylinder made from numbers.
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const boss = () => newDoc('Boss', [
  { type: 'sketch', id: 'F1', name: 'Boss outline', plane: { kind: 'std', id: 'top' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [{ id: 'k1', type: 'circle', c: 'O', r: 30 }], constraints: [] },
  { type: 'extrude', id: 'F2', name: 'Boss', op: 'add', sketch: 'F1', end: 'blind', depth: 24 },
]);
const FIELD = (path) => `document.querySelector('.tree-wrap label[data-path="${path}"] input')`;

export default {
  id: 'dome-split-offset',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, boss(), { workspace: {} });
    const k = kit(rec, ctx);
    const command = async (name) => {
      await k.key('f');
      await k.waitUi(`!!document.querySelector('[role=dialog] input, .cmdk input, input[placeholder*="Search"]')`, 'the command search');
      await k.step(() => page.send('Input.insertText', { text: name }), 900);
      await k.step(() => page.key('Enter'), 300);
      await k.settle();
    };
    await page.key('7'); await k.sleep(800);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click()`); await k.settle();
    await rec.begin();
    rec.x = 760; rec.y = 620;
    await rec.wait(900);
    const [cx, cy] = await rec.rect(`document.querySelector('#vp canvas')`);
    // ---- the flat top, then Dome
    await k.click(cx, cy - 70, 'left', 400);
    await rec.wait(700);
    await command('Dome');
    await k.waitUi(`!!${FIELD('height')}`, 'the Dome editor');
    await rec.wait(900);
    const f = await k.rect(FIELD('height'));
    await k.click(f.x, f.y, 'left', 200);
    await k.step(() => page.eval(`(() => { const i = ${FIELD('height')}; i.focus(); i.select(); })()`), 250);
    await k.step(() => page.send('Input.insertText', { text: '18' }), 400);   // a taller dome reads from the iso view
    await k.step(() => page.key('Tab'), 250);
    await k.settle();
    await rec.wait(2200);
    rec.mark('poster');
    k.log('dome');
    // ---- the side face, then Offset surface
    await k.key('Escape');
    await k.click(cx + 45, cy + 40, 'left', 400);
    await rec.wait(700);
    await command('Offset surface');
    await k.waitUi(`!!${FIELD('distance')}`, 'the Offset surface editor');
    await rec.wait(2200);
    k.log('offset');
    if (process.env.CLIP_DRY) return { id: 'dome-split-offset', dry: true };
    return rec.finish('dome-split-offset', ctx.outDir, ctx.posterDir);
  },
};
