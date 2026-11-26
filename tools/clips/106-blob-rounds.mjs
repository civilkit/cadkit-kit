// Rounds on a free-form blob (0.8.19): a closed spline outline extruded 25 mm; the top rim is rounded at radius 15 mm, then the radius is changed to 24.9 mm. Both build, Errors 0.
// A crease at the tight tips is expected at the large radius. Load-tolerant (see clipkit.mjs).
import { openDoc, kit, PRESET } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const pts = [[-12.9, 66.8], [61.2, 51.2], [71.3, -12.2], [21.4, 0], [-29.3, -24.8], [-71.8, -16.1], [-114.3, 13.5], [-72.7, 24.6], [-68.2, 59.1]];
const sketch = { type: 'sketch', id: 'F1', name: 'Outline', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...pts.map(([x, y], i) => ({ id: 'q' + i, x, y }))],
  entities: [{ id: 'e1', type: 'spline', pts: pts.map((_, i) => 'q' + i), closed: true }], constraints: [] };
export const doc = () => ({ ...newDoc('Blob', [sketch, { type: 'extrude', id: 'F2', name: 'Blob', op: 'add', sketch: 'F1', end: 'blind', depth: 25 }]), upAxis: 'z' });

export default {
  id: 'blob-rounds',
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
    const F = `document.querySelector('${CARD} label[data-path="radius"] input')`;
    const setRadius = async (v) => {
      const r = await k.rect(F);
      await k.click(r.x, r.y, 'left', 300);
      await k.step(() => page.eval(`(() => { const i = ${F}; i.focus(); i.select(); })()`), 250);
      await k.step(() => page.send('Input.insertText', { text: v }), 400);
      await k.step(() => page.key('Tab'), 250);
      await k.settle(1500);
      await k.hop(1400, 900);
      await noTip();
    };
    const confirm = async () => {
      await k.clickEl(`document.querySelector('${CARD} .fedit-confirm')`, 'left', 600);
      await k.waitUi(`!document.querySelector('${CARD}')`, 'the editor to close', 120000);
      await k.settle();
      await k.hop(1400, 900);
      await noTip();
    };
    await k.settle();
    await rec.begin();
    rec.x = 1400; rec.y = 900;
    await k.caption('A free-form blob, extruded 25 mm', 1);
    await hold(3500);
    await k.caption('Fillet: pick the top rim, radius 15 mm', 2);
    await k.click(832, 666, 'left', 600);
    await k.hop(1400, 900);
    await hold(1500);
    await k.step(() => page.eval(`document.querySelector('button[aria-label="Fillet"]').click(); 0`), 400, false);
    await k.waitUi(`!!document.querySelector('${CARD}')`, 'the Fillet editor', 150000);
    await k.settle();
    await setRadius('15');
    await k.snap('106a-r15');
    rec.mark('poster');
    await hold(4000);
    await confirm();
    await k.caption('Built at 15 mm: Errors 0', 3);
    await k.snap('106b-built15');
    console.error('REBUILD15', await page.eval(`document.querySelector('.status')?.innerText.replace(/\\s+/g, ' ')`));
    await hold(4000);
    await k.step(() => page.eval(`(() => { const r = ${k.row(/Fillet|Edge round/)}; r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`), 400, false);
    await k.waitUi(`!!document.querySelector('${CARD}')`, 'the Fillet editor', 150000);
    await k.settle();
    await k.caption('Change the radius to 24.9 mm', 4);
    await setRadius('24.9');
    await k.snap('106c-r249');
    await hold(3500);
    await confirm();
    await k.caption('Built at 24.9 mm: Errors 0 (a crease at the tight tips is expected)', 5);
    await k.snap('106d-built249');
    console.error('REBUILD249', await page.eval(`document.querySelector('.status')?.innerText.replace(/\\s+/g, ' ')`));
    await hold(6000);
    if (process.env.CLIP_DRY) return { id: 'blob-rounds', dry: true };
    return rec.finish('blob-rounds', ctx.outDir, ctx.posterDir);
  },
};
