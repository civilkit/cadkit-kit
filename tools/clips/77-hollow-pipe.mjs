// Hollow pipe (0.8.13): the Pipe editor's Wall field. A path of one line is swept with a round profile: the Wall field left blank gives a solid rod, a wall thickness gives a tube.
// The clip sets Radius 14 and Wall 3 through the editor, then turns the view along the path to look into the open ends. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const P = (id, x, y) => ({ id, x, y });
const path = { type: 'sketch', id: 'F1', name: 'Path', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, P('a', -40, 0), P('b', 40, 0)],
  entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }], constraints: [] };
export const doc = () => ({ ...newDoc('Pipe path', [path]), upAxis: 'z' });   // Z up: without upAxis the document opens Y-up and lies on its side
const CARD = `[data-testid=editor-card]`;
const FIELD = (p) => `document.querySelector('${CARD} label[data-path="${p}"] input')`;

export default {
  id: 'hollow-pipe',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: {}, name: 'Pipe path' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms * 0.6; t += 250) await rec.wait(250); };
    const setField = async (p, text) => {
      await k.clickEl(FIELD(p), 'left', 300);
      await k.step(() => page.eval(`(() => { const i = ${FIELD(p)}; i.focus(); i.select(); })()`), 200, false);
      await k.typeOut(text, 200);
      await k.step(() => page.key('Tab'), 300);
      await k.settle();
    };
    await k.step(() => page.key('7'), 300, false);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('77a-path');
    await rec.begin();
    rec.x = 1000; rec.y = 620;
    await k.caption('A path: one 80 mm line on the Top plane', 1);
    rec.mark('poster');
    await hold(2400);
    await k.clickEl(`document.querySelector('.tree .row[data-id="F1"]')`, 'left', 400);
    await k.clickEl(`document.querySelector('button[aria-label="Pipe"]')`, 'left', 500);
    await k.waitUi(`!!${FIELD('wall')}`, 'the Pipe editor', 30000);
    await k.settle();
    await k.snap('77b-editor');
    await k.caption('Pipe: the Wall field is blank, so the pipe is solid', 2);
    await hold(2600);
    await setField('radius', '14');
    await k.snap('77c-radius');
    await hold(1200);
    await k.caption('Type a Wall of 3 mm: the pipe becomes a tube', 3);
    await setField('wall', '3');
    await k.snap('77d-wall');
    await hold(2400);
    await k.clickEl(`document.querySelector('${CARD} .fedit-confirm')`, 'left', 700);
    await k.settle();
    await k.glide(800, 560, 2);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('77e-built');
    await k.caption('The Right view looks along the pipe: the end is a ring', 4);
    await hold(2200);
    await k.step(() => page.key('3'), 400);   // the Right view: looking along the x axis, into the end of the pipe
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('77f-turned');
    await hold(2600);
    await k.caption('Errors 0', 5);
    await hold(2200);
    if (process.env.CLIP_DRY) return { id: 'hollow-pipe', dry: true };
    return rec.finish('hollow-pipe', ctx.outDir, ctx.posterDir);
  },
};
