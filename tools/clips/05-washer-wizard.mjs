// The Washer wizard: pick a standard size (ISO 7089, DIN 127 B spring washers) and it lands as one tree folder.
export default {
  id: 'washer-wizard',
  async run(rec, ctx) {
    await ctx.openApp();
    await rec.begin();
    await rec.wait(900);
    await rec.click(`[...document.querySelectorAll('button, [role=button], input')].find((e) => /search commands/i.test((e.getAttribute('aria-label') || '') + (e.placeholder || '') + e.textContent))`);
    await rec.waitFor(`!!document.querySelector('input[type=search], .palette input, [role=dialog] input')`, 'the command search');
    await rec.type('washer', 120);
    await rec.wait(900);
    await rec.key('Enter');
    await rec.waitFor(`!!document.querySelector('[data-testid="washer-wizard"]')`, 'the Washer wizard');
    await rec.wait(900);
    await rec.click(`document.querySelector('[data-testid="washer-size-filter"]')`);
    await rec.type('M8', 140);
    await rec.wait(900);
    await rec.click(`document.querySelector('[data-testid="washer-size-list"]').children[0]`);
    await rec.wait(1100);
    rec.mark('poster');
    await rec.click(`document.querySelector('[data-testid="washer-apply"]')`);
    await rec.waitFor(`!document.querySelector('[data-testid="washer-wizard"]')`, 'the wizard to close');
    await rec.wait(2800);
    return rec.finish('washer-wizard', ctx.outDir, ctx.posterDir);
  },
};
