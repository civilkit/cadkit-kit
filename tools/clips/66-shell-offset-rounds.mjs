// Shell and offset a rounded part (0.8.8): a 60 x 40 x 24 mm block from numbers with 6 mm rounds on its four vertical edges. Pick the flat top and Shell it (2 mm wall): the block
// is hollowed and the rounds are kept, with Errors 0. Then a flat wall next to two of the rounds is picked and offset with Press Pull: the rounds travel with the wall, and the part rebuilds and stays valid.
// Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

// a 60 x 40 x 24 mm block (sketch on the Top plane, so its height runs along the sketch normal) with 6 mm rounds on its four vertical edges
const SK = { type: 'sketch', id: 'F1', name: 'Block outline', plane: { kind: 'std', id: 'top' }, points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 60, y: 0 }, { id: 'p3', x: 60, y: 40 }, { id: 'p4', x: 0, y: 40 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, a, b]) => ({ type: 'line', id, p1: a, p2: b })), constraints: [] };
const FEATURES = [
  SK,
  { type: 'extrude', id: 'F2', name: 'Block', op: 'add', sketch: 'F1', end: 'blind', depth: 24 },
  { type: 'fillet', id: 'F3', name: 'Corner rounds', radius: 6, edges: [
    { faces: ['F2.S.e1', 'F2.S.e2'], at: [60, 6, 0] }, { faces: ['F2.S.e2', 'F2.S.e3'], at: [60, 6, -40] },
    { faces: ['F2.S.e3', 'F2.S.e4'], at: [0, 6, -40] }, { faces: ['F2.S.e4', 'F2.S.e1'], at: [0, 6, 0] }] },
];
export const doc = () => newDoc('Rounded block', [...FEATURES]);

export default {
  id: 'shell-offset-rounds',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: undefined });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    const CARD = `document.querySelector('[data-testid=editor-card]')`;
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('66a-part');
    await rec.begin();
    rec.x = 1000; rec.y = 620;
    await k.caption('A block with rounded corners', 1);
    await hold(3000);
    const vp = await k.rect(`document.querySelector('#vp canvas') || document.querySelector('canvas')`);
    await k.caption('Pick the top face, then Shell', 2);
    await k.click(813, 250, 'left', 500);   // the flat top (the round along the rim is a different face)
    await k.settle(600);
    await k.snap('66b-picked');
    await k.clickEl(`document.querySelector('[data-testid="cmd-add-shell"]')`, 'left', 600);
    await k.glide(1050, 640, 3);
    await k.waitUi(`!!${CARD}`, 'the Shell editor', 60000);
    await k.settle();
    await k.snap('66c-shell-editor');
    await hold(2500);
    await k.clickEl(`${CARD}.querySelector('.fedit-confirm')`, 'left', 700);
    await k.settle();
    await page.eval(`document.querySelectorAll('.toast button').forEach((b) => b.click()); 0`);
    await k.caption('Hollowed with the rounds kept: Errors 0', 3);
    await k.snap('66d-shelled');
    rec.mark('poster');
    await hold(3500);
    // ---- a wall next to two rounds: Press Pull offsets it, the rounds travel with it
    await k.caption('Pick a wall beside two rounds, then Press Pull', 4);
    await k.click(680, 410, 'left', 500);
    await k.settle(600);
    await k.snap('66e-wall');
    await k.caption('Press Pull offsets the wall: the rounds go with it', 5);
    await k.clickEl(`document.querySelector('[data-testid="cmd-add-press-pull"]')`, 'left', 300);
    await k.glide(1500, 720, 5);
    try { await k.waitUi(`!!${CARD}`, 'the Press Pull editor', 30000); } catch (e) { await k.snap('66x-pp-fail'); throw e; }
    await k.settle();
    await k.snap('66f-presspull');
    await hold(3000);
    await k.clickEl(`${CARD}.querySelector('.fedit-confirm')`, 'left', 700);
    await k.settle();
    await page.eval(`document.querySelectorAll('.toast button').forEach((b) => b.click()); 0`);
    await k.caption('Still hollow, still valid: Errors 0', 6);
    await k.drag(1000, 300, 1000, 400, 8);
    await k.settle(600);
    await k.snap('66g-done');
    await hold(4000);
    if (process.env.CLIP_DRY) return { id: 'shell-offset-rounds', dry: true };
    return rec.finish('shell-offset-rounds', ctx.outDir, ctx.posterDir);
  },
};
