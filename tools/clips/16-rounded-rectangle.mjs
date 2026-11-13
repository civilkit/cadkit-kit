// The Rounded rectangle sketch tool (Draw group, in the Rectangle slot): two corners and a typed corner radius, which becomes a dimension on each
// corner arc; then a second rectangle, which keeps the last radius. (Add spline point is not in this clip: a click on a spline does not reach the
// tool in the app, see the report.)
// Every move, click, key and wait is made inside rec.skip (its time is cut) and the clip holds for fixed, readable times between them, so the
// pace does not depend on the machine (the pointer moves in a few hops).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIELD = (name) => `document.querySelector('.sketch-fields input[aria-label="${name}"]')`;
export default {
  id: 'rounded-rectangle',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await rec.waitFor(`/ready/i.test(document.querySelector('.status')?.textContent ?? '')`, 'the app to be ready');
    await sleep(1000);
    // off camera: a new part and a sketch on its Front Plane
    await page.eval(`document.querySelector('button[aria-label="New part"]').click()`);
    await sleep(2500);
    await page.eval(`[...document.querySelectorAll('button')].find((b) => /Sketch on Front Plane/.test(b.textContent)).click()`);
    await rec.waitFor(`!!document.querySelector('button[aria-label="More tools like Rectangle"]')`, 'the sketch tools');
    await sleep(2000);
    const step = async (fn, hold = 130) => { await rec.skip(async () => { await fn(); await rec.paint(); await sleep(150); }); await rec.paint(); await sleep(hold); };
    const hop = (x, y) => step(async () => { await page.mouse('mouseMoved', x, y); rec.x = x; rec.y = y; }, 60);
    const go = async (x, y, n = 5) => { const x0 = rec.x, y0 = rec.y; for (let i = 1; i <= n; i++) { const k = i / n, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; await hop(x0 + (x - x0) * e, y0 + (y - y0) * e); } };
    const clickAt = async (x, y, hold = 250, n = 5) => { await go(x, y, n); await step(async () => { await page.mouse('mouseMoved', x, y); await sleep(200); await page.mouse('mousePressed', x, y); await sleep(80); await page.mouse('mouseReleased', x, y); await sleep(150); }, hold); };
    const rect = (expr) => page.eval(`(() => { const b = (${expr}).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
    const click = async (expr, n = 5) => { await rec.skip(() => rec.waitFor(`!!(${expr})`, `the element ${expr.slice(0, 70)}`, 40000).catch(async (e) => { if (process.env.CLIP_DEBUG) (await import('node:fs')).writeFileSync(process.env.CLIP_DEBUG, await page.screenshot()); throw e; })); const [x, y] = await rect(expr); await clickAt(x, y, 250, n); };
    const typeOut = async (text) => { for (const ch of text) await step(() => page.send('Input.insertText', { text: ch }), 220); };
    await rec.begin();
    await rec.wait(900);
    // ---- the Rounded rectangle tool, in the Rectangle slot
    await click(`document.querySelector('button[aria-label="More tools like Rectangle"]')`, 1);
    await rec.wait(1500);
    await click(`[...document.querySelectorAll('button.slot-row')].find((e) => /Rounded rectangle/.test(e.textContent))`, 1);
    await rec.wait(500);
    // ---- the first corner, then the pointer out to the opposite corner: the width, height and corner boxes
    await clickAt(430, 235, 250, 1);
    await go(800, 430, 4);
    // the width, height and corner boxes come and go while the pointer moves (they show once the pointer rests): nudge it until they are up
    await rec.skip(async () => { for (let i = 0; i < 40 && !(await page.eval(`!!${FIELD('corner')}`)); i++) { await page.mouse('mouseMoved', 800 + (i % 2), 430); await sleep(300); } });
    await rec.wait(1200);
    // the corner box is focused as the Tab key would (the pointer stays on the sketch)
    await step(() => page.eval(`(() => { const i = ${FIELD('corner')}; i.focus(); i.select(); })()`), 300);
    await typeOut('8');
    await step(() => page.key('Enter'), 300);
    await rec.wait(1500);
    // ---- the second corner
    await clickAt(800, 430, 300);
    await rec.wait(2800);
    rec.mark('poster');
    await rec.wait(700);
    // ---- a second rectangle: the last radius is kept, so two corners are enough
    await clickAt(430, 490, 250, 3);
    await go(800, 620, 4);
    await rec.wait(1500);
    await clickAt(800, 620, 300, 1);
    await rec.wait(3200);
    return rec.finish('rounded-rectangle', ctx.outDir, ctx.posterDir);
  },
};
