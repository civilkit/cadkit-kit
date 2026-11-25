// Loft rail smoothing (0.8.10): a loft through three circles (10, 30 and 12 mm radius, 20 and 40 mm apart). Natural (the default) runs one smooth curve through the three
// profiles and bulges past the widest middle one; Local keeps the loft between its profiles; Automatic takes local when natural bulges. Errors stay 0 and the Mass properties volume
// shows the three differ. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const circ = (id, name, plane, r) => ({ type: 'sketch', id, name, plane, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r }], constraints: [] });
const FEATURES = [
  circ('F1', 'Bottom circle', { kind: 'std', id: 'front' }, 10),
  { type: 'plane', mode: 'offset', base: { kind: 'std', id: 'front' }, offset: 20, name: 'Plane 20', autoName: true, id: 'F2' },
  circ('F3', 'Middle circle', { kind: 'feature', id: 'F2' }, 30),
  { type: 'plane', mode: 'offset', base: { kind: 'std', id: 'front' }, offset: 60, name: 'Plane 60', autoName: true, id: 'F4' },
  circ('F5', 'Top circle', { kind: 'feature', id: 'F4' }, 12),
  { type: 'loft', op: 'new', name: 'Bulb', sketches: ['F1', 'F3', 'F5'], id: 'F6' },
];
export const doc = () => ({ ...newDoc('Loft with rail smoothing', [...FEATURES]), upAxis: 'z' });   // built along Z: without upAxis it opens Y-up and lies on its side
const RAILSEL = `document.querySelector('label[data-path="railSmoothing"] select')`;
const STATUS = (re) => `[...document.querySelectorAll('.status *')].filter((e) => ${re}.test(e.textContent.trim())).pop()`;
const VOL = `(() => { const t = document.querySelector('#mass-card, .insp-card')?.innerText ?? ''; const m = /Volume[^0-9-]*([0-9][0-9,. ]*)/.exec(t); return m ? m[1].trim() : t.slice(0, 120); })()`;

export default {
  id: 'rail-smoothing',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: undefined });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    const probe = [];
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('75a-part');
    await rec.begin();
    rec.x = 1000; rec.y = 620;
    await k.caption('A loft through three circles: 10, 30 and 12 mm radius', 1);
    await hold(2200);
    await k.clickEl(k.row(/Bulb/), 'left', 300);
    await k.step(() => page.eval(`(() => { const r = ${k.row(/Bulb/)}; r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`), 400, false);
    try { await k.waitUi(`!!${RAILSEL}`, 'the Rail smoothing choice', 30000); } catch (e) { await k.snap('75x-editor'); throw e; }
    await k.settle();
    await k.snap('75b-editor');
    await k.caption('Natural (default): one smooth curve, it swells past the middle circle', 2);
    await k.snap('75c-natural');
    rec.mark('poster');
    await hold(3200);
    await k.caption('Local: each section stays between its two circles', 3);
    await k.choose(RAILSEL, /Local/);
    await k.settle();
    await k.snap('75d-local');
    await hold(3200);
    await k.caption('Automatic: chooses for you (here it keeps the natural shape)', 4);
    await k.choose(RAILSEL, /Automatic/);
    await k.settle();
    await k.snap('75e-auto');
    await hold(3200);
    await k.clickEl(`document.querySelector('[data-testid=editor-card] .fedit-confirm')`, 'left', 700);
    await k.settle();
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.caption('Errors 0', 5);
    await k.snap('75f-done');
    await hold(2500);
    if (process.env.CLIP_DRY) return { id: 'rail-smoothing', dry: true, probe };
    return rec.finish('rail-smoothing', ctx.outDir, ctx.posterDir);
  },
};
