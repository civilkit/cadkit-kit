// Records a clip of the real app in headless Chrome: the page is captured as CDP screencast frames, each stamped with its time, so a slow
// machine gives fewer frames but the clip keeps its timing. ffmpeg then crops, scales and encodes (encode.mjs).
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync, rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_BYTES, POSTER_MAX, MP4_CRFS, WEBM_CRFS, mp4Args, vfTail, webmArgs } from './encode.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;

/** A visible pointer: the screencast has no cursor, so a yellow dot follows the mouse. */
const POINTER = `(() => { const d = document.createElement('div'); d.id = '__ptr'; d.style.cssText = 'position:fixed;left:-50px;top:-50px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,214,0,.85);border:2px solid #7a5d00;pointer-events:none;z-index:2147483647;box-shadow:0 0 6px rgba(0,0,0,.4)';
  const add = () => { if (!document.getElementById('__ptr')) document.documentElement.appendChild(d); };
  addEventListener('mousemove', (e) => { add(); d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; }, true);
  // a touch device has no mouse: the dot shows each finger instead (it stays a moment after the lift, so a tap is seen)
  let hide = 0; const at = (e) => { const t = e.touches[0] || e.changedTouches[0]; if (!t) return; add(); clearTimeout(hide); d.style.opacity = '1'; d.style.left = t.clientX + 'px'; d.style.top = t.clientY + 'px'; };
  for (const n of ['touchstart', 'touchmove']) addEventListener(n, at, true);
  addEventListener('touchend', (e) => { at(e); hide = setTimeout(() => { d.style.opacity = '0'; }, 350); }, true); })();`;

