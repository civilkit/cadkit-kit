// Surface controls in the Display menu: roughness, metalness, clear coat and the wood grain of a part.
const slide = (id, v) => `(() => { const e = document.getElementById('${id}'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, '${v}'); e.dispatchEvent(new Event('input', { bubbles: true })); })()`;
export default {
  id: 'surface-controls',
  async run(rec, ctx) {
    await ctx.openApp();
    await ctx.openSample('mounting-plate');
    await rec.begin();
    await rec.wait(900);
    await rec.click(`document.querySelector('.display-btn')`);
    await rec.waitFor(`!!document.querySelector('.surface-controls')`, 'the surface controls');
    await rec.wait(900);
    // a warm colour, a satin surface, then a wood grain with wider, darker rings and a varnish on top
    await rec.click(`document.querySelector('.swatch[aria-label="#e0b030"]')`);
    await rec.wait(700);
    for (let i = 0; i <= 8; i++) { await rec.page.eval(slide('sc-rough', (0.24 + i * 0.05).toFixed(2))); await rec.wait(110); }
    for (let i = 0; i <= 8; i++) { await rec.page.eval(slide('sc-metal', (0.45 - i * 0.05).toFixed(2))); await rec.wait(90); }
    await rec.click(`document.getElementById('sc-grain')`);
    await rec.wait(1200);
    for (let i = 0; i <= 8; i++) { await rec.page.eval(slide('sc-scale', (4 + i * 0.5).toFixed(1))); await rec.wait(130); }
    for (let i = 0; i <= 6; i++) { await rec.page.eval(slide('sc-contrast', (0.5 + i * 0.07).toFixed(2))); await rec.wait(130); }
    await rec.wait(900);
    for (let i = 0; i <= 10; i++) { await rec.page.eval(slide('sc-coat', (i * 0.1).toFixed(2))); await rec.wait(110); }
    await rec.wait(1000);
    rec.mark('poster');
    await rec.wait(1800);
    return rec.finish('surface-controls', ctx.outDir, ctx.posterDir);
  },
};
