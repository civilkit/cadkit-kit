// Plugin preview in a sketch (0.8.12): in a new sketch on the Top plane a rectangle is drawn; the Plugins tile of the Sketch ribbon (Reference group) lists the generators that draw into the open
// sketch; the Honeycomb plugin (installed beforehand, off camera, from the app's Community Hub) opens its form and the curves it would add are drawn in the sketch in amber; a value is changed and the
// preview follows; Add draws them into the sketch (the status says how many) and one undo takes them all out, the rectangle stays. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const TID = (id) => `document.querySelector('[data-testid="${id}"]')`;
const HUB_ID = 'solidcraft-honeycomb';

export default {
  id: 'plugin-sketch-preview',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, { ...newDoc('Plugin preview', []), upAxis: 'z' }, { workspace: null });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    await page.eval(`(() => { const st = document.createElement('style'); st.textContent = '#__cap{left:72% !important;bottom:auto !important;top:158px !important;max-width:560px !important;font-size:17px !important}'; document.head.appendChild(st); })()`);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    // ---- off camera: install Honeycomb from the Community Hub, as a user would
    await rec.skip(async () => {
      await page.eval(`(() => { const b = [...document.querySelectorAll('button, input')].find((b) => /Search commands/.test((b.textContent ?? '') + (b.getAttribute('placeholder') ?? '') + (b.getAttribute('aria-label') ?? ''))); b.click(); })()`);
      await new Promise((r) => setTimeout(r, 600));
    });
    await k.typeOut('community', 20);
    await k.snap('79a-search');
    await k.clickEl(`[...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^Community Hub/.test(e.textContent.trim()) && e.closest('.pal, [role=dialog], [role=listbox]'))`, 'left', 400);
    await k.waitUi(`!!${TID('hub-dialog')} && document.querySelectorAll('.hub-card').length > 0`, 'the Hub', 60000);
    await k.settle(600);
    await k.snap('79b-hub');
    await k.step(() => page.eval(`${TID('hub-action-' + HUB_ID)}.click(); 0`), 400, false);
    await k.snap('79c-clicked');
    await rec.skip(async () => {
      for (let i = 0; i < 60; i++) {
        const st = await page.eval(`JSON.stringify({ gate: !!${TID('hub-plugin-gate-toggle')}, confirm: !!${TID('hub-plugin-confirm-btn')}, manual: !!${TID('hub-manual-zip')}, err: ${TID('hub-action-err')}?.textContent ?? '' })`);
        const s = JSON.parse(st);
        if (s.gate) { await page.eval(`${TID('hub-plugin-gate-toggle')}.click(); 0`); await new Promise((r) => setTimeout(r, 800)); await page.eval(`${TID('hub-action-' + HUB_ID)}.click(); 0`); }
        if (s.confirm || s.manual || s.err) { console.error('hub state', st); break; }
        await new Promise((r) => setTimeout(r, 1000));
      }
    });
    await k.snap('79d-confirm');
    await k.step(() => page.eval(`${TID('hub-plugin-confirm-btn')}.click(); 0`), 400, false);
    try { await k.waitUi(`/Installed/i.test(${TID('hub-action-' + HUB_ID)}?.textContent ?? '') || !!${TID('hub-action-ok')}`, 'the install', 40000); } catch (e) { await k.snap('79x-install'); throw e; }
    await k.snap('79e-installed');
    await k.step(() => page.eval(`${TID('hub-close')}.click(); 0`), 400, false);
    await k.settle();
    await rec.begin();
    rec.x = 900; rec.y = 520;
    await k.caption('Draw an outline', 1);
    await rec.wait(800);
    await k.clickEl(`document.querySelector('.slot[data-slot="new-sketch"] .slot-more') || document.querySelector('.slot[data-slot="new-sketch"] .slot-btn')`, 'left', 900);
    await k.waitUi(`!!document.querySelector('.slot-flyout [data-testid="cmd-sketch-new-top"]')`, 'the plane list');
    await k.clickEl(`document.querySelector('.slot-flyout [data-testid="cmd-sketch-new-top"]')`, 'left', 300);
    await k.waitUi(`!!document.querySelector('[data-action="sketch-ok"]')`, 'the sketch');
    await k.settle();
    await k.snap('79f-sketch');
    await k.clickEl(`document.querySelector('[data-slot="rectangle"] .slot-btn, [data-slot="rectangle"]')`, 'left', 600);
    await k.snap('79g-rect-tool');
    await k.click(560, 250, 'left', 300);
    await k.glide(760, 400, 3);
    await rec.skip(async () => { for (let i = 0; i < 20 && !(await page.eval(`!!document.querySelector('.sketch-fields input')`)); i++) { await page.mouse('mouseMoved', 760 + (i % 2), 400); await new Promise((r) => setTimeout(r, 300)); } });
    await k.snap('79h-first');
    await k.step(() => page.eval(`(() => { const i = document.querySelector('.sketch-fields input'); i.focus(); i.select(); })()`), 300);
    for (const ch of '60') await k.step(() => page.send('Input.insertText', { text: ch }), 200);
    await k.step(() => page.key('Tab'), 250);
    for (const ch of '40') await k.step(() => page.send('Input.insertText', { text: ch }), 200);
    await k.snap('79h2-typed');
    await k.step(() => page.key('Enter'), 300);
    await k.settle(600);
    await k.snap('79i-rect');
    await k.key('Escape');
    await k.caption('Plugins tile in the Sketch ribbon', 2);
    const TILE = `document.querySelector('[data-slot="sketch-plugins"] .slot-btn') || document.querySelector('[data-slot="sketch-plugins"]')`;
    await k.step(() => page.eval(`(() => { const t = ${TILE}; let a = t.parentElement; while (a && !(a.scrollWidth > a.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(a).overflowX))) a = a.parentElement; if (a) a.scrollLeft += t.getBoundingClientRect().left - (a.getBoundingClientRect().left + a.clientWidth / 2); })()`), 600, false);
    await k.snap('79j-ribbon');
    await rec.wait(1200);
    await k.clickEl(TILE, 'left', 700);
    await k.waitUi(`!!${TID('plugin-panel')}`, 'the plugin list');
    await k.settle(600);
    await k.snap('79k-list');
    await rec.wait(900);
    await k.clickEl(`document.querySelector('[data-testid^="plugin-item-"][data-testid*="oneycomb"]') || [...document.querySelectorAll('[data-testid^="plugin-item-"]')].find((e) => /honeycomb/i.test(e.textContent))`, 'left', 700);
    try { await k.waitUi(`!!${TID('plugin-note')} && /amber/.test(${TID('plugin-note')}.textContent)`, 'the preview note', 60000); } catch (e) { await k.snap('79x-form'); throw e; }
    await k.settle(800);
    await k.snap('79l-form');
    await k.caption('Preview in amber while the form is open', 3);
    rec.mark('poster');
    await hold(2500);
    const SIZE = `[...document.querySelectorAll('label.fedit-fld')].find((l) => /Hexagon size/.test(l.textContent)).querySelector('input')`;
    await k.caption('Change a value: the preview updates', 4);
    await k.clickEl(SIZE, 'left', 500);
    await k.step(() => page.eval(`(() => { const i = ${SIZE}; i.focus(); i.select(); })()`), 300);
    await k.typeOut('16', 350);
    await k.settle(900);
    await k.snap('79m-size16');
    await hold(2500);
    await k.caption('Add: the curves go into the sketch', 5);
    await k.clickEl(TID('plugin-apply'), 'left', 900);
    await k.settle(900);
    await k.snap('79n-added');
    await hold(2500);
    await k.caption('One undo removes them all', 6);
    await k.key('z', { ctrl: true });
    await k.settle(900);
    await k.snap('79o-undone');
    await hold(2500);
    if (process.env.CLIP_DRY) return { id: 'plugin-sketch-preview', dry: true };
    return rec.finish('plugin-sketch-preview', ctx.outDir, ctx.posterDir);
  },
};
