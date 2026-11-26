// Helpers for the sketch clips of 0.8.17: a new sketch on the Top plane and the mm-to-pixel mapping. Not a clip (record.mjs loads NN-name.mjs only).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

export const SLOT = (s) => `(document.querySelector('.slot[data-slot="${s}"] .slot-btn') || document.querySelector('.slot[data-slot="${s}"]'))`;
export async function sketchTop(rec, ctx, name, { extra = {} } = {}) {
  const { page } = ctx;
  await ctx.openApp();
  await openDoc(ctx, { ...newDoc(name, []), upAxis: 'z' }, { workspace: null, extra });
  await page.eval(`document.querySelector('.start-close')?.click(); 0`);
  const k = kit(rec, ctx);
  const pc = async (expr) => { const [x, y] = await rec.rect(expr); await page.mouse('mouseMoved', x, y); await k.sleep(200); await page.mouse('mousePressed', x, y); await page.mouse('mouseReleased', x, y); await k.sleep(600); };
  await pc(`document.querySelector('.slot[data-slot="new-sketch"] .slot-more') || document.querySelector('.slot[data-slot="new-sketch"] .slot-btn')`);
  await k.waitUi(`!!document.querySelector('.slot-flyout [data-testid="cmd-sketch-new-top"]')`, 'the plane list');
  await pc(`document.querySelector('[data-testid="cmd-sketch-new-top"]')`);
  await k.waitUi(`!!document.querySelector('[data-action="sketch-ok"]')`, 'the sketch');
  await k.settle();
  const readout = async (x, y) => { await page.mouse('mouseMoved', x, y); await k.sleep(350); return (await page.eval(`(document.querySelector('.status')?.textContent.match(/(-?[0-9.]+) mm, (-?[0-9.]+) mm/) || []).slice(1, 3).join(',')`)).split(',').map(Number); };
  const a = await readout(500, 300), b = await readout(1500, 700);
  const kk = 1000 / (b[0] - a[0]), ox = 500 - a[0] * kk, oy = 300 + a[1] * kk;
  const P = (x, y) => [ox + x * kk, oy - y * kk];
  const clickMm = (x, y, mod = 0) => { const [px, py] = P(x, y); return k.glide(px, py, 3).then(() => k.step(async () => { for (const [t, bt] of [['mousePressed', 1], ['mouseReleased', 0]]) await page.send('Input.dispatchMouseEvent', { type: t, x: px, y: py, button: 'left', buttons: bt, clickCount: 1, modifiers: mod }); await k.sleep(1200); }, 300)); };
  const esc = () => k.step(async () => { await page.key('Escape'); await k.sleep(900); }, 200);
  const type = async (text) => { for (const ch of text) await k.step(() => page.send('Input.insertText', { text: ch }), 220); };
  return { k, P, clickMm, esc, type, page };
}
