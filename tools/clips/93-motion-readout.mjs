// Motion timeline readout keeps its width (0.8.16): on the hinge-door sample a study has keys at 0 s (0 degrees) and 2 s (90 degrees), duration 10 s. The time bar is dragged and the study is
// played while the time readout ("0.00 / 10.00 s") and the angle label in the Motion panel change; red guide lines (drawn by the clip, not by the app) mark the left edges of Play, Speed and
// the readout box and the right edge of the readout: they stay on the same spot while the digits change. Load-tolerant (see clipkit.mjs).
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDoc, kit } from './clipkit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DOOR = JSON.parse(readFileSync(resolve(here, '../../apps/cad/public/samples/assembly-hinge-door.ckpart'), 'utf8'));
const HINGE = `[...document.querySelectorAll('input[type=range]')].find((i) => (i.getAttribute('aria-label') || '').startsWith('Hinge'))`;
const SCRUB = `document.querySelector('.mtl-scrub')`;

export default {
  id: 'motion-readout',
  viewport: [1280, 800],
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, DOOR, { workspace: null, name: DOOR.name });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const click = (txt) => page.eval(`(() => { const e = [...document.querySelectorAll('[role=tab], .tab, button')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(txt)})); if (e) e.click(); return !!e; })()`);
    const setv = (sel, v) => page.eval(`(() => { const el = ${sel}; if (!el) return 0; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(String(v))}); el.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    const noTip = () => rec.skip(() => page.eval(`document.querySelectorAll('.tip').forEach((e) => e.remove()); 0`));
    const hold = async (ms) => { await noTip(); for (let t = 0; t < ms * 0.35; t += 250) await rec.wait(250); };
    const cap = (t, n) => k.caption(t, n);   // the pill sits up in the empty viewport (the style below): the bottom of the picture is the timeline
    await page.eval(`(() => { const st = document.createElement('style'); st.textContent = '.toast{display:none !important} #__cap{bottom:auto !important;top:150px !important;left:62% !important}'; document.head.appendChild(st); return 1; })()`);
    // ---- set up the study off camera: keys at 0 s (0 deg) and 2 s (90 deg), duration 10 s
    await k.settle();
    await click('Motion'); await k.sleep(1000);
    await click('New study'); await k.sleep(1000);
    await click('Sliders'); await k.sleep(800);
    await k.waitUi(`!!(${HINGE}) && !!(${SCRUB})`, 'the hinge slider and the time bar', 60000);
    await page.eval(`document.querySelector('button.mtl-key')?.click(); 0`); await k.sleep(500);
    await setv(SCRUB, 2); await k.sleep(500);
    await setv(HINGE, 90); await k.sleep(600);
    await page.eval(`document.querySelector('button.mtl-key')?.click(); 0`); await k.sleep(500);
    await page.eval(`(() => { const f = [...document.querySelectorAll('.mtl-f')].find((l) => /duration/i.test(l.textContent)); const i = f.querySelector('input'); i.focus(); i.select(); })()`);
    await page.send('Input.insertText', { text: '10' }); await page.key('Enter'); await page.eval(`document.activeElement?.blur()`); await k.sleep(500);
    await setv(SCRUB, 0); await k.sleep(800);
    console.error('TIME', await page.eval(`document.querySelector('.mtl-time')?.textContent`), 'LABEL', await page.eval(`document.querySelector('[data-driver] > span')?.textContent`));
    // ---- guide lines at the controls of the bar (drawn by the clip): left edges of Play, Speed, the readout box, and the readout's right edge
    await page.eval(`(() => {
      const t = document.querySelector('.mtl-time'); const bar = t.parentElement;
      const rs = [...bar.children].map((c) => c.getBoundingClientRect());
      const play = [...bar.querySelectorAll('button')].find((b) => /^(Play|Pause)/.test(b.textContent.trim())).getBoundingClientRect();
      const speed = bar.querySelector('select').getBoundingClientRect();
      const tr = t.getBoundingClientRect();
      const xs = [[play.left, 'Play'], [speed.left, 'Speed'], [tr.left, ''], [tr.right, '']];
      const top = Math.min(play.top, tr.top) - 12, h = Math.max(play.bottom, tr.bottom) - top + 12;
      for (const [x] of xs) { const d = document.createElement('div'); d.className = '__guide'; d.style.cssText = 'position:fixed;left:' + (x - 1) + 'px;top:' + top + 'px;width:2px;height:' + h + 'px;background:#ff3b30;opacity:.85;z-index:2147483000;pointer-events:none'; document.documentElement.appendChild(d); }
      const b = document.createElement('div'); b.className = '__guide'; b.style.cssText = 'position:fixed;left:' + (tr.left - 3) + 'px;top:' + (tr.top - 3) + 'px;width:' + (tr.width + 6) + 'px;height:' + (tr.height + 6) + 'px;border:2px dashed #ff3b30;border-radius:4px;z-index:2147483000;pointer-events:none';
      document.documentElement.appendChild(b);
    })()`);
    await k.settle();
    const bar = await k.rect(SCRUB);   // x is the centre of the track
    const x0 = bar.x - bar.w / 2 + 8, x1 = bar.x + bar.w / 2 - 8, y = bar.y;
    const xAt = (t) => x0 + (x1 - x0) * t / 10;
    await rec.begin();
    rec.x = 900; rec.y = 300;
    await cap('Hinge door study: 0 degrees at 0 s, 90 at 2 s', 1);
    await hold(3200);
    await cap('Drag the time bar: the readout and the angle change', 2);
    await k.drag(xAt(0), y, xAt(1.23), y, 8);
    await k.hop(900, 300);
    await hold(2000);
    await k.snap('93a-t1');
    await k.drag(xAt(1.23), y, xAt(10), y, 14);
    await k.hop(900, 300);
    await hold(1700);
    await k.snap('93b-t10');
    await cap('The readout keeps its width as the time changes', 3);
    rec.mark('poster');
    await k.drag(xAt(10), y, xAt(0.4), y, 16);
    await k.hop(900, 300);
    await hold(1700);
    await k.drag(xAt(0.4), y, xAt(4.6), y, 12);
    await k.hop(900, 300);
    await k.snap('93c-t46');
    await hold(1700);
    // ---- play it: the digits run, Play / Speed and the bar stay put
    await cap('Play: time and angle run, the controls stay put', 4);
    await k.step(() => page.eval(`[...document.querySelectorAll('.mtl-bar button')].find((b) => /^Play/.test(b.textContent.trim())).click(); 0`), 300, false);
    await noTip();
    for (let i = 0; i < 9; i++) await rec.wait(350);
    await k.snap('93d-play');
    await k.step(() => page.eval(`[...document.querySelectorAll('.mtl-bar button')].find((b) => /^(Pause|Stop)/.test(b.textContent.trim()))?.click(); 0`), 300, false);
    await hold(1000);
    if (process.env.CLIP_DRY) return { id: 'motion-readout', dry: true };
    return rec.finish('motion-readout', ctx.outDir, ctx.posterDir);
  },
};
