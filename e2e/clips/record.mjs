// Records short clips of the CadKit app by driving it with a real pointer (headless Chromium, screencast frames).
//   node e2e/clips/record.mjs --url http://127.0.0.1:PORT/ --out DIR [--only id] [--posters DIR]   (the app must be served, e.g. tools/serve_local.sh; PLAYWRIGHT_BROWSERS_PATH points at the browsers)
// Each NN-name.mjs in this folder drives headless Chromium (1280x720 unless it says otherwise, light theme, a clean
// profile each) while the page is captured as timestamped screenshots (so a slow or busy machine gives fewer
// frames but the clip keeps its timing). ffmpeg then cuts the section the recorder marked, crops and scales it,
// and writes DIR/<id>.webm (VP9), DIR/<id>.mp4 (H.264 for Safari) and DIR/<id>.png (poster; a copy goes to --posters,
// default web/calcpad-web/public/whats-new/posters, which IS committed). Needs ffmpeg; pngquant makes the poster small.
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installPointer, makeRec, openApp } from './lib.mjs';
import { MAX_BYTES, MP4_CRFS, WEBM_CRFS, mp4Args, webmArgs } from '../../tools/normalize_clips.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('--url', '');
const out = resolve(arg('--out', ''));
const only = arg('--only', '');
const posters = resolve(arg('--posters', join(out, 'posters')));
if (!url || !arg('--out', '')) { console.error('usage: node e2e/clips/record.mjs --url http://127.0.0.1:PORT/ --out DIR [--only id]'); process.exit(2); }
mkdirSync(out, { recursive: true });
mkdirSync(posters, { recursive: true });
const tmp = join(out, '.raw');
mkdirSync(tmp, { recursive: true });

const MAX_POSTER = 60 * 1000;

