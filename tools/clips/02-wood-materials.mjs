// The Material list: more woods, each with its own colour (walnut on the mounting plate).
export default {
  id: 'wood-materials',
  async run(rec, ctx) {
    await ctx.openApp();
    await ctx.openSample('mounting-plate');
    await rec.begin();
    await rec.wait(900);
    await rec.click(`[...document.querySelectorAll('.row')].find((r) => /^Material/.test(r.querySelector('.row-name')?.textContent ?? ''))?.querySelector('.row-name')`);
    await rec.waitFor(`!!document.querySelector('.mat-search')`, 'the material list');
    await rec.wait(700);
    await rec.click(`document.querySelector('.mat-search')`);
    await rec.type('wood', 130);
    await rec.wait(900);
    await rec.click(`document.querySelector('[data-material="maple"]')`);
    await rec.wait(700);
    await rec.click(`document.querySelector('[data-material="walnut"]')`);
    rec.mark('poster');
    await rec.wait(900);
    await rec.click(`document.querySelector('.mat-editor .fedit-confirm')`);
    await rec.wait(2000);
    // turn the part a little, so the grain shows from other angles
    await rec.glide(820, 430, 500);
    await rec.page.mouse('mousePressed', 820, 430);
    for (let i = 1; i <= 24; i++) { await rec.page.mouse('mouseMoved', 820 + i * 1.5, 430 - i * 0.6); await new Promise((r) => setTimeout(r, 55)); }
    await rec.page.mouse('mouseReleased', 856, 416);
    await rec.wait(1800);
    return rec.finish('wood-materials', ctx.outDir, ctx.posterDir);
  },
};
