// The mass unit and digits: the Inspect mass card in grams or kilograms, then pounds with fewer digits after Settings > General > Mass display.
const pick = (label, v) => `(() => { const e = document.querySelector('select[aria-label="${label}"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(e, '${v}'); e.dispatchEvent(new Event('change', { bubbles: true })); })()`;
export default {
  id: 'mass-display',
  async run(rec, ctx) {
    await ctx.openApp();
    await ctx.openSample('mounting-plate');
    await rec.begin();
    await rec.wait(800);
    await rec.click(`[...document.querySelectorAll('.row')].find((r) => /^Material/.test(r.querySelector('.row-name')?.textContent ?? ''))?.querySelector('.row-name')`);
    await rec.waitFor(`!!document.querySelector('.mat-search')`, 'the material editor');
    await rec.click(`document.querySelector('[data-material="aluminium-6061"], [data-material="steel-mild"]')`);
    await rec.skip(() => rec.waitFor(`/Mass: [\\d.]+ (g|kg)/.test(document.querySelector('[data-testid="material-mass"]')?.textContent ?? '')`, 'the mass'));
    await rec.wait(2200);
    await rec.click(`[...document.querySelectorAll('button, input')].find((b) => /Search commands/.test((b.textContent ?? '') + (b.getAttribute('placeholder') ?? '') + (b.getAttribute('aria-label') ?? '')))`);
    await rec.wait(600);
    await rec.type('settings', 110);
    await rec.wait(800);
    await rec.key('Enter');
    await rec.waitFor(`!!document.querySelector('[role="tabpanel"]')`, 'the settings');
    await rec.wait(700);
    await rec.click(`[...document.querySelectorAll('[role="tab"]')].find((b) => /General/.test(b.textContent))`);
    await rec.waitFor(`!!document.querySelector('[data-testid="mass-section"]')`, 'the mass display section');
    await rec.wait(900);
    await rec.page.eval(pick('Mass unit', 'lb'));
    await rec.wait(900);
    await rec.page.eval(pick('Significant digits', '3'));
    await rec.wait(1000);
    rec.mark('poster');
    await rec.click(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close')`);
    await rec.wait(2800);
    return rec.finish('mass-display', ctx.outDir, ctx.posterDir);
  },
};
