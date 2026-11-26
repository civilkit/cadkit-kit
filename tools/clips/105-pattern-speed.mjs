// A pattern of 50 holes (0.8.19): a 600 x 500 x 10 mm plate with one hole and a 3 x 3 linear pattern of it. In the Linear pattern editor the counts are set to 10 and 5 (50 holes);
// the status bar's Last rebuild stays a small number of seconds. Load-tolerant (see clipkit.mjs).
import { openDoc, kit, PRESET } from './clipkit.mjs';
import { rectSketch, newDoc } from '../doc_shots_defs.mjs';

const plate = rectSketch('F1', 'Plate outline', 'front', 600, 500, { cx: -300, cy: -250 });
const centre = { type: 'sketch', id: 'F3', name: 'Hole centre', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'h1', x: -270, y: -220 }], entities: [{ id: 'e1', type: 'point', p: 'h1' }], constraints: [] };
export const doc = () => ({ ...newDoc('Plate', [plate, { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }, centre,
  { type: 'hole', id: 'F4', name: 'Hole', sketch: 'F3', kind: 'simple', diameter: 10, end: 'through' },
  { type: 'lpattern', id: 'F5', name: 'Hole pattern', seeds: ['F4'], dir: { kind: 'axis', axis: 'x' }, count: 3, spacing: 55, dir2: { kind: 'axis', axis: 'y' }, count2: 3, spacing2: 80 }]), upAxis: 'z' });
const CARD = `[data-testid=editor-card]`;
const FIELD = (p) => `document.querySelector('${CARD} label[data-path="${p}"] input')`;

export default {
  id: 'pattern-speed',
  viewport: [1600, 1000],
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: PRESET, name: 'Plate' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await page.eval(`(() => { const st = document.createElement('style'); st.textContent = '.toast{display:none !important}'; document.head.appendChild(st); return 1; })()`);
    const noTip = () => rec.skip(() => page.eval(`document.querySelectorAll('.tip').forEach((e) => e.remove()); 0`));
    const hold = async (ms) => { await noTip(); for (let t = 0; t < ms * 0.35; t += 250) await rec.wait(250); };
    const typeInto = async (EXPR, text) => {
      const r = await k.rect(EXPR);
      await k.click(r.x, r.y, 'left', 300);
      await k.step(() => page.eval(`(() => { const i = ${EXPR}; i.focus(); i.select(); })()`), 250);
      await k.step(() => page.send('Input.insertText', { text }), 400);
      await k.step(() => page.key('Tab'), 250);
      await k.settle(1200);
      await k.hop(1400, 900);
      await noTip();
    };
    await k.settle();
    await rec.begin();
    rec.x = 1400; rec.y = 900;
    await k.caption('A 600 x 500 mm plate: one hole, patterned 3 x 3', 1);
    await k.snap('105a-start');
    await hold(2000);
    await k.step(() => page.eval(`(() => { const r = ${k.row(/Hole pattern/)}; r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`), 400, false);
    await k.waitUi(`!!document.querySelector('${CARD}')`, 'the Linear pattern editor', 150000);
    await k.settle();
    await k.hop(1400, 900);
    await k.caption('Linear pattern: set the counts to 10 and 5', 2);
    await k.snap('105b-editor');
    await hold(2000);
    await typeInto(FIELD('count'), '10');
    await typeInto(FIELD('count2'), '5');
    await k.snap('105c-counts');
    await k.caption('50 holes: the status bar shows the rebuild time', 3);
    rec.mark('poster');
    await hold(2000);
    await k.clickEl(`document.querySelector('${CARD} .fedit-confirm')`, 'left', 500);
    await k.waitUi(`!document.querySelector('${CARD}')`, 'the editor to close', 120000);
    await k.settle();
    await k.hop(1400, 900);
    await noTip();
    await k.caption('50 holes from one feature: see Last rebuild below', 4);
    await k.snap('105d-built');
    await hold(5000);
    if (process.env.CLIP_DRY) return { id: 'pattern-speed', dry: true };
    return rec.finish('pattern-speed', ctx.outDir, ctx.posterDir);
  },
};
