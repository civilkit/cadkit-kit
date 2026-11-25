// Tangent edges layer: a knurled cylinder (diamond knurl, 40 teeth), zoomed on a band of diamond facets. Display > Show > Tangent edges on draws the
// diagonal lines inside each flank; off hides them and keeps the crease outlines; on again. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const circ = (id, r) => ({ type: 'sketch', id, name: 'Circle', plane: { kind: 'std', id: 'top' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'c1', type: 'circle', c: 'c', r }], constraints: [] });
const FEATURES = [
  circ('F1', 10),
  { type: 'extrude', id: 'F2', name: 'Cylinder', op: 'add', sketch: 'F1', end: 'blind', depth: 20 },
  { type: 'knurlBand', id: 'F3', name: 'Knurl', axis: 'y', center: [0, 0], radius: 10, from: 4, to: 16, pattern: 'diamond', count: 40 },
];
export const doc = () => ({ ...newDoc('Knurled cylinder', [...FEATURES]), upAxis: 'z' });
const TANGENT = `[...document.querySelectorAll('.display-pop .display-row')].find((r) => /Tangent edges/.test(r.textContent))?.querySelector('input')`;

export default {
  id: 'tangent-edges',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), {});
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    // open the Display popover and leave it open while the layer changes, so the viewer sees where the switch is
    const openPop = async () => {
      await k.clickEl(`document.querySelector('.display-btn')`, 'left', 700);
      await k.waitUi(`!!${TANGENT}`, 'the Tangent edges row');
    };
    const toggle = async (want, snap) => {
      if ((await page.eval(`${TANGENT}.checked`)) !== want) await k.clickEl(`${TANGENT}.closest('label')`, 'left', 400);
      await k.settle();
      await k.snap(snap);
      await hold(3000);
    };
    const closePop = async () => { await k.key('Escape'); await k.settle(); };
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.zoom(691, 346, -6);
    await k.settle();
    await k.snap('83a-zoomed');
    await rec.begin();
    rec.x = 1000; rec.y = 620;
    await k.caption('Knurl with the Tangent edges layer on', 1);
    rec.mark('poster');
    await hold(3500);
    await openPop();
    await k.caption('Display > Tangent edges: switch it off', 2);
    await toggle(false, '83b-off');
    await k.caption('The lines inside each smooth flank are gone', 3);
    await hold(2500);
    await closePop();
    await k.caption('The creases between flanks stay', 4);
    await hold(2500);
    await openPop();
    await k.caption('Switch it on again', 5);
    await toggle(true, '83c-on');
    await closePop();
    await hold(1500);
    if (process.env.CLIP_DRY) return { id: 'tangent-edges', dry: true };
    return rec.finish('tangent-edges', ctx.outDir, ctx.posterDir);
  },
};
