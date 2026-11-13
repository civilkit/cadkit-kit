// A two-part case: a shelled box is split with Lip joint (Features > Modify): the editor (plane, tongue, width, clearance), the result as two
// bodies Base and Lid with the tongue and groove, then the lid moved up to show the lip. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { rectSketch, newDoc } from '../doc_shots_defs.mjs';

/** An 80 x 50 x 30 closed box with 2 mm walls (a shell with no open face). */
export const boxDoc = () => newDoc('Case', [rectSketch('F1', 'Case outline', 'front', 80, 50, { cx: -40, cy: -25 }), { type: 'extrude', id: 'F2', name: 'Case', op: 'add', sketch: 'F1', end: 'blind', depth: 30 }, { type: 'shell', id: 'F3', name: 'Shell', faces: [], thickness: 2 }]);

const BTN = (label) => `[...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title) === '${label}')`;
const INPUT = (n) => `document.querySelectorAll('.tree-wrap input')[${n}]`;   // plane, offset, reverse, below, above, tongue height, fraction, centred, clearance

export default {
  id: 'two-part-case',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, boxDoc());
    const k = kit(rec, ctx);
    k.log('loaded');
    await rec.begin();
    rec.x = 700; rec.y = 560;
    await rec.wait(1500);
    // ---- the Lip joint command (Features > Modify): the editor with the plane, the tongue, its size and the clearance of the groove
    await k.clickEl(BTN('Lip joint'), 'left', 300);
    await k.waitUi(`!!document.querySelector('.tree-wrap select') && /Lip joint/.test(document.querySelector('.tree-wrap')?.textContent || '')`, 'the Lip joint editor');
    await rec.wait(3800);
    await k.snap('18a-editor');
    k.log('editor');
    // ---- a taller tongue: type 4 in the Tongue height box
    const h = await k.rect(INPUT(5));
    await k.click(h.x, h.y, 'left', 200);
    await k.step(() => page.eval(`(() => { const i = ${INPUT(5)}; i.focus(); i.select(); })()`), 300);
    await k.typeOut('4', 400);
    await k.step(() => page.key('Tab'), 300);
    await k.settle();
    await rec.wait(2200);
    await k.snap('18b-height');
    // ---- confirm: the case is cut into two bodies
    await k.clickEl(BTN('Confirm'), 'left', 300);
    await k.waitUi(`/Lip joint/.test(document.querySelector('.tree')?.textContent || '') && !document.querySelector('.tree-wrap select')`, 'the joint to be made');
    await k.settle();
    await k.step(() => page.mouse('mouseMoved', 760, 560), 100, false);
    await rec.wait(1800);
    k.log('joint made');
    await k.clickEl(BTN('Bodies'), 'left', 300);
    await k.waitUi(`document.querySelectorAll('.tree-wrap [aria-label^="Hide body"]').length === 2`, 'the two bodies');
    await rec.wait(2800);                            // two bodies in the panel
    await k.snap('18c-bodies');
    // ---- hide the lid: the base shows the tongue on the rim of its walls
    await k.clickEl(`document.querySelectorAll('.tree-wrap [aria-label^="Hide body"]')[1]`, 'left', 300);
    await k.settle();
    await k.step(() => page.mouse('mouseMoved', 760, 600), 100, false);
    await rec.wait(1200);
    await k.drag(760, 600, 700, 600, 6);             // turn the view a little
    await rec.wait(2200);
    rec.mark('poster');
    await rec.wait(1800);
    await k.snap('18d-base');
    k.log('base');
    // ---- the lid back
    await k.clickEl(`document.querySelectorAll('.tree-wrap [aria-label^="Show"], .tree-wrap [aria-label^="Hide"]')[1]`, 'left', 300);
    await k.settle();
    await k.step(() => page.mouse('mouseMoved', 760, 620), 100, false);
    await rec.wait(2400);
    await k.snap('18e-end');
    k.log('done');
    if (process.env.CLIP_DRY) return { id: 'two-part-case', dry: true };
    return rec.finish('two-part-case', ctx.outDir, ctx.posterDir);
  },
};
