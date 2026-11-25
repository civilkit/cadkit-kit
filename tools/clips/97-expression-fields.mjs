// Expression fields (0.8.17): in the Extrude editor the Depth box takes a sum, a unit or a variable: 20+20 previews 40 under the box, 1in reads 25.4, w/2 with w = 30 reads 15, and an
// unknown name says so under the box. Enter on 20+20 makes a 40 mm extrusion. Load-tolerant (see clipkit.mjs).
import { openDoc, kit, PRESET } from './clipkit.mjs';
import { rectSketch, newDoc } from '../doc_shots_defs.mjs';

const outline = rectSketch('F1', 'Outline', 'front', 40, 30, { cx: -20, cy: -15 });
export const doc = () => ({ ...newDoc('Block', [outline]), upAxis: 'z' });
const CARD = `[data-testid=editor-card]`;
const FIELD = `document.querySelector('${CARD} label[data-path="depth"] input')`;

export default {
  id: 'expression-fields',
  viewport: [1600, 1000],
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: PRESET, name: 'Block' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const sleep = k.sleep;
    // off camera: the variable w = 30 in the Variables panel
    const tab = async (name) => { await page.eval(`document.querySelector('[aria-label="${name}"]').click()`); await sleep(600); };
    await tab('Variables');
    await page.eval(`document.querySelector('[data-testid="vars-add"]').click()`); await sleep(400);
    await page.eval(`(() => { const r = [...document.querySelectorAll('.vars-row[data-var]')].find((x) => /^var\\d+$/.test(x.dataset.var)); const i = r.querySelector('.vars-name'); i.focus(); i.select(); })()`);
    await page.send('Input.insertText', { text: 'w' }); await page.key('Enter'); await sleep(500);
    await page.eval(`(() => { const i = document.querySelector('.vars-row[data-var="w"]').querySelectorAll('input')[1]; i.focus(); i.select(); })()`);
    await page.send('Input.insertText', { text: '30' }); await page.key('Enter'); await sleep(500);
    await tab('Features');
    await page.eval(`(() => { const st = document.createElement('style'); st.textContent = '.toast{display:none !important}'; document.head.appendChild(st); return 1; })()`);
    const noTip = () => rec.skip(() => page.eval(`document.querySelectorAll('.tip').forEach((e) => e.remove()); 0`));
    const hold = async (ms) => { await noTip(); for (let t = 0; t < ms * 0.35; t += 250) await rec.wait(250); };
    const typeInto = async (text) => {
      const r = await k.rect(FIELD);
      await k.click(r.x, r.y, 'left', 300);
      await k.step(() => page.eval(`(() => { const i = ${FIELD}; i.focus(); i.select(); })()`), 250);
      await k.step(() => page.send('Input.insertText', { text }), 600);
      await k.settle(800);
      await k.hop(1400, 900);
      await noTip();
    };
    await k.settle();
    await rec.begin();
    rec.x = 1400; rec.y = 900;
    await k.caption('A 40 x 30 mm outline: Extrude', 1);
    await k.clickEl(`document.querySelector('.tree .row[data-id="F1"]')`, 'left', 400);
    await k.hop(1400, 900);
    await k.step(() => page.eval(`document.querySelector('button[aria-label="Extrude"]').click(); 0`), 400, false);
    await k.waitUi(`!!document.querySelector('${CARD} label[data-path="depth"] input')`, 'the Extrude editor', 30000);
    await k.settle();
    await k.snap('97a-editor');
    await hold(3000);
    await k.caption('Type a sum: 20+20', 2);
    await typeInto('20+20');
    await k.snap('97b-sum');
    rec.mark('poster');
    await hold(3500);
    await k.caption('A unit: 1in is 25.4 mm', 3);
    await typeInto('1in');
    await k.snap('97c-unit');
    await hold(3500);
    await k.caption('A variable: w/2, with w = 30', 4);
    await typeInto('w/2');
    await k.snap('97d-var');
    await hold(3500);
    await k.caption('A name that does not exist is said so', 5);
    await typeInto('q/2');
    await k.snap('97e-unknown');
    await hold(4000);
    await k.caption('20+20 again: Enter builds 40 mm', 6);
    await typeInto('20+20');
    await k.clickEl(`document.querySelector('${CARD} .fedit-confirm')`, 'left', 500);
    await k.waitUi(`!document.querySelector('${CARD}')`, 'the editor to close', 60000);
    await k.settle();
    await k.hop(1400, 900);
    await noTip();
    await k.snap('97f-built');
    await hold(5000);
    if (process.env.CLIP_DRY) return { id: 'expression-fields', dry: true };
    return rec.finish('expression-fields', ctx.outDir, ctx.posterDir);
  },
};
