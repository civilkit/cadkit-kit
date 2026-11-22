// Print plate (0.8.8): a part of five separate bodies of different sizes. Export > Print Plate / Send to Slicer opens the dialog; pick a printer bed (Prusa MK4,
// then Bambu X1C): every body is laid flat and packed on the top-down bed preview with a fit badge and the bed used; Export Plate (.3mf) writes the plate (the
// Send to Slicer button next to it launches an installed desktop slicer in the desktop app). Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { rectSketch, newDoc } from '../doc_shots_defs.mjs';

const box = (n, name, w, d, h, cx, cy) => [rectSketch(`F${n}`, `${name} outline`, 'top', w, d, { cx, cy }), { type: 'extrude', id: `F${n + 1}`, name, op: n === 1 ? 'add' : 'newBody', sketch: `F${n}`, end: 'blind', depth: h }];
export const doc = () => newDoc('Desk set', [
  ...box(1, 'Tray', 90, 60, 12, -160, -30),
  ...box(3, 'Stand', 40, 70, 45, -50, -35),
  ...box(5, 'Clip', 25, 15, 8, 20, -7),
  ...box(7, 'Lid', 70, 50, 6, 70, -25),
  ...box(9, 'Tall peg', 20, 20, 60, 170, -10),
]);
const SEL = (id) => `document.querySelector('[data-testid="${id}"]')`;

export default {
  id: 'print-plate',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc());
    // the dialog's own colours are light-on-dark: the app in its dark theme
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    const k = kit(rec, ctx);
    const cap = async (text, n, top = false) => { await k.caption(text, n); await rec.skip(() => page.eval(`(() => { const e = document.getElementById('__cap'); e.style.left = '640px'; e.style.bottom = ${top} ? 'auto' : '24px'; e.style.top = ${top} ? '16px' : 'auto'; e.style.maxWidth = '720px'; })()`)); await rec.paint(); };
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    await k.settle();
    await rec.begin();
    rec.x = 700; rec.y = 560;
    await cap('A part of five separate bodies', 1);
    await hold(3500);
    await k.snap('60a-part');
    await cap('Export > Print Plate / Send to Slicer', 2);
    await k.clickEl(`document.querySelector('[aria-label="Export"]')`, 'left', 900);
    await k.waitUi(`!!document.querySelector('.export-pop')`, 'the export menu');
    await k.snap('60b-menu');
    await hold(1800);
    await k.clickEl(`[...document.querySelectorAll('.export-row')].find((b) => /Print Plate/.test(b.textContent))`, 'left', 500);
    await k.waitUi(`!!${SEL('print-plate-dialog')} && !!${SEL('print-plate-svg')}`, 'the dialog');
    await k.settle();
    await k.snap('60c-dialog');
    await cap('Every body is laid flat and packed on the bed', 3, true);
    await hold(4500);
    await cap('Choose the printer bed: Prusa MK4', 4, true);
    await k.choose(SEL('print-plate-preset'), '/Prusa MK4/', 1200);
    await k.snap('60d-prusa');
    await hold(3000);
    await cap('Bambu X1C: the plate is packed again', 5, true);
    await k.choose(SEL('print-plate-preset'), '/Bambu.*X1C/', 1200);
    await k.snap('60e-x1c');
    rec.mark('poster');
    await hold(5500);
    await cap('Send to Slicer, or Export Plate as a .3mf', 6, true);
    await k.clickEl(SEL('print-plate-send'), 'left', 200).catch(() => {});
    await k.snap('60f-send');
    await hold(5000);
    if (process.env.CLIP_DRY) return { id: 'print-plate', dry: true };
    return rec.finish('print-plate', ctx.outDir, ctx.posterDir);
  },
};
