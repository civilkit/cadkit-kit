// Wrap text onto a cylinder (0.8.10): a mug-shaped tube standing on the Top plane (axis up) with lettering sketched on the Front plane, which holds the axis, wrapped onto the outside face as an engraving (Wrap, Features > Solids).
// The Wrap editor is opened and the depth edited (0.5 mm, then 1.5 mm), then the lettering is slid along the axis. Errors stay 0. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const FEATURES = [
  { type: 'sketch', id: 'F1', name: 'Mug outline', plane: { kind: 'std', id: 'top' }, points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 0, y: 0 }],
    entities: [{ type: 'circle', id: 'e1', c: 'p1', r: 30 }, { type: 'circle', id: 'e2', c: 'p2', r: 27 }], constraints: [] },
  { type: 'extrude', id: 'F2', name: 'Mug', op: 'add', sketch: 'F1', end: 'blind', depth: 70 },
  { type: 'sketch', id: 'F3', name: 'Lettering', plane: { kind: 'std', id: 'front' }, points: [],
    entities: [{ type: 'text', id: 't1', string: 'CADKIT', font: 'gauge', height: 12, at: [0, 35], anchor: ['center', 'middle'] }], constraints: [] },
  { type: 'wrap', id: 'F4', name: 'Engraving', sketch: 'F3', face: 'F2.S.e1', op: 'cut', depth: 0.5, method: 'auto', alongAxis: 0, around: 40, rotation: 0, taper: 0, flip: false, tolerance: 0.001 },
];
export const doc = () => newDoc('Wrap text onto a mug', [...FEATURES]);
const FIELD = (p) => `document.querySelector('label[data-path="${p}"] input')`;
const STATUS = (re) => `[...document.querySelectorAll('.status *')].filter((e) => ${re}.test(e.textContent.trim())).pop()`;

export default {
  id: 'wrap-text',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: undefined });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    const setField = async (p, v) => {
      const rf = await k.rect(FIELD(p));
      await k.click(rf.x, rf.y, 'left', 300);
      await k.step(() => page.eval(`(() => { const i = ${FIELD(p)}; i.focus(); i.select(); })()`), 250);
      await k.step(() => page.send('Input.insertText', { text: String(v) }), 400);
      await k.step(() => page.key('Tab'), 250);
      await k.settle();
    };
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('73a-part');
    await rec.begin();
    rec.x = 1000; rec.y = 620;
    await k.caption('CADKIT is engraved around this mug with Wrap', 1);
    await hold(2200);
    await k.clickEl(k.row(/Engraving/), 'left', 300);
    await k.step(() => page.eval(`(() => { const r = ${k.row(/Engraving/)}; r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`), 400, false);
    try { await k.waitUi(`!!${FIELD('depth')}`, 'the Wrap editor', 30000); } catch (e) { await k.snap('73x-editor'); throw e; }
    await k.settle();
    await k.snap('73b-editor');
    await k.caption('The Wrap feature: a lettering sketch cut 0.5 mm into the round face', 2);
    rec.mark('poster');
    await hold(2500);
    await k.caption('Depth 1.5 mm: a deeper engraving', 3);
    await setField('depth', 1.5);
    await k.snap('73c-depth');
    await hold(2500);
    await k.caption('Slide it up the mug: 12 mm along the axis', 4);
    await setField('alongAxis', 12);
    await k.snap('73d-along');
    await hold(2500);
    await k.clickEl(`document.querySelector('[data-testid=editor-card] .fedit-confirm')`, 'left', 700);
    await k.settle();
    await k.caption('Errors 0', 5);
    await k.snap('73e-done');
    await hold(2500);
    if (process.env.CLIP_DRY) return { id: 'wrap-text', dry: true };
    return rec.finish('wrap-text', ctx.outDir, ctx.posterDir);
  },
};
