// The Case wizard (Features > Create > Case): the fields with their defaults, Round the edges set to Side and top edges (radius 5 and 2) and the tongue moved to the base with the live preview following,
// Add case (the case stands upright), the Bodies panel with Base and Lid, then the lip: the lid hidden so the tongue on the base rim shows while the view turns, the base hidden so
// the groove of the lid shows, both back. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

export const emptyDoc = () => newDoc('Case', []);
const BTN = (label) => `[...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title) === '${label}')`;
const FIELD = (path) => `document.querySelector('.tree-wrap label[data-path="${path}"] input')`;
const EYE = (n) => `document.querySelectorAll('.tree-wrap [aria-label^="Show body"], .tree-wrap [aria-label^="Hide body"]')[${n}]`;

export default {
  id: 'case-wizard',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, emptyDoc());
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    k.log('loaded');
    await rec.begin();
    rec.x = 760; rec.y = 560;
    await rec.wait(1200);
    // ---- the Create group of the Features tab: Gear and its siblings are one slot; right-click opens the list, Case is in it
    const g = await k.rect(BTN('Gear'));
    await k.glide(g.x, g.y, 3);
    await k.step(async () => { await page.mouse('mousePressed', g.x, g.y, 'right'); await page.mouse('mouseReleased', g.x, g.y, 'right'); }, 600);
    await k.waitUi(`!!document.querySelector('[data-testid=cmd-add-case]')`, 'the Case command');
    await k.snap('22a-features');
    await rec.wait(1400);
    await k.clickEl(`document.querySelector('[data-testid=cmd-add-case]')`, 'left', 300);
    await k.waitUi(`!!${FIELD('width')} && !!document.querySelector('.tree-wrap [data-testid=case-wizard]')`, 'the Case wizard');
    await k.settle();
    await rec.wait(3000);                       // the fields and the preview of the defaults
    await k.snap('22b-wizard');
    k.log('wizard');
    // ---- type a value into a field, then Tab so the preview follows
    const edit = async (path, text, hold = 2600) => {
      const f = await k.rect(FIELD(path));
      await k.click(f.x, f.y, 'left', 200);
      await k.step(() => page.eval(`(() => { const i = ${FIELD(path)}; i.focus(); i.select(); })()`), 250);
      await k.typeOut(text, 300);
      await k.step(() => page.key('Tab'), 300);
      await k.settle();
      await rec.wait(hold);
    };
    await k.choose(`document.querySelector('.tree-wrap label[data-path="round"] select')`, '/^Side and top edges$/', 2800);   // both radius fields appear (5 and 2); the preview rounds
    await k.snap('22c-radius');
    await k.choose(`document.querySelector('.tree-wrap label[data-path="tongueOn"] select')`, '/^Base$/', 2000);   // the tongue on the base, the groove in the lid
    await k.snap('22d2-tongue');
    k.log('edited');
    // ---- Add case: one folder, two bodies
    await k.clickEl(`document.querySelector('[data-testid=case-apply]')`, 'left', 40);
    await k.hop(760, 560);                         // the pointer leaves the tree at once: no row hover tint on the new case
    await k.waitUi(`!document.querySelector('.tree-wrap [data-testid=case-wizard]')`, 'the case to be added');
    await k.settle();
    await k.step(() => page.mouse('mouseMoved', 760, 560), 100, false);
    await rec.wait(1200);
    await k.snap('22e-added');
    await k.clickEl(BTN('Bodies'), 'left', 300);
    await k.waitUi(`document.querySelectorAll('.tree-wrap [aria-label^="Hide body"]').length === 2`, 'the two bodies');
    await rec.wait(2000);                       // Base and Lid in the Bodies panel
    await k.snap('22f-bodies');
    k.log('bodies');
    await k.key('Escape');                        // clear the selection left by Add case
    // ---- hide the lid: the tongue on the base rim; turn the view
    await k.clickEl(EYE(1), 'left', 300);
    await k.settle();
    await rec.wait(1500);
    await k.drag(1150, 600, 1220, 606, 4);       // the view turns about 35 degrees, towards the open face
    await rec.wait(700);
    await k.drag(1220, 606, 1290, 612, 4);
    await rec.wait(1400);
    rec.mark('poster');
    await k.snap('22g-base');
    k.log('base');
    // ---- show the lid, hide the base: the groove of the lid
    await k.clickEl(EYE(1), 'left', 300);
    await k.settle();
    await k.clickEl(EYE(0), 'left', 300);
    await k.settle();
    await rec.wait(900);
    await k.drag(1150, 600, 1220, 530, 4);      // the view tips under the lid, to look into the groove
    await rec.wait(1700);
    await k.snap('22h-lid');
    k.log('lid');
    // ---- both back, the view turned up again
    await k.drag(1220, 530, 1150, 600, 4);
    await rec.wait(300);
    await k.clickEl(EYE(0), 'left', 300);
    await k.settle();
    await k.step(() => page.mouse('mouseMoved', 760, 620), 100, false);
    await rec.wait(1500);
    await k.snap('22i-end');
    k.log('done');
    if (process.env.CLIP_DRY) return { id: 'case-wizard', dry: true };
    return rec.finish('case-wizard', ctx.outDir, ctx.posterDir);
  },
};
