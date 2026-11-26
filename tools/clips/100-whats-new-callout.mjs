// "What's new" callout (0.8.18): after an update a card rises from the version link in the status bar, with an arrow pointing at it: "What's new in CadKit 0.8.18", a line, and a
// button that opens the What's new page; Escape or the X closes it and it does not come back. The clip starts the app as a returning user who last saw 0.8.17. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc, rectSketch } from '../doc_shots_defs.mjs';

const plate = rectSketch('F1', 'Outline', 'front', 40, 30, { cx: -20, cy: -15 });
const doc = () => ({ ...newDoc('Plate', [plate, { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 8 }]), upAxis: 'z' });

export default {
  id: 'whats-new-callout',
  viewport: [1600, 1000],
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
        await openDoc(ctx, doc(), { workspace: null, name: 'Plate', extra: { 'cad.seenVersion': '0.8.17' } });
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 250) await rec.wait(250); };
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    await k.waitUi(`!!document.querySelector('[data-callout], .callout')`, 'the callout', 60000);
    await k.settle();
    await k.snap('100a-callout');
    await rec.begin();
    rec.x = 800; rec.y = 400;
    await k.caption('After an update: What\'s new, pointing at the version', 1);
    await hold(6000);
    await k.snap('100b');
    rec.mark('poster');
    await k.caption('Escape or the X closes it, once', 2);
    await k.key('Escape');
    await k.settle();
    await k.snap('100c-closed');
    await hold(3000);
    if (process.env.CLIP_DRY) return { id: 'whats-new-callout', dry: true };
    return rec.finish('whats-new-callout', ctx.outDir, ctx.posterDir);
  },
};