export class Rec {
  constructor(page, { width = 1920, fps = 22, crop = null } = {}) {
    this.page = page; this.width = width; this.fps = fps; this.crop = crop;
    this.frames = []; this.marks = {}; this.skips = []; this.x = 640; this.y = 360; this.live = false;
    this.onMsg = (m) => {
      const d = JSON.parse(m);
      if (d.method !== 'Page.screencastFrame') return;
      this.page.send('Page.screencastFrameAck', { sessionId: d.params.sessionId }).catch(() => {});
      if (this.live) this.frames.push({ t: d.params.metadata.timestamp, data: d.params.data });
    };
  }
  async install() { await this.page.send('Page.addScriptToEvaluateOnNewDocument', { source: POINTER }); }
  async begin() {
    this.page.ws.on('message', this.onMsg);
    await this.page.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
    await this.paint(); this.live = true; this.mark('begin');
  }
  /** Force a fresh frame (flip a tiny element), so a still page still yields a frame at this moment. */
  async paint() { await this.page.eval(`(() => { let e = document.getElementById('__flip'); if (!e) { e = document.createElement('i'); e.id = '__flip'; e.style.cssText = 'position:fixed;right:0;bottom:0;width:3px;height:3px;background:#000;opacity:.01'; document.body.appendChild(e); } e.style.width = e.style.width === '3px' ? '4px' : '3px'; })()`); await sleep(120); }
  mark(name) { this.marks[name] = now(); }
  /** Cut the time spent in fn (a wait for the kernel) out of the clip. */
  async skip(fn) { const a = now(); const r = await fn(); this.skips.push([a, now()]); return r; }
  async wait(ms) { await this.paint(); await sleep(ms); await this.paint(); }
  async rect(expr) { await this.page.eval(`(() => { const e = (${expr}); if (e) e.scrollIntoView({ block: 'nearest' }); })()`); await sleep(250); const r = await this.page.eval(`(() => { const e = (${expr}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, b.width, b.height]; })()`); if (!r) throw new Error('no element for ' + expr); return r; }
  /** Glide the pointer to a point, at a readable pace. */
  async glide(x, y, ms = 650) {
    const n = Math.max(6, Math.round(ms / 16)); const x0 = this.x, y0 = this.y;
    for (let i = 1; i <= n; i++) { const k = i / n, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; await this.page.mouse('mouseMoved', x0 + (x - x0) * e, y0 + (y - y0) * e); await sleep(16); }
    this.x = x; this.y = y;
  }
  async clickAt(x, y) { await this.glide(x, y); await sleep(180); await this.page.mouse('mousePressed', x, y); await sleep(70); await this.page.mouse('mouseReleased', x, y); await this.paint(); await sleep(250); }
  async click(expr) { const [x, y] = await this.rect(expr); await this.clickAt(x, y); }
  /** Type text at a readable pace into the focused field. */
  async type(text, ms = 110) { for (const ch of text) { await this.page.send('Input.insertText', { text: ch }); await this.paint(); await sleep(ms); } }
  async key(k, opt) { await this.page.key(k, opt); await this.paint(); await sleep(300); }
  async waitFor(expr, what, ms = 60000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await this.page.eval(expr).catch(() => false)) return; await sleep(200); } throw new Error('timed out waiting for ' + what); }

  /** Stop, then cut, crop, scale and encode `<out>/<id>.webm` and `.mp4` and the poster `posters/<id>.png`. Returns a report. */
  async finish(id, out, posterDir) {
    this.mark('end'); await this.paint(); await this.page.send('Page.stopScreencast'); this.live = false; this.page.ws.off('message', this.onMsg);
    const t0 = this.marks.begin, t1 = this.marks.end;
    const inSkip = (t) => this.skips.some(([a, b]) => t >= a && t <= b);
    const fr = this.frames.filter((f) => f.t >= t0 && f.t <= t1 && !inSkip(f.t));
    if (fr.length < 5) throw new Error(`${id}: only ${fr.length} frames were captured`);
    const dir = mkdtempSync(join(process.env.UX_TMP ?? tmpdir(), 'clip-'));
    // time axis from the frame stamps; the time of skipped stretches does not count
    const lost = (t) => this.skips.filter(([a, b]) => b <= t).reduce((s, [a, b]) => s + (b - a), 0);
    const lines = [];
    fr.forEach((f, i) => { writeFileSync(join(dir, `f${i}.jpg`), Buffer.from(f.data, 'base64')); const next = fr[i + 1] ? fr[i + 1].t - lost(fr[i + 1].t) : f.t - lost(f.t) + 0.5; const dur = Math.min(Math.max(next - (f.t - lost(f.t)), 0.01), 1.5); lines.push(`file 'f${i}.jpg'`, `duration ${dur.toFixed(4)}`); });
    lines.push(`file 'f${fr.length - 1}.jpg'`);
    writeFileSync(join(dir, 'list.txt'), lines.join('\n') + '\n');
    const total = fr.length ? lines.filter((l) => l.startsWith('duration')).reduce((s, l) => s + +l.split(' ')[1], 0) : 0;
    const speed = total > 20 ? Math.min(total / 20, 1.3) : 1;
    const vf = [this.crop ? `crop=${this.crop.join(':')}` : null, `scale=${this.width}:-2:flags=lanczos:in_range=pc:out_range=tv`, speed > 1 ? `setpts=PTS/${speed.toFixed(3)}` : null, 'setsar=1', `fps=${this.fps}`].filter(Boolean).join(',');
    mkdirSync(out, { recursive: true }); mkdirSync(posterDir, { recursive: true });
    const report = { id, frames: fr.length, seconds: +(total / speed).toFixed(1) };
    const encode = (ext, crfs, argsOf) => { for (const crf of crfs) { const f = join(out, `${id}.${ext}`); const r = spawnSync('nice', ['-n', '10', 'ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf', vf, ...argsOf(crf, this.fps), f], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`ffmpeg ${ext}: ${r.stderr}`); const size = statSync(f).size; report[ext] = `${Math.round(size / 1024)} KB crf ${crf}`; if (size <= MAX_BYTES) return; } };
    encode('webm', WEBM_CRFS, webmArgs); encode('mp4', MP4_CRFS, mp4Args);
    // poster: the frame nearest the 'poster' mark (else the middle), as a palette PNG of at most 60 KB
    const pt = this.marks.poster ?? (t0 + t1) / 2; const pf = fr.reduce((b, f, i) => (Math.abs(f.t - pt) < Math.abs(fr[b].t - pt) ? i : b), 0);
    const png = join(posterDir, `${id}.png`);
    for (const w of [1280, 960, 800, 640]) {
      const pv = [this.crop ? `crop=${this.crop.join(':')}` : null, `scale=${w}:-2:flags=lanczos`].filter(Boolean).join(',');
      spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', join(dir, `f${pf}.jpg`), '-vf', pv, '-frames:v', '1', png]);
      spawnSync('pngquant', ['--force', '--quality', '40-80', '--output', png, png]);
      if (statSync(png).size <= POSTER_MAX) { report.poster = `${Math.round(statSync(png).size / 1024)} KB at ${w}px`; break; }
    }
    rmSync(dir, { recursive: true });
    return report;
  }
}
