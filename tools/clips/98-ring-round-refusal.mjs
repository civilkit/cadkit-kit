// A round on a smooth closed free-form rim is refused at once (0.8.17): a closed spline outline extruded 20 mm; Fillet is opened, the top rim picked, radius 2 typed: the editor says
// in its top line that the rim is a closed smooth free-form curve, and what to do instead; it does not work for tens of seconds first. Load-tolerant (see clipkit.mjs).
import { openDoc, kit, PRESET } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const pts = [[30, 0], [18, 22], [-8, 26], [-30, 6], [-14, -22], [12, -20]];
const sketch = { type: 'sketch', id: 'F1', name: 'Blob outline', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...pts.map(([x, y], i) => ({ id: 'q' + i, x, y }))],
  entities: [{ id: 'e1', type: 'spline', pts: pts.map((_, i) => 'q' + i), closed: true }], constraints: [] };
export const doc = () => ({ ...newDoc('Blob', [sketch, { type: 'extrude', id: 'F2', name: 'Blob', op: 'add', sketch: 'F1', end: 'blind', depth: 20 }]), upAxis: 'z' });

export default {
  id: 'ring-round-refusal',
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
    await k.caption('A smooth free-form outline, extruded 20 mm', 1);
    await hold(4000);
    await k.caption('Fillet: pick the top rim', 2);
    await k.click(960, 311, 'left', 600);
    await k.hop(1400, 900);
    await k.snap('98a-picked');
    await hold(2500);
    await k.step(() => page.eval(`document.querySelector('button[aria-label="Fillet"]').click(); 0`), 400, false);
    await k.waitUi(`!!document.querySelector('${CARD}')`, 'the Fillet editor', 30000);
    await k.settle();
    await k.snap('98b-editor');
    await hold(2500);
    await k.caption('Radius 2 mm: refused at once, with what to do instead', 3);
    const F = `document.querySelector('${CARD} label[data-path="radius"] input')`;
    const r = await k.rect(F);
    await k.click(r.x, r.y, 'left', 300);
    await k.step(() => page.eval(`(() => { const i = ${F}; i.focus(); i.select(); })()`), 250);
    await k.step(() => page.send('Input.insertText', { text: '2' }), 400);
    const T1 = Date.now();
    await k.step(() => page.key('Tab'), 250);
    await rec.waitFor(`/cannot be rounded/.test(document.querySelector('${CARD}')?.textContent || '')`, 'the refusal', 60000).catch(async () => { console.error('NO_REFUSAL'); console.error('CARD', await page.eval(`document.querySelector('${CARD}')?.innerText.replace(/\\s+/g, ' ')`)); console.error('STATUS', await page.eval(`document.querySelector('.status')?.textContent`)); });
    console.error('REFUSAL_AFTER_MS', Date.now() - T1);
    console.error('CARD', await page.eval(`document.querySelector('${CARD}')?.innerText.replace(/\\s+/g, ' ')`));
    rec.mark('poster');
    await k.settle(800);
    await k.hop(1400, 900);
    await noTip();
    await k.snap('98c-refused');
    await hold(12000);
    if (process.env.CLIP_DRY) return { id: 'ring-round-refusal', dry: true };
    return rec.finish('ring-round-refusal', ctx.outDir, ctx.posterDir);
  },
};