function ffmpeg(args) {
    const r = spawnSync('nice', ['-n', '19', 'taskpolicy', '-b', 'ffmpeg', '-threads', '2', '-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}
const size = (f) => statSync(f).size;

/** Cuts, crops and scales the raw recording; returns the bytes of each output. */
function encode(raw, spec, id) {
    const { crop, width, fps, skips, speed, zooms = [], size: vs } = spec;
    const filters = [];
    if (crop) filters.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
    // Zoom spans (times on the uncut timeline): the picture is magnified around a point with a smooth ease in and out, then cropped back to its size (the crop cannot use iw/ih: its input size is fixed when the graph is set up, so the scaled size is spelled out).
    if (zooms.length) {
        const W = crop ? crop.w : vs.width, H = crop ? crop.h : vs.height, E = 0.6;
        const ramp = (z) => `(min(1,max(0,(t-${z.a.toFixed(3)})/${E}))*min(1,max(0,(${z.b.toFixed(3)}-t)/${E})))`;
        const w = zooms.map(ramp);
        const sum = w.join('+');
        const Z = `(1+${zooms.map((z, i) => `${(z.z - 1).toFixed(3)}*${w[i]}`).join('+')})`;
        const cx = `((${zooms.map((z, i) => `${(z.x - (crop?.x ?? 0)).toFixed(1)}*${w[i]}`).join('+')})+(1-min(1,${sum}))*${W / 2})`;
        const cy = `((${zooms.map((z, i) => `${(z.y - (crop?.y ?? 0)).toFixed(1)}*${w[i]}`).join('+')})+(1-min(1,${sum}))*${H / 2})`;
        filters.push(`scale=w='trunc(${W}*${Z}/2)*2':h='trunc(${H}*${Z}/2)*2':eval=frame:flags=bicubic`,
            `crop=${W}:${H}:'min(max(0,${cx}*${Z}-${W / 2}),${W}*${Z}-${W})':'min(max(0,${cy}*${Z}-${H / 2}),${H}*${Z}-${H})'`);
    }
    // JPEG frames are full range; players expect limited range yuv420p, flagged as such: a VP9 stream flagged full
    // range does not decode in Chromium's software decoder. Square pixels. (The rules: tools/normalize_clips.mjs.)
    filters.push(`scale=${width}:-2:flags=lanczos:in_range=pc:out_range=tv`, 'setsar=1', `fps=${fps}`);
    // Waits the recorder marked as dead time are cut out (times are relative to the start of the kept section).
    if (skips.length) filters.push(`select='not(${skips.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+')})'`, `setpts=N/(${fps}*TB)`);
    // A machine that is busy makes the app answer slowly; a clip longer than it should be is played faster (at most 1.3x).
    if (speed > 1.01) filters.push(`setpts=PTS/${speed.toFixed(3)}`, `fps=${fps}`);
    const vf = filters.join(',');
    const input = ['-f', 'concat', '-safe', '0', '-i', raw];
    const webm = join(out, `${id}.webm`);
    let crfUsed = 0;
    for (const crf of WEBM_CRFS) {
        ffmpeg([...input, '-vf', vf, ...webmArgs(crf, fps), '-threads', '2', webm]);
        crfUsed = crf;
        if (size(webm) <= (spec.maxBytes ?? MAX_BYTES)) break;
    }
    const mp4 = join(out, `${id}.mp4`);
    for (const crf of MP4_CRFS) {
        ffmpeg([...input, '-vf', vf, ...mp4Args(crf, fps), '-threads', '2', mp4]);
        if (size(mp4) <= (spec.maxBytes ?? MAX_BYTES)) break;
    }
    return { webm, mp4, crfUsed };
}

/** A poster frame (a PNG, reduced to a small palette) cut from the finished webm. */
function poster(webm, id, at) {
    const png = join(out, `${id}.png`);
    const full = join(tmp, `${id}-full.png`);
    ffmpeg(['-ss', at.toFixed(2), '-i', webm, '-frames:v', '1', full]);
    let ok = false;
    for (const colors of [96, 64, 48, 32, 24, 16]) {
        const r = spawnSync('pngquant', [String(colors), '--force', '--speed', '1', '--strip', '--output', png, full]);
        if (r.status !== 0) { copyFileSync(full, png); break; }
        if (size(png) <= MAX_POSTER) { ok = true; break; }
    }
    // Still too big (a gradient or a 3D scene): a smaller picture.
    for (const w of ok ? [] : [800, 720, 640]) {
        const small = join(tmp, `${id}-small.png`);
        ffmpeg(['-i', full, '-vf', `scale=${w}:-2:flags=lanczos`, small]);
        for (const colors of [64, 32]) {
            spawnSync('pngquant', [String(colors), '--force', '--speed', '1', '--strip', '--output', png, small]);
            if (size(png) <= MAX_POSTER) { ok = true; break; }
        }
        if (ok) break;
    }
    copyFileSync(png, join(posters, `${id}.png`));
    return { png, bytes: size(png), ok };
}

const files = readdirSync(here).filter((f) => /^\d\d-.*\.mjs$/.test(f)).sort();
// The 3D view needs WebGL: the GPU (Metal on a Mac) gives about three times the frame rate of software rendering; CLIP_GL=swiftshader forces software rendering (no GPU, a CI box).
const browser = await chromium.launch({ args: process.env.CLIP_GL === 'swiftshader' ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const summary = [];
let failed = 0;
for (const f of files) {
    const mod = (await import(pathToFileURL(join(here, f)).href)).default;
    if (only && only !== mod.id && only !== f.replace(/\.mjs$/, '')) continue;
    const viewport = mod.viewport ?? { width: 1440, height: 810 };
    const mobile = !!mod.mobile;
    const ctx = await browser.newContext({
        viewport, colorScheme: 'light', deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile,
        permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true,
    });
    await installPointer(ctx);
    const page = await ctx.newPage();
    const clock = { t0: Date.now() };
    const rec = makeRec(page, clock);
    const pageErrors = [];
    page.on('pageerror', (e) => { if (!/^Canceled/.test(String(e))) pageErrors.push(String(e)); });
    // The page is captured as screencast frames, each carrying the time it was generated (the clock the recorder's
    // marks use), so a slow machine gives fewer frames but the clip keeps its timing.
    const framesDir = join(tmp, mod.id);
    mkdirSync(framesDir, { recursive: true });
    const frames = [];
        const cdp = await ctx.newCDPSession(page);
    cdp.on('Page.screencastFrame', (e) => {
        const file = join(framesDir, `${String(frames.length).padStart(6, '0')}.jpg`);
        writeFileSync(file, Buffer.from(e.data, 'base64'));
        frames.push({ t: e.metadata.timestamp - clock.t0 / 1000, file });
        rec.lastFrameT = frames[frames.length - 1].t;
        cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });
    const capture = Promise.resolve();
    let error = null;
    try {
        await openApp(page, url);
        const limit = Number(process.env.CLIP_TIMEOUT ?? 240) * 1000;
        let timer;
        await Promise.race([
            mod.run(rec, { url }),
            new Promise((_, no) => { timer = setTimeout(() => no(new Error(`recorder ran over ${limit / 1000} s (last step: ${rec.lastStep ?? 'none'})`)), limit); }),
        ]).finally(() => clearTimeout(timer));
    } catch (e) { error = e; }
    await cdp.send('Page.stopScreencast').catch(() => {});
    if (process.env.CLIP_DEBUG) console.log(`debug ${mod.id}: ${frames.length} frames over ${rec.now().toFixed(1)} s${error ? ' (error)' : ''}`);
    await Promise.race([ctx.close(), new Promise((ok) => setTimeout(ok, 20000))]);
    if (error) { console.log(`FAIL ${mod.id}: ${error.stack ?? error}`); failed++; continue; }
    const m = rec.marks;
    const offset = 0;
    if (m.start == null || m.end == null) { console.log(`FAIL ${mod.id}: the recorder did not mark start and end`); failed++; continue; }
    // The clip opens on the first frame painted after the start mark, never on an older picture.
    // (A recorder that used rec.begin() has already waited for a picture newer than the settled state, so the last
    // frame at or before the mark is the one to open on, even when the page is still and sends no new frames.)
    if (!rec.began) { const fresh = frames.find((fr) => fr.t >= m.start && fr.t < m.end); if (fresh) m.start = fresh.t; }
    const skips = rec.skips.map(([a, b]) => [a + offset - m.start, b + offset - m.start]).filter(([a, b]) => b > 0 && a < m.end - m.start).map(([a, b]) => [Math.max(0, a), Math.min(m.end - m.start, b)]);
    const cut = skips.reduce((t, [a, b]) => t + (b - a), 0);
    const speed = mod.maxSpeed ? Math.min(mod.maxSpeed, Math.max(1, (m.end - m.start - cut) / (mod.targetSeconds ?? 8))) : 1;
    // zoom spans relative to the start of the clip; one still open when the clip ends closes there
    const zooms = rec.zooms.map((z) => ({ ...z, a: z.a - m.start, b: (z.b ?? m.end) - m.start })).filter((z) => z.b > 0 && z.a < m.end - m.start).map((z) => ({ ...z, a: Math.max(0, z.a), b: Math.min(m.end - m.start, z.b) }));
    const spec = { speed, zooms, size: viewport, start: m.start, dur: m.end - m.start, crop: process.env.CLIP_FULL ? null : (mod.crop ?? null), width: mod.width ?? 1280, fps: mod.fps ?? 24, skips, maxBytes: mod.maxBytes };
    // The frames from `start` to `end` as a concat list; each frame lasts until the next one arrives.
    const list = join(framesDir, 'list.txt');
    const inside = frames.filter((fr) => fr.t < m.end);
    const k = rec.began ? Math.max(0, inside.findLastIndex((fr) => fr.t <= m.start)) : Math.max(0, inside.findIndex((fr) => fr.t >= m.start));
    const used = inside.slice(k);
    if (!used.length) { console.log(`FAIL ${mod.id}: no frames in the marked section`); failed++; continue; }
    const rows = used.map((fr, i) => {
        const from = Math.max(fr.t, m.start), to = i + 1 < used.length ? used[i + 1].t : m.end;
        return `file '${fr.file}'\nduration ${Math.max(0.001, to - from).toFixed(4)}`;
    });
    writeFileSync(list, rows.join('\n') + `\nfile '${used[used.length - 1].file}'\n`);
    if (process.env.CLIP_DEBUG) console.log(`debug marks ${JSON.stringify(m)} skips ${JSON.stringify(skips)} first frame ${used[0].t.toFixed(2)} (index ${k} of ${inside.length}), next ${used[1]?.t.toFixed(2)}`);
    const o = encode(list, spec, mod.id);
    // The poster time is on the uncut timeline; the finished clip is shorter by the skipped spans before it.
    const pAt = m.poster != null ? m.poster - m.start : spec.dur * 0.5;
    const before = skips.reduce((t, [a, b]) => t + Math.max(0, Math.min(b, pAt) - a), 0);
    const p = poster(o.webm, mod.id, Math.max(0, pAt - before) / speed);
    summary.push({ id: mod.id, webm: size(o.webm), mp4: size(o.mp4), crf: o.crfUsed, png: p.bytes, dur: (spec.dur - cut) / speed, pageErrors });
    console.log(`ok   ${mod.id}: ${((spec.dur - cut) / speed).toFixed(1)} s${speed > 1.01 ? ` (played at ${speed.toFixed(2)}x, recorded ${(spec.dur - cut).toFixed(1)} s)` : ''}, webm ${(size(o.webm) / 1000).toFixed(0)} KB (crf ${o.crfUsed}), mp4 ${(size(o.mp4) / 1000).toFixed(0)} KB, poster ${(p.bytes / 1000).toFixed(0)} KB${p.ok ? '' : ' (OVER 60 KB)'}${pageErrors.length ? ` page errors: ${pageErrors.join('; ')}` : ''}`);
}
await browser.close();
if (!process.env.CLIP_KEEP) rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
