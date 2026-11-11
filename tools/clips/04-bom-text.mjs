// The bill of materials copies as plain text (aligned columns, ready for an e-mail), next to Save CSV.
export default {
  id: 'bom-text',
  async run(rec, ctx) {
    await ctx.openApp();
    await ctx.openSample('assembly-block-bolt');
    await rec.begin();
    await rec.wait(900);
    await rec.click(`[...document.querySelectorAll('button, [role=tab]')].find((b) => b.textContent.trim() === 'Assembly')`);
    await rec.wait(700);
    await rec.click(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'BOM')`);
    await rec.waitFor(`!!document.querySelector('.asm-bom')`, 'the bill of materials');
    await rec.wait(1200);
    await rec.page.eval(`document.querySelector('.asm-bom').scrollIntoView({ block: 'center' })`);
    await rec.wait(900);
    rec.mark('poster');
    await rec.click(`[...document.querySelectorAll('.asm-bar button')].find((b) => /copy text/i.test(b.textContent))`);
    await rec.wait(2600);
    return rec.finish('bom-text', ctx.outDir, ctx.posterDir);
  },
};
