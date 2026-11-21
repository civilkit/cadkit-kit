// One path from several pieces (0.8.5). The part is one sketch made from numbers: a line, a tangent arc and a second line that meet end to end (the arc leaves and joins
// the lines without a corner), and a small circle (the pipe profile) at the start of the path. One caption per step: the sketch is picked, Composite curve joins the three pieces
// into one path, Sweep (Add) runs the circle along that one path, which makes a pipe. The view turns at the end. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const front = { kind: 'std', id: 'front' };
const FEATURES = [
  { type: 'sketch', id: 'S1', name: 'Line, arc and line', plane: front, points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 20, y: 0 }, { id: 'c', x: 20, y: 10 }, { id: 'd', x: 30, y: 10 }, { id: 'e', x: 30, y: 30 }],
    entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'arc', c: 'c', p1: 'b', p2: 'd' }, { id: 'e3', type: 'line', p1: 'd', p2: 'e' }], constraints: [] },
  { type: 'plane', id: 'PG', mode: 'frame', origin: [0, 0, 0], xDir: [0, 1, 0], yDir: [0, 0, 1] },
  { type: 'sketch', id: 'S9', name: 'Pipe profile', plane: { kind: 'feature', id: 'PG' }, points: [{ id: 'c', x: 0, y: 0 }], entities: [{ id: 'k', type: 'circle', c: 'c', r: 1 }], constraints: [] },
];

export default {
  id: 'pipe-along-path',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, newDoc('Pipe along a path', FEATURES), { workspace: null });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const CARD = `document.querySelector('[data-testid=editor-card]')`;
    const tab = (name) => k.clickEl(`[...document.querySelectorAll('[role=tab], .tab, button')].find((e) => e.textContent.trim() === '${name}')`, 'left', 600);
    const tool = async (id) => {
      await k.clickEl(`document.querySelector('[data-testid="cmd-${id}"]')`, 'left', 500);
      await k.glide(1050, 640, 3);
      await k.waitUi(`!!${CARD}`, 'the editor card', 60000);
      await k.settle();
    };
    const toasts = `document.querySelectorAll('.toast button').forEach((b) => b.click()); 0`;
    const confirm = async () => { await k.clickEl(`${CARD}.querySelector('.fedit-confirm')`, 'left', 700); await k.settle(); };
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.zoom(900, 560, -2);
    await k.settle();
    await k.snap('56a-start');
    await rec.begin();
    rec.x = 900; rec.y = 560;
    await k.caption('One sketch: a line, a curved piece and another line, end to end. We will make a pipe that follows all three.');
    await rec.wait(3600);
    await tab('Features');
    await k.caption('Pick the sketch with the three pieces', 1);
    await k.clickEl(k.row(/^Line, arc and line|^S1/), 'left', 900);
    await k.settle();
    await k.caption('Composite curve: join the three pieces into one path', 2);
    await tool('add-composite-curve');
    await page.eval(toasts);
    await k.snap('56b-composite');
    await rec.wait(2800);
    await confirm();
    await k.caption('Now the three pieces are one curve, one path', 2);
    await k.snap('56c-joined');
    await rec.wait(2400);
    await k.caption('Pick the small circle, the shape of the pipe', 3);
    await k.clickEl(`(${k.row(/^Pipe profile|^S9/)}).querySelector('.row-name')`, 'left', 900);
    await k.settle();
    await tab('Home');
    await k.caption('Sweep: run the circle along the joined path', 3);
    await k.clickEl(`document.querySelector('[data-slot=loft-sweep] .slot-more')`, 'left', 700);
    await tool('add-sweep');
    await page.eval(toasts);
    const SELS = `[...${CARD}.querySelectorAll('select')]`;
    await k.choose(`${SELS}.find((s) => s.dataset.path === 'path')`, /Composite curve/, 900);
    await page.eval(toasts);
    await k.snap('56d-sweep');
    rec.mark('poster');
    await rec.wait(3000);
    await confirm();
    await page.eval(toasts);
    await k.caption('A pipe: one sweep followed the whole path', 3);
    await k.snap('56e-done');
    await rec.wait(2600);
    await k.drag(780, 560, 740, 540, 8);
    await rec.wait(900);
    await k.drag(740, 540, 800, 570, 8);
    await rec.wait(2600);
    await k.snap('56f-orbit');
    if (process.env.CLIP_DRY) return { id: 'pipe-along-path', dry: true };
    return rec.finish('pipe-along-path', ctx.outDir, ctx.posterDir);
  },
};
