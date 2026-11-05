// Helpers shared by the clip recorders: a visible pointer, gliding mouse moves, typing at a readable pace.
// A recorder gets one `rec` object (see record.mjs) and drives the real app through it.

const POINTER_JS = `(() => {
  if (window !== window.top) return;
  const make = () => {
    if (document.getElementById('__clip_ptr')) return;
    const d = document.createElement('div');
    d.id = '__clip_ptr';
    d.style.cssText = 'position:fixed;left:-50px;top:-50px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;' +
      'background:rgba(255,196,0,.45);border:2px solid #b45f00;box-shadow:0 0 0 1px rgba(255,255,255,.7);pointer-events:none;z-index:2147483647;' +
      'transition:transform .12s ease-out;';
    document.documentElement.appendChild(d);
  };
  let was = false;
  window.__clipPtr = (x, y, down) => {
    make(); const d = document.getElementById('__clip_ptr'); d.style.left = x + 'px'; d.style.top = y + 'px'; d.style.transform = down ? 'scale(.65)' : 'scale(1)';
    // a ring that spreads from the point of each press, so a click reads even when the pointer is small or the move is fast
    if (down && !was) {
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;border:3px solid rgba(220,90,0,.9);pointer-events:none;z-index:2147483646;';
      document.documentElement.appendChild(r);
      r.animate([{ transform: 'scale(.6)', opacity: 1 }, { transform: 'scale(3.2)', opacity: 0 }], { duration: 650, easing: 'ease-out' }).onfinish = () => r.remove();
    }
    was = !!down;
  };
  // a caption bar at the bottom of the picture (part of the page, so it is in the frames and keeps its timing through cuts)
  window.__clipCap = (text) => {
    let c = document.getElementById('__clip_cap');
    if (!text) { if (c) c.style.opacity = '0'; return; }
    if (!c) {
      c = document.createElement('div'); c.id = '__clip_cap';
      c.style.cssText = 'position:fixed;left:50%;bottom:44px;transform:translateX(-50%);max-width:70%;padding:10px 22px;border-radius:10px;background:rgba(20,24,32,.88);color:#fff;' +
        'font:600 21px/1.3 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;text-align:center;pointer-events:none;z-index:2147483645;transition:opacity .25s;opacity:0;';
      document.documentElement.appendChild(c);
    }
    c.textContent = text; c.style.opacity = '1';
  };
})();`;

export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Adds the pointer script to a browser context (call before the first page is created). */
export async function installPointer(context) { await context.addInitScript(POINTER_JS); }

