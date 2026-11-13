// The Spring wizard: Features tab > Create menu > Spring. The sizes, the pitch and gap readout, the live preview changing as a value is edited,
// Add spring, then the spring in the viewport, orbited a little. The preview takes a moment on a busy machine and so does every pointer move, so
// each move, click, key and wait for the kernel is made inside rec.skip (its time is cut) and the clip holds between them for a fixed, readable
// time: the pace of the clip does not depend on the machine (the pointer then moves in a few hops).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIELD = (name) => `document.querySelector('[data-testid="spring-wizard"] [data-path="${name}"] input')`;
export default {
  id: 'spring-wizard',
  async run(rec, ctx) {
    const { page } = ctx;
    const T0 = Date.now();
    const log = (n) => { if (process.env.CLIP_TIME) console.error(((Date.now() - T0) / 1000).toFixed(1), n); };
    await ctx.openApp();
    await rec.waitFor(`/ready/i.test(document.querySelector('.status')?.textContent ?? '')`, 'the app to be ready');
    await sleep(1500);
    // one step made off the clock, then a short hold on the result
    const step = async (fn, hold = 130) => { await rec.skip(async () => { await fn(); await rec.paint(); await sleep(150); }); await rec.paint(); await sleep(hold); };
    const hop = (x, y) => step(async () => { await page.mouse('mouseMoved', x, y); rec.x = x; rec.y = y; }, 60);
    const go = async (x, y, n = 5) => { const x0 = rec.x, y0 = rec.y; for (let i = 1; i <= n; i++) { const k = i / n, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; await hop(x0 + (x - x0) * e, y0 + (y - y0) * e); } };
    const click = async (expr) => { const [x, y] = await rec.rect(expr); await go(x, y); await step(async () => { await page.mouse('mousePressed', x, y); await page.mouse('mouseReleased', x, y); await sleep(150); }, 250); };
    const typeOut = async (text) => { for (const ch of text) await step(() => page.send('Input.insertText', { text: ch }), 200); };
    await rec.begin();
    await rec.wait(800);
    // ---- the Features tab, its Create menu, Spring
    await click(`[...document.querySelectorAll('button.rb-tab')].find((e) => e.textContent.trim() === 'Features')`);
    await rec.wait(500);
    await click(`document.querySelector('button[aria-label="More tools like Gear"]')`);
    await rec.wait(900);
    await click(`[...document.querySelectorAll('button.slot-row')].find((e) => /^Spring/.test(e.textContent.trim()))`);
    await rec.skip(async () => { await rec.waitFor(`!!document.querySelector('[data-testid="spring-summary"]')`, 'the wizard'); await sleep(4500); });
    await rec.wait(2000);
    log('wizard');
    rec.mark('poster');
    // ---- more turns: the preview and the pitch and gap readout follow
    await click(FIELD('coils'));
    await step(() => page.eval(`${FIELD('coils')}.select()`), 150);
    await typeOut('12');
    await step(() => page.key('Tab'), 200);
    await rec.skip(async () => { await sleep(5000); });
    await rec.wait(1500);
    // the readout lies below the fields: scroll the panel to it (the Turns box stays in view)
    await step(() => page.eval(`document.querySelector('.ptab-body').scrollTop = 150`), 200);
    await rec.wait(3200);
    log('edited');
    // ---- add it
    await click(`document.querySelector('[data-testid="spring-apply"]')`);
    await rec.skip(async () => { await rec.waitFor(`!document.querySelector('[data-testid="spring-wizard"]')`, 'the wizard to close'); await sleep(3000); });
    await rec.wait(1500);
    log('added');
    // ---- the spring in the viewport, orbited a little
    const [cx, cy] = await rec.rect(`document.querySelector('#vp canvas')`);
    await go(cx + 120, cy + 150);
    await step(() => page.mouse('mousePressed', rec.x, rec.y), 100);
    for (let i = 0; i < 10; i++) await step(async () => { rec.x -= 10; rec.y -= 3; await page.mouse('mouseMoved', rec.x, rec.y); }, 60);
    await step(() => page.mouse('mouseReleased', rec.x, rec.y), 100);
    await rec.wait(1800);
    return rec.finish('spring-wizard', ctx.outDir, ctx.posterDir);
  },
};
