// A fillet on a smooth closed free-form rim works (0.8.18): a closed spline outline extruded 25 mm; Fillet is opened, the top rim picked (the whole smooth rim is one pick), radius 10 mm typed:
// the preview shows the rounded rim, the tick builds it, Errors 0. Load-tolerant (see clipkit.mjs).
import { openDoc, kit, PRESET } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const pts = [[-12.9, 66.8], [61.2, 51.2], [71.3, -12.2], [21.4, 0], [-29.3, -24.8], [-71.8, -16.1], [-114.3, 13.5], [-72.7, 24.6], [-68.2, 59.1]];
const sketch = { type: 'sketch', id: 'F1', name: 'Outline', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...pts.map(([x, y], i) => ({ id: 'q' + i, x, y }))],
  entities: [{ id: 'e1', type: 'spline', pts: pts.map((_, i) => 'q' + i), closed: true }], constraints: [] };
export const doc = () => ({ ...newDoc('Blob', [sketch, { type: 'extrude', id: 'F2', name: 'Blob', op: 'add', sketch: 'F1', end: 'blind', depth: 25 }]), upAxis: 'z' });

export default {
  id: 'spline-fillet',
  viewport: [1600, 1000],
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: PRESET, name: 'Blob' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    const CARD = `[data-testid=editor-card]`;
    const noTip = () => rec.skip(() => page.eval(`document.querySelectorAll('.tip').forEach((e) => e.remove()); 0`));
    const hold = async (ms) => { await noTip(); for (let t = 0; t < ms * 0.35; t += 250) await rec.wait(250); };
    await page.eval(`(() => { const st = document.createElement('style'); st.textContent = '.toast{display:none !important}'; document.head.appendChild(st); return 1; })()`);
    await k.settle();
    await rec.begin();
    rec.x = 1400; rec.y = 900;
    await k.caption('A smooth free-form outline, extruded 25 mm', 1);
    await hold(4000);
    await k.caption('Fillet: pick the top rim', 2);
    await k.click(832, 666, 'left', 600);
    await k.hop(1400, 900);
    await k.snap('98a-picked');
    await hold(2500);
    await k.step(() => page.eval(`document.querySelector('button[aria-label="Fillet"]').click(); 0`), 400, false);
    await k.waitUi(`!!document.querySelector('${CARD}')`, 'the Fillet editor', 150000);
    await k.settle();
    await k.snap('98b-editor');
    await hold(2500);
    await k.caption('Radius 10 mm: the whole smooth rim is rounded', 3);
    const F = `document.querySelector('${CARD} label[data-path="radius"] input')`;
    const r = await k.rect(F);
    await k.click(r.x, r.y, 'left', 300);
    await k.step(() => page.eval(`(() => { const i = ${F}; i.focus(); i.select(); })()`), 250);
    await k.step(() => page.send('Input.insertText', { text: '10' }), 400);
    await k.step(() => page.key('Tab'), 250);
    await k.settle(1500);
    await k.hop(1400, 900);
    await noTip();
    await k.snap('104c-preview');
    rec.mark('poster');
    await hold(5000);
    await k.clickEl(`document.querySelector('${CARD} .fedit-confirm')`, 'left', 600);
    await k.waitUi(`!document.querySelector('${CARD}')`, 'the editor to close', 60000);
    await k.settle();
    await k.hop(1400, 900);
    await noTip();
    await k.caption('Built: Errors 0', 4);
    await k.snap('104d-built');
    await hold(6000);
    if (process.env.CLIP_DRY) return { id: 'spline-fillet', dry: true };
    return rec.finish('spline-fillet', ctx.outDir, ctx.posterDir);
  },
};
