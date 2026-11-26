// A D shape rounded in one feature (0.8.19): a half-ellipse outline closed by a straight line, extruded 20 mm. In Edge mode the top rim (curve and straight) and the two vertical corner
// edges are picked with the Fillet tool and rounded together at 3 mm, so the corners round as a smooth sphere patch. Load-tolerant (see clipkit.mjs).
import { openDoc, kit, PRESET } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const A = 40, B = 25;
const ang = [0, 30, 60, 90, 120, 150, 180];
const pts = ang.map((d) => [+(A * Math.cos(d * Math.PI / 180)).toFixed(3), +(-B * Math.sin(d * Math.PI / 180)).toFixed(3)]);
const sketch = { type: 'sketch', id: 'F1', name: 'D outline', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...pts.map(([x, y], i) => ({ id: 'q' + i, x, y }))],
  entities: [{ id: 'e1', type: 'spline', pts: pts.map((_, i) => 'q' + i) }, { id: 'e2', type: 'line', p1: 'q6', p2: 'q0' }], constraints: [] };
export const doc = () => ({ ...newDoc('D shape', [sketch, { type: 'extrude', id: 'F2', name: 'D shape', op: 'add', sketch: 'F1', end: 'blind', depth: 20 }]), upAxis: 'z' });

export default {
  id: 'd-shape-corner',
  viewport: [1600, 1000],
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: PRESET, name: 'D shape' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await page.eval(`(() => { const st = document.createElement('style'); st.textContent = '.toast{display:none !important}'; document.head.appendChild(st); return 1; })()`);
    const CARD = `[data-testid=editor-card]`;
    const noTip = () => rec.skip(() => page.eval(`document.querySelectorAll('.tip').forEach((e) => e.remove()); 0`));
    const hold = async (ms) => { await noTip(); for (let t = 0; t < ms * 0.35; t += 250) await rec.wait(250); };
    await k.settle();
    await rec.begin();
    rec.x = 1400; rec.y = 900;
    await k.caption('A D shape, extruded 20 mm', 1);
    await hold(3500);
    await k.caption('Edge mode: pick the curved rim, then open Fillet', 2);
    await k.key('e');
    await k.click(1104, 326, 'left', 500);
    await k.hop(1400, 900);
    await k.snap('107a-picked');
    await hold(1500);
    await k.step(() => page.eval(`document.querySelector('button[aria-label="Fillet"]').click(); 0`), 400, false);
    await k.waitUi(`!!document.querySelector('${CARD}')`, 'the Fillet editor', 150000);
    await k.settle();
    await k.caption('Add the straight rim and both vertical corner edges', 3);
    await k.click(1134, 510, 'left', 500);
    await k.click(922, 750, 'left', 500);
    await k.click(1348, 403, 'left', 500);
    await k.hop(1400, 900);
    await k.snap('107b-four');
    await hold(3000);
    const F = `document.querySelector('${CARD} label[data-path="radius"] input')`;
    await k.caption('One fillet, radius 3 mm: the corners round as a sphere', 4);
    const r = await k.rect(F);
    await k.click(r.x, r.y, 'left', 300);
    await k.step(() => page.eval(`(() => { const i = ${F}; i.focus(); i.select(); })()`), 250);
    await k.step(() => page.send('Input.insertText', { text: '3' }), 400);
    await k.step(() => page.key('Tab'), 250);
    await k.settle(1500);
    await k.hop(1400, 900);
    await noTip();
    await k.snap('107c-preview');
    console.error('PREVIEW_STATUS', await page.eval(`document.querySelector('.status')?.innerText.replace(/\\s+/g, ' ')`));
    console.error('ALERT_EL', await page.eval(`[...document.querySelectorAll('.status [title], .status button')].map((e) => (e.title || '') + '|' + e.textContent.trim()).join(' ; ')`));
    console.error('CARD', await page.eval(`document.querySelector('${CARD}')?.innerText.replace(/\\s+/g, ' ')`));
    rec.mark('poster');
    await hold(4500);
    await k.clickEl(`document.querySelector('${CARD} .fedit-confirm')`, 'left', 600);
    await k.waitUi(`!document.querySelector('${CARD}')`, 'the editor to close', 120000);
    await k.settle();
    await k.hop(1400, 900);
    await noTip();
    await k.caption('Built: Errors 0', 5);
    await k.snap('107d-built');
    await hold(5000);
    if (process.env.CLIP_DRY) return { id: 'd-shape-corner', dry: true };
    return rec.finish('d-shape-corner', ctx.outDir, ctx.posterDir);
  },
};
