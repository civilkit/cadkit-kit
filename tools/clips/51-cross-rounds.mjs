// Rounds that meet across a face (0.8.5): a 4 x 10 x 20 mm prism with a Fillet of radius 2.5 on its two top long edges (the two rounds are wider together than the
// 4 mm face between them). The Fillet builds, the tree row carries an amber mark, the pointer rests on it (its tooltip is the plain-language message), a click opens
// the Diagnostics tab with the message in full, and the status bar says Warnings 1. The part is made from numbers in this file. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const FEATURES = [{"type":"sketch","id":"F1","plane":{"kind":"std","id":"top"},"points":[{"id":"p1","x":0,"y":0},{"id":"p2","x":4,"y":0},{"id":"p3","x":4,"y":10},{"id":"p4","x":0,"y":10}],"entities":[{"type":"line","id":"e1","p1":"p1","p2":"p2"},{"type":"line","id":"e2","p1":"p2","p2":"p3"},{"type":"line","id":"e3","p1":"p3","p2":"p4"},{"type":"line","id":"e4","p1":"p4","p2":"p1"}],"constraints":[]},{"type":"extrude","id":"F2","op":"add","sketch":"F1","end":"blind","depth":20},{"type":"fillet","id":"F3","radius":2.5,"edges":[{"faces":["F2.S.e1","F2.S.e4"],"at":[0,10,0]},{"faces":["F2.S.e1","F2.S.e2"],"at":[4,10,0]}]}];

export default {
  id: 'cross-rounds',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, newDoc('Crossing rounds', FEATURES), { workspace: null });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.waitUi(`!!document.querySelector('.row-warn')`, 'the warning mark');
    await k.snap('51a-part');
    await rec.begin();
    rec.x = 900; rec.y = 560;
    await rec.wait(2000);
    // the amber mark sits at the end of the Fillet row: first seen on its own, then the pointer rests on the row (its tooltip is the message)
    rec.mark('poster');
    await rec.wait(2600);
    const r = await k.rect(`document.querySelector('.row-warn')`);
    await k.glide(r.x - 120, r.y, 5);
    await rec.wait(1500);
    await k.snap('51b-warn');
    // the status bar: Warnings 1 opens the Diagnostics tab with the message in full
    await k.clickEl(`[...document.querySelectorAll('.status *')].find((e) => e.children.length === 0 && /^Warnings/.test(e.textContent.trim())) ?.closest('button, .st-item') || [...document.querySelectorAll('.status *')].find((e) => /^Warnings/.test(e.textContent.trim()))`, 'left', 600);
    await k.settle(800);
    await rec.wait(1500);
    await k.snap('51c-diag');
    await rec.wait(4000);
    if (process.env.CLIP_DRY) return { id: 'cross-rounds', dry: true };
    return rec.finish('cross-rounds', ctx.outDir, ctx.posterDir);
  },
};
