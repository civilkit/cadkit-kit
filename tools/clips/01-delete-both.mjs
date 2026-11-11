// Delete both: deleting a sketch that an extrude uses is blocked; the notice names the extrude and offers to delete both.
export default {
  id: 'delete-both',
  async run(rec, ctx) {
    await ctx.openApp();
    await ctx.openSample('mounting-plate');
    await rec.begin();
    await rec.wait(900);
    const sketchRow = `[...document.querySelectorAll('.row')].find((r) => r.querySelector('.row-id')?.textContent === 'F1')`;
    await rec.click(`${sketchRow}?.querySelector('.row-name')`);
    await rec.wait(600);
    await rec.click(`${sketchRow}?.querySelector('.row-del')`);
    await rec.waitFor(`[...document.querySelectorAll('button')].some((b) => /delete both/i.test(b.textContent))`, 'the blocked-delete notice');
    rec.mark('poster');
    await rec.wait(2200);
    await rec.click(`[...document.querySelectorAll('button')].find((b) => /delete both/i.test(b.textContent))`);
    await rec.wait(2000);
    return rec.finish('delete-both', ctx.outDir, ctx.posterDir);
  },
};
