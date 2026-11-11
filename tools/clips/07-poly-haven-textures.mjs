// Textures from the Poly Haven library: allow online libraries, search the list, pick a walnut texture and see it on the part.
export default {
  id: 'poly-haven-textures',
  async run(rec, ctx) {
    await ctx.openApp();
    await ctx.openSample('mounting-plate');
    await rec.begin();
    await rec.wait(900);
    await rec.click(`document.querySelector('.display-btn')`);
    await rec.waitFor(`!!document.querySelector('.surface-controls')`, 'the surface controls');
    await rec.wait(800);
    await rec.click(`[...document.querySelectorAll('.texture-picker .display-reset')].find((b) => /Choose a texture/.test(b.textContent))`);
    await rec.wait(900);
    await rec.click(`[...document.querySelectorAll('.texture-picker .display-reset')].find((b) => /Allow online/.test(b.textContent))`);
    await rec.skip(() => rec.waitFor(`document.querySelectorAll('.tex-item').length > 10`, 'the texture list'));
    await rec.wait(900);
    await rec.click(`document.querySelector('.tex-pop .mat-search')`);
    await rec.type('walnut', 120);
    await rec.wait(1200);
    await rec.click(`document.querySelectorAll('.tex-item[data-texture]')[2]`);
    await rec.skip(() => rec.waitFor(`!!document.querySelector('[data-testid=texture-credit]')`, 'the texture credit'));
    await rec.wait(1500);
    // close the menu and clear any selection tint so the texture shows, then turn the part a little
    await rec.key('Escape');
    await rec.key('Escape');
    await rec.wait(1200);
    rec.mark('poster');
    await rec.glide(520, 440, 500);
    await rec.page.mouse('mousePressed', 520, 440);
    for (let i = 1; i <= 26; i++) { await rec.page.mouse('mouseMoved', 520 + i * 1.6, 440 - i * 0.5); await new Promise((r) => setTimeout(r, 55)); }
    await rec.page.mouse('mouseReleased', 562, 427);
    await rec.wait(1800);
    return rec.finish('poly-haven-textures', ctx.outDir, ctx.posterDir);
  },
};
