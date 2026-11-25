// Gear editor limits (0.8.16): in the spur Gear editor, Pressure angle and Root fillet carry a muted line with their limit ("Up to 26 deg: ...", "Up to 0.5 x module: ...").
// Typing 30 sets the field to 26 and the line turns to "Set to the limit (26)"; 20 brings the range text back; Root fillet 0.6 gives 0.5 and "Set to the limit (0.5)"; a valid pair builds with Errors 0.
// The picture is cropped to the editor and the gear so the lines are readable. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

export const emptyDoc = () => ({ ...newDoc('Gear', []), upAxis: 'z' });
const CARD = `[data-testid=gear-editor]`;
const FIELD = (p) => `document.querySelector('${CARD} label[data-path="${p}"] input')`;

export default {
  id: 'gear-limits',
  viewport: [1400, 900],
  crop: [960, 740, 250, 160],   // ffmpeg order w:h:x:y, in css pixels (the screencast frames are css size): css x 250 to 1210, y 160 to 900: the editor card and the gear
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, emptyDoc(), { workspace: null, name: 'Gear' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    await page.eval(`(() => { const st = document.createElement('style'); st.textContent = '.toast{display:none !important} #__cap{bottom:auto !important;top:180px !important;left:67% !important;max-width:540px !important}'; document.head.appendChild(st); return 1; })()`);
    const noTip = () => rec.skip(() => page.eval(`document.querySelectorAll('.tip').forEach((e) => e.remove()); 0`));
    const hold = async (ms) => { await noTip(); for (let t = 0; t < ms * 0.35; t += 250) await rec.wait(250); };
    const typeInto = async (EXPR, text) => {
      const r = await k.rect(EXPR);
      await k.click(r.x, r.y, 'left', 300);
      await k.step(() => page.eval(`(() => { const i = ${EXPR}; i.focus(); i.select(); })()`), 250);
      await k.step(() => page.send('Input.insertText', { text }), 500);
      await k.step(() => page.key('Tab'), 250);
      await k.settle();
      await k.hop(1150, 820);
      await noTip();
    };
    // ---- the Gear editor, opened off camera (the build of the first gear is cut from the clip)
    await page.eval(`[...document.querySelectorAll('[role=tab], button')].find((b) => b.textContent.trim() === 'Features').click(); 0`);
    await k.sleep(800);
    await page.eval(`document.querySelector('button[aria-label="Gear"]').click(); 0`);
    await k.waitUi(`!!${FIELD('pressureAngle')}`, 'the Gear editor', 60000);
    await k.settle(2500);
    await rec.begin();
    rec.x = 1150; rec.y = 820;
    await k.caption('Spur gear: pressure angle 20, root fillet 0.3', 1);
    await hold(5500);
    await k.caption('Type 30 degrees: it is set to the limit (26)', 2);
    await typeInto(FIELD('pressureAngle'), '30');
    await k.snap('94a-limit26');
    rec.mark('poster');
    await hold(6500);
    await k.caption('Type 20 again: the range text is back', 3);
    await typeInto(FIELD('pressureAngle'), '20');
    await k.snap('94b-back');
    await hold(3500);
    await k.caption('Root fillet 0.6: set to the limit (0.5)', 4);
    await typeInto(FIELD('rootFillet'), '0.6');
    await k.snap('94c-limit05');
    await hold(6500);
    await k.caption('Root fillet 0.3: a valid gear, Errors 0', 5);
    await typeInto(FIELD('rootFillet'), '0.3');
    await k.clickEl(`document.querySelector('[data-testid=gear-editor]').closest('.fedit-card, [data-testid=editor-card]')?.querySelector('.fedit-confirm') || document.querySelector('.fedit-confirm')`, 'left', 600);
    await k.settle(2500);
    await k.hop(1150, 820);
    await noTip();
    await k.snap('94d-built');
    await hold(6000);
    if (process.env.CLIP_DRY) return { id: 'gear-limits', dry: true };
    return rec.finish('gear-limits', ctx.outDir, ctx.posterDir);
  },
};