/** The recorder's toolbox for one page. */
export function makeRec(page, clock) {
    let px = 640, py = 360;
    const setPtr = (x, y, down = false) => page.evaluate(([a, b, c]) => window.__clipPtr?.(a, b, c), [x, y, down]).catch(() => {});
    const rec = {
        page,
        /** Seconds since the page was created: the time axis of the recorded video. */
        now: () => (Date.now() - clock.t0) / 1000,
        marks: {},
        mark(name) { rec.marks[name] = rec.now(); rec.lastStep = `mark ${name}`; },
        lastStep: null,
        /** Waits until the browser has painted and sent a frame newer than now (a busy machine paints late). */
        async paintFresh() {
            const asked = rec.now();
            for (let i = 0; i < 100 && !(rec.lastFrameT >= asked); i++) {
                await page.evaluate((k) => {
                    // a small flip in the top left corner (above every crop) makes the browser paint and send a frame
                    let d = document.getElementById('__clip_tick');
                    if (!d) { d = document.createElement('div'); d.id = '__clip_tick'; d.style.cssText = 'position:fixed;left:0;top:0;width:3px;height:3px;pointer-events:none;z-index:2147483646'; document.documentElement.appendChild(d); }
                    d.style.background = k ? '#000' : '#fff';
                }, i % 2).catch(() => {});
                await sleep(150);
            }
            await page.evaluate(() => document.getElementById('__clip_tick')?.remove()).catch(() => {});
            if (!(rec.lastFrameT >= asked)) console.log('warn: no new frame arrived while waiting for a fresh picture');
        },
        /** Starts the clip once the page has been still for a moment and the browser has shown it. */
        async begin() {
            await settle(page);
            await sleep(2500);   // a busy machine paints late: stand still until the picture has caught up
            await rec.paintFresh();
            rec.mark('start');
            rec.began = true;
        },
        began: false,
        lastFrameT: 0,
        /** Ends the clip once the final state has been painted and sent (so it is not cut off on an older picture). */
        async finish() { await settle(page); await sleep(700); await rec.paintFresh(); await sleep(200); rec.mark('end'); },
        /** Time spans (seconds on the page clock) to cut out of the clip: waits for a slow run to finish. */
        skips: [],
        /** Runs `fn` (a wait) and cuts what it took from the clip, keeping the first `keep` seconds so a click still shows. */
        async skip(fn, keep = 0.2) {
            const a = rec.now();
            const r = await fn();
            const b = rec.now();
            if (b - a > keep + 0.15) rec.skips.push([a + keep, b]);
            return r;
        },
        sleep,
        /** Shows a caption at the bottom of the picture until the next caption() or caption('') call. */
        async caption(text = '') { await page.evaluate((t) => window.__clipCap?.(t), text).catch(() => {}); },
        /** Zoom spans for the encoder: from now until zoomOut() the picture is magnified `scale` times around (x, y) in page pixels. */
        zooms: [],
        zoom(x, y, scale = 1.8) { rec.zoomOut(); rec.zooms.push({ a: rec.now(), b: null, x, y, z: scale }); },
        zoomOut() { const o = rec.zooms.at(-1); if (o && o.b == null) o.b = rec.now(); },
        /** Zooms on the centre of a locator (or the given box side of it). */
        async zoomOn(locator, scale = 1.8, dx = 0, dy = 0) { const c = await rec.centre(locator, dx, dy); rec.zoom(c.x, c.y, scale); },
        /** Debug aid: with CLIP_SHOTS=DIR a named screenshot is written (dry runs and failures). */
        async shot(name) { if (process.env.CLIP_SHOTS) await page.screenshot({ path: `${process.env.CLIP_SHOTS}/${name}.png` }).catch(() => {}); },
        /** Moves the pointer to (x, y) in a smooth arc of `steps` mouse moves. */
        async glide(x, y, ms = 600) {
            // Time based, so a slow machine makes the move choppier but not longer.
            const t0 = Date.now(), x0 = px, y0 = py;
            for (;;) {
                const t = Math.min(1, (Date.now() - t0) / ms), e = t * t * (3 - 2 * t);
                const cx = x0 + (x - x0) * e, cy = y0 + (y - y0) * e;
                await page.mouse.move(cx, cy);
                await setPtr(cx, cy);
                if (t >= 1) break;
                await sleep(16);
            }
            px = x; py = y;
        },
        /** The centre of a locator (any frame), in page coordinates. */
        async centre(locator, dx = 0, dy = 0) {
            await locator.waitFor({ timeout: 30000 });
            const b = await locator.boundingBox();
            return { x: b.x + b.width / 2 + dx, y: b.y + b.height / 2 + dy, b };
        },
        /** Glides to a point and clicks it, with a short press shown on the pointer. */
        async clickAt(x, y, ms = 600) {
            await rec.glide(x, y, ms);
            await setPtr(x, y, true);
            await page.mouse.down(); await sleep(90); await page.mouse.up();
            await setPtr(x, y, false);
            await sleep(120);
        },
        async click(locator, opts = {}) {
            const c = await rec.centre(locator, opts.dx ?? 0, opts.dy ?? 0);
            await rec.clickAt(c.x, c.y, opts.ms ?? 600);
        },
        async dblclick(locator, opts = {}) {
            const c = await rec.centre(locator);
            await rec.glide(c.x, c.y, opts.ms ?? 600);
            await setPtr(c.x, c.y, true);
            await page.mouse.dblclick(c.x, c.y);
            await setPtr(c.x, c.y, false);
        },
        /** Types with a human pace. */
        async type(text, delay = 70) { await page.keyboard.type(text, { delay }); },
        /** Waits (cut from the clip) until the status bar text matches `re` and the rebuild has finished. */
        waitFor: (re) => rec.skip(async () => { for (let i = 0; i < 600 && !re.test(await statusText(page)); i++) await sleep(200); await settle(page); }),
        /** Waits (cut from the clip) until the status bar text no longer matches `re`. */
        waitGone: (re) => rec.skip(async () => {
            for (let i = 0; i < 600 && re.test(await statusText(page)); i++) await sleep(200);
            await settle(page);
        }),
        /** Polls until a predicate (evaluated in the page) is true. */
        async until(fn, arg, timeout = 30000) { await page.waitForFunction(fn, arg, { timeout }); },
    };
    return rec;
}

/** Loads the CadKit app in the page: light theme, no unsaved-work prompt, fresh session, kernel ready. */
export async function openApp(page, url) {
    const u = new URL(url);
    u.searchParams.set('theme', 'light');
    u.searchParams.set('noprompt', '1');
    await page.goto(u.toString(), { timeout: 240000 });
    // a restore prompt can only appear when an earlier session left unsaved parts (a clean context has none); take 'Start new' if it does
    const startNew = page.getByRole('button', { name: /start new/i });
    if (await startNew.count().catch(() => 0)) await startNew.click().catch(() => {});
    await page.waitForSelector('.status .ready', { timeout: 240000 });
}

/** Waits until the status bar says Ready (no rebuild, no script run in progress) and has stayed so for `quiet` ms. */
export async function settle(page, quiet = 400) {
    let clear = 0;
    for (let i = 0; i < 600 && clear * 100 < quiet; i++) {
        const ready = await page.evaluate(() => !!document.querySelector('.status .ready') && !/Rebuilding|Busy/i.test(document.querySelector('.status')?.textContent ?? '')).catch(() => false);
        clear = ready ? clear + 1 : 0;
        await sleep(100);
    }
}

/** Text of the status bar (feature, face counts, last message). */
export const statusText = (page) => page.evaluate(() => document.querySelector('.status')?.textContent?.replace(/\s+/g, ' ') ?? '').catch(() => '');
