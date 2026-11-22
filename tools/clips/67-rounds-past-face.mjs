// Rounds and chamfers larger than their face (0.8.9): a 40 x 20 x 10 mm block with a 5 mm Fillet on the top edge beside its 10 mm high wall. The radius is edited to 15 mm, larger than
// the wall: the round now builds (it stays on the top face), the status bar shows Warnings 1 and Diagnostics shows the blendRanOffFace warning, Errors stay 0, and Mass properties reads
// the part. Then 30 mm, larger than the top face as well (both contacts run off): the Fillet is refused with its message and the Errors count says 1. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const SK = { type: 'sketch', id: 'F1', name: 'Block outline', plane: { kind: 'std', id: 'front' }, points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 40, y: 0 }, { id: 'p3', x: 40, y: 20 }, { id: 'p4', x: 0, y: 20 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, a, b]) => ({ type: 'line', id, p1: a, p2: b })), constraints: [] };
const FEATURES = [
  SK,
  { type: 'extrude', id: 'F2', name: 'Block', op: 'add', sketch: 'F1', end: 'blind', depth: 10 },
  { type: 'fillet', id: 'F3', name: 'Edge round', radius: 5, edges: [{ faces: ['F2.C1', 'F2.S.e1'], at: [20, 0, 10] }] },
];
export const doc = () => newDoc('Block with a big round', [...FEATURES]);
const RADIUS = `document.querySelector('label[data-path="radius"] input')`;
const STATUS = (re) => `[...document.querySelectorAll('.status *')].filter((e) => ${re}.test(e.textContent.trim())).pop()`;

export default {
  id: 'rounds-past-face',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: undefined });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    const setRadius = async (v) => {
      const rf = await k.rect(RADIUS);
      await k.click(rf.x, rf.y, 'left', 300);
      await k.step(() => page.eval(`(() => { const i = ${RADIUS}; i.focus(); i.select(); })()`), 250);
      await k.step(() => page.send('Input.insertText', { text: String(v) }), 400);
      await k.step(() => page.key('Tab'), 250);
      await k.settle();
    };
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('67a-part');
    await rec.begin();
    rec.x = 1000; rec.y = 620;
    await k.caption('A 40 x 20 x 10 mm block with a 5 mm round on its top edge', 1);
    await hold(2000);
    // ---- open the Fillet and make the radius 15: bigger than the 10 mm wall beside the edge
    await k.clickEl(k.row(/Edge round/), 'left', 300);
    await k.step(() => page.eval(`(() => { const r = ${k.row(/Edge round/)}; r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`), 400, false);
    try { await k.waitUi(`!!${RADIUS}`, 'the Fillet editor', 30000); } catch (e) { await k.snap('67x-editor'); throw e; }
    await k.settle();
    await k.snap('67b-editor');
    await k.caption('Radius 15 mm: more than the 10 mm wall beside the edge', 2);
    await setRadius(15);
    await page.eval(`document.querySelectorAll('.toast button').forEach((b) => b.click()); 0`);
    await k.snap('67c-r15');
    rec.mark('poster');
    await hold(2000);
    // ---- the warning: status bar, then Diagnostics
    await k.caption('It builds, with a blendRanOffFace warning in Diagnostics', 3);
    await k.clickEl(`document.querySelector('[data-testid=editor-card] .fedit-confirm')`, 'left', 700);
    await k.settle();
    await k.clickEl(STATUS(/^Warnings/), 'left', 600);
    await k.settle(800);
    await k.snap('67d-diag');
    await hold(3000);
    // ---- valid, and a mass reading
    await k.caption('Errors 0, and Mass properties measures it', 4);
    await k.clickEl(`[...document.querySelectorAll('button, input')].find((b) => /Search commands/.test((b.textContent ?? '') + (b.getAttribute('placeholder') ?? '') + (b.getAttribute('aria-label') ?? '')))`, 'left', 500);
    await k.typeOut('mass prop', 110);
    await rec.wait(900);
    await k.clickEl(`[...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Mass properties')`, 'left', 600);
    await k.settle(1500);
    await k.waitUi(`/Volume/.test(document.querySelector('#mass-card, .insp-card')?.innerText ?? '')`, 'the mass card');
    await k.snap('67e-mass');
    await hold(3000);
    // ---- 30 mm: bigger than the top face too, both contacts run off: refused
    await k.key('\\');   // close the drawer, so the editor has room for its message
    await k.settle(600);
    await k.caption('Radius 30 mm: past the top face as well, so it is refused', 5);
    await k.clickEl(k.row(/Edge round/), 'left', 300);
    await k.step(() => page.eval(`(() => { const r = ${k.row(/Edge round/)}; r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`), 400, false);
    await k.waitUi(`!!${RADIUS}`, 'the Fillet editor', 30000);
    await k.settle();
    await setRadius(30);
    await k.snap('67f-r30');
    await hold(2000);
    await k.clickEl(`document.querySelector('[data-testid=editor-card] .fedit-confirm')`, 'left', 700);
    await k.settle();
    await k.clickEl(STATUS(/^Errors/), 'left', 600);
    await k.settle(800);
    await k.snap('67g-err');
    await hold(3000);
    if (process.env.CLIP_DRY) return { id: 'rounds-past-face', dry: true };
    return rec.finish('rounds-past-face', ctx.outDir, ctx.posterDir);
  },
};
