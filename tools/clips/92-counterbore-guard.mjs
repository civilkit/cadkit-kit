// Counterbore wider than the part is refused (0.8.16): on a 30 x 30 x 8 mm plate the Hole editor is set to Counterbore with a head diameter of 50 mm. The editor stays open and
// says why in red (the kernel's sentence and advice); the model is untouched (Errors 0). A diameter of 12 mm fits: the message goes and the hole builds. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { rectSketch, newDoc } from '../doc_shots_defs.mjs';

const plate = rectSketch('F1', 'Plate outline', 'front', 30, 30, { cx: -15, cy: -15 });
const centre = { type: 'sketch', id: 'F3', name: 'Hole centre', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'h1', x: 0, y: 0 }], entities: [{ id: 'e1', type: 'point', p: 'h1' }], constraints: [] };
export const doc = () => ({ ...newDoc('Plate', [plate, { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 8 }, centre]), upAxis: 'z' });
const CARD = `[data-testid=editor-card]`;
const FIELD = (p) => `document.querySelector('${CARD} label[data-path="${p}"] input')`;

export default {
  id: 'counterbore-guard',
  viewport: [1400, 1000],
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: {}, name: 'Plate' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    await page.eval(`(() => { const st = document.createElement('style'); st.textContent = '.toast{display:none !important}'; document.head.appendChild(st); return 1; })()`);   // the toast repeats the message in the card
    const noTip = () => rec.skip(() => page.eval(`document.querySelectorAll('.tip').forEach((e) => e.remove()); 0`));
    const hold = async (ms) => { await noTip(); for (let t = 0; t < ms * 0.35; t += 250) await rec.wait(250); };
    const typeInto = async (EXPR, text) => {
      const r = await k.rect(EXPR);
      await k.click(r.x, r.y, 'left', 300);
      await k.step(() => page.eval(`(() => { const i = ${EXPR}; i.focus(); i.select(); })()`), 250);
      await k.step(() => page.send('Input.insertText', { text }), 400);
      await k.step(() => page.key('Tab'), 250);
      await k.settle();
      await k.hop(1200, 900);
      await noTip();
    };
    await k.settle();
    await rec.begin();
    rec.x = 1200; rec.y = 900;
    await k.caption('A plate 30 x 30 mm, 8 mm thick', 1);
    await hold(4500);
    await k.clickEl(`document.querySelector('.tree .row[data-id="F3"]')`, 'left', 400);
    await k.hop(1200, 900);
    await k.caption('Home > Hole: choose Counterbore', 2);
    await k.step(() => page.eval(`document.querySelector('button[aria-label="Hole"]').click(); 0`), 400, false);
    await noTip();
    await k.waitUi(`!!document.querySelector('${CARD} label[data-path="kind"] select')`, 'the Hole editor', 30000);
    await k.settle();
    await k.choose(`document.querySelector('${CARD} label[data-path="kind"] select')`, /Counterbore/, 300);
    await k.hop(1200, 900);
    await noTip();
    await k.snap('92a-cbore');
    await hold(3500);
    await k.caption('A counterbore 50 mm wide: wider than the plate', 3);
    await typeInto(FIELD('cboreDiameter'), '50');
    await k.snap('92b-wide');
    await hold(2500);
    await k.caption('The editor refuses it and says why', 4);
    rec.mark('poster');
    await k.snap('92c-refused');
    await hold(9000);
    await k.caption('A counterbore 12 mm wide fits the plate', 5);
    await typeInto(FIELD('cboreDiameter'), '12');
    await k.snap('92d-fits');
    await hold(3500);
    await k.clickEl(`document.querySelector('${CARD} .fedit-confirm')`, 'left', 500);
    await k.waitUi(`!document.querySelector('${CARD}')`, 'the Hole editor to close', 60000);
    await k.settle();
    await k.click(1250, 700, 'left', 400);   // empty viewport: the hole's drag handles go
    await k.settle();
    await k.hop(1200, 900);
    await noTip();
    await k.caption('The hole builds: Errors 0', 6);
    await k.snap('92e-built');
    await hold(6500);
    if (process.env.CLIP_DRY) return { id: 'counterbore-guard', dry: true };
    return rec.finish('counterbore-guard', ctx.outDir, ctx.posterDir);
  },
};
