// A second Marine propeller: insert one, open the wizard again, and the new one starts behind the first (Position along the shaft). Setting the
// position back to the first one's brings the warning about an identical propeller at the same place. Every move, click, key and wait for the
// kernel is made inside rec.skip (its time is cut) and the clip holds between them for a fixed, readable time, so the pace does not depend on
// the machine (the pointer moves in a few hops).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POS = `document.querySelector('[data-testid="marine-wizard"] [data-path="shaftZ"] input')`;
export default {
  id: 'propeller-position',
  async run(rec, ctx) {
    const { page } = ctx;
    const T0 = Date.now();
    const log = (n) => { if (process.env.CLIP_TIME) console.error(((Date.now() - T0) / 1000).toFixed(1), n); };
    await ctx.openApp();
    await rec.waitFor(`/ready/i.test(document.querySelector('.status')?.textContent ?? '')`, 'the app to be ready');
    await sleep(1500);
    const step = async (fn, hold = 130) => { await rec.skip(async () => { await fn(); await rec.paint(); await sleep(150); }); await rec.paint(); await sleep(hold); };
    const hop = (x, y) => step(async () => { await page.mouse('mouseMoved', x, y); rec.x = x; rec.y = y; }, 60);
    const go = async (x, y, n = 5) => { const x0 = rec.x, y0 = rec.y; for (let i = 1; i <= n; i++) { const k = i / n, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; await hop(x0 + (x - x0) * e, y0 + (y - y0) * e); } };
    const click = async (expr) => { const [x, y] = await rec.rect(expr); await go(x, y); await step(async () => { await page.mouse('mousePressed', x, y); await page.mouse('mouseReleased', x, y); await sleep(150); }, 250); };
    const typeOut = async (text) => { for (const ch of text) await step(() => page.send('Input.insertText', { text: ch }), 200); };
    const openWizard = async () => {
      await click(`document.querySelector('button[aria-label="More tools like Gear"]')`);
      await rec.wait(700);
      await click(`[...document.querySelectorAll('button.slot-row')].find((e) => /^Propeller/.test(e.textContent.trim()))`);
      await rec.skip(async () => { await rec.waitFor(`!!document.querySelector('[data-testid="prop-wizard"], [data-testid="marine-wizard"]')`, 'the wizard'); await sleep(1200); });
      await rec.wait(500);
      await click(`document.querySelector('[data-value="marine"]')`);
      await rec.skip(async () => { await rec.waitFor(`!!document.querySelector('[data-testid="marine-wizard"]')`, 'the Marine wizard'); await sleep(6000); });
    };
    await rec.begin();
    await rec.wait(700);
    await click(`[...document.querySelectorAll('button.rb-tab')].find((e) => e.textContent.trim() === 'Features')`);
    await rec.wait(400);
    // ---- the first propeller, at the origin: through the Size, Blade and Review steps and Create
    await openWizard();
    await rec.wait(1800);
    log('first wizard');
    await click(`document.querySelector('[data-testid="marine-next"]')`);
    await click(`document.querySelector('[data-testid="marine-next"]')`);
    await rec.wait(800);
    await click(`document.querySelector('[data-testid="marine-create"]')`);
    await rec.skip(async () => { await rec.waitFor(`!document.querySelector('[data-testid="marine-wizard"]')`, 'the wizard to close', 180000); await sleep(3500); });
    await rec.wait(2000);
    log('first inserted');
    // ---- the wizard again: Position along the shaft starts behind the first propeller
    await openWizard();
    await rec.wait(800);
    await click(POS);
    await rec.wait(3300);
    rec.mark('poster');
    log('second wizard');
    // ---- the same position as the first one: the warning
    await step(() => page.eval(`${POS}.select()`), 150);
    await typeOut('0');
    await step(() => page.key('Tab'), 200);
    await rec.skip(async () => { await rec.waitFor(`!!document.querySelector('[data-testid="marine-dup"]')`, 'the warning'); await sleep(1500); });
    await rec.wait(4200);
    log('warning');
    return rec.finish('propeller-position', ctx.outDir, ctx.posterDir);
  },
};
