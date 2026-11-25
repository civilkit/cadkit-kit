// Loft without a twist (0.8.15): a circle of radius 25 on the Top plane and a 50 x 30 rectangle on a parallel plane 40 mm above it are lofted; the sides go straight up (the old kernel turned
// the loft about 59 degrees). The clip picks both sketches, lofts them, then turns the view to the side so the straight edges show. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const P = (id, x, y) => ({ id, x, y });
const circle = { type: 'sketch', id: 'F1', name: 'Circle', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 25 }], constraints: [] };
const plane = { type: 'plane', mode: 'offset', base: { kind: 'std', id: 'front' }, offset: 40, name: 'Plane 40', autoName: true, id: 'F2' };
const rect = { type: 'sketch', id: 'F3', name: 'Rectangle', plane: { kind: 'feature', id: 'F2' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, P('p1', -25, -15), P('p2', 25, -15), P('p3', 25, 15), P('p4', -25, 15)],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, a, b]) => ({ id, type: 'line', p1: a, p2: b })), constraints: [] };
export const doc = () => ({ ...newDoc('Circle to rectangle', [circle, plane, rect]), upAxis: 'z' });   // Z up: without upAxis the document opens Y-up and lies on its side
const CARD = `[data-testid=editor-card]`;
const TAB = (n) => `[...document.querySelectorAll('[role=tab], button')].find((b) => b.textContent.trim() === '${n}')`;
const ROW = (id) => `document.querySelector('.tree .row[data-id="${id}"]')`;
const BTN = (label) => `document.querySelector('button[aria-label="${label}"]')`;

export default {
  id: 'loft-no-twist',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: {}, name: 'Circle to rectangle' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const noTip = () => rec.skip(() => page.eval(`document.querySelectorAll('.tip').forEach((e) => e.remove()); 0`));   // a ribbon tooltip left over from the pointer's way
    const hold = async (ms) => { await noTip(); for (let t = 0; t < ms * 0.5; t += 250) await rec.wait(250); };
    const ctrlClickRow = async (id) => {
      const r = await k.rect(ROW(id));
      await k.glide(r.x + 40, r.y, 2);
      await k.step(async () => { for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: r.x + 40, y: r.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, modifiers: 4 }); }, 500);
    };
    await k.step(() => page.key('7'), 300, false);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('86a-sketches');
    await rec.begin();
    rec.x = 1000; rec.y = 620;
    await k.caption('A circle and a rectangle 40 mm above it', 1);
    rec.mark('before');
    await hold(3600);
    await k.caption('Home > Loft: pick both sketches', 2);
    await k.glide(rec.x, 62, 2);   // up the free right side, then along the tab bar: a disabled ribbon button under the pointer leaves its tooltip stuck
    await k.clickEl(TAB('Home'), 'left', 300);
    await k.clickEl(ROW('F1'), 'left', 400);
    await ctrlClickRow('F3');
    await k.snap('86b-picked');
    await hold(1800);
    await k.clickEl(BTN('Loft'), 'left', 200);
    await noTip();
    await k.glide(rec.x, 430, 2);
    await k.glide(820, 640, 2);
    await noTip();
    await k.settle();
    await noTip();
    await k.snap('86c-loft-editor');
    await hold(1500);
    await k.clickEl(`document.querySelector('${CARD} .fedit-confirm')`, 'left', 700);
    await k.settle();
    await k.glide(900, 640, 2);
    await k.caption('The loft goes straight up, no twist', 3);
    await k.snap('86d-loft');
    rec.mark('poster');
    await hold(3600);
    // side views: the edges run straight from the circle to the rectangle corners
    await k.caption('Front view: the sides are straight, no spiral', 4);
    await k.step(() => page.key('2'), 400);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('86e-front');
    await hold(4200);
    await k.caption('Side view: straight from circle to rectangle', 5);
    await k.step(() => page.key('3'), 400);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('86e-side');
    await hold(4200);
    await k.step(() => page.key('7'), 400);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.caption('Errors 0', 6);
    await k.snap('86f-iso');
    await hold(3600);
    if (process.env.CLIP_DRY) return { id: 'loft-no-twist', dry: true };
    return rec.finish('loft-no-twist', ctx.outDir, ctx.posterDir);
  },
};
