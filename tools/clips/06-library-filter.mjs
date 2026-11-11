// The Library filter: a category menu and tags (with counts) narrow the cards, and Clear brings everything back.
export default {
  id: 'library-filter',
  async run(rec, ctx) {
    await ctx.openApp();
    await rec.begin();
    await rec.wait(700);
    await rec.click(`document.querySelector('button[aria-label="Library"]')`);
    await rec.waitFor(`!!document.querySelector('[data-testid="lib-filterbar"]') && document.querySelectorAll('.dlg-item').length > 0`, 'the Library filter');
    await rec.wait(1800);
    // pick the category with most parts (after All) through its menu
    const cat = await rec.page.eval(`(() => { const s = document.querySelector('[data-testid="lib-filterbar"] select'); const o = [...s.options].slice(1).sort((a, b) => +(b.textContent.match(/\\((\\d+)\\)/)?.[1] ?? 0) - +(a.textContent.match(/\\((\\d+)\\)/)?.[1] ?? 0))[0]; return o.value; })()`);
    await rec.click(`document.querySelector('[data-testid="lib-filterbar"] select')`);
    await rec.page.eval(`(() => { const s = document.querySelector('[data-testid="lib-filterbar"] select'); s.value = ${JSON.stringify(cat)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await rec.wait(1600);
    rec.mark('poster');
    await rec.click(`document.querySelector('[data-testid="lib-filterbar"] .lf-chip')`);
    await rec.wait(2200);
    await rec.click(`document.querySelector('[data-testid="lib-clear"]')`);
    await rec.wait(1800);
    return rec.finish('library-filter', ctx.outDir, ctx.posterDir);
  },
};
