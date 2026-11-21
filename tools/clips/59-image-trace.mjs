// Trace over an image (0.8.7): in a new sketch on the Front plane, the Image button of the sketch ribbon puts a PNG (a simple outline drawing of a bracket, made
// outside the repository, CLIP_IMAGE_FILE names it) on the sketch plane; its panel has width, position, turn and opacity; Calibrate = two clicks on the drawing's
// dimension ticks and the real distance (80 mm); then a circle is drawn over the large hole. Load-tolerant (see clipkit.mjs).
import { readFileSync } from 'node:fs';
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const FILE = process.env.CLIP_IMAGE_FILE || '/path/to/Development/cadkit/_scratch-clip-087/bracket-outline.png';
const TID = (id) => `document.querySelector('[data-testid="${id}"]')`;
// screen points (css px, 1280 x 720 page) of the drawing after the image is calibrated; set from the dev snapshots
const PT = JSON.parse(process.env.CLIP_PTS || '{"a":[615,518],"b":[941,518],"c":[648,399],"e":[665,399],"a2":[615,493],"b2":[941,493]}');

export default {
  id: 'image-trace',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, newDoc('Bracket', []), { workspace: null });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    // captions at the top of the view, clear of the panel's buttons and the notices at the bottom
    const cap = async (text, n) => { await k.caption(text, n); await rec.skip(() => page.eval(`(() => { const e = document.getElementById('__cap'); e.style.bottom = 'auto'; e.style.top = '205px'; })()`)); await rec.paint(); };
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    const b64 = readFileSync(FILE).toString('base64');
    const name = FILE.split('/').pop();
    await page.eval(`(() => { const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type !== 'file') return orig.call(this); const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([u], ${JSON.stringify(name)})); Object.defineProperty(this, 'files', { value: dt.files }); setTimeout(() => this.onchange && this.onchange(), 50); }; return 0; })()`);
    await k.settle();
    await rec.begin();
    rec.x = 700; rec.y = 420;
    await cap('Start a sketch on the Front plane', 1);
    await hold(1500);
    await k.clickEl(`document.querySelector('.slot[data-slot="new-sketch"] .slot-more') || document.querySelector('.slot[data-slot="new-sketch"] .slot-btn')`, 'left', 900);
    await k.waitUi(`!!document.querySelector('.slot-flyout [data-testid="cmd-sketch-new-front"]')`, 'the plane list');
    await k.clickEl(`document.querySelector('.slot-flyout [data-testid="cmd-sketch-new-front"]')`, 'left', 300);
    await k.waitUi(`!!document.querySelector('[data-action="sketch-ok"]')`, 'the sketch');
    await k.settle();
    await k.snap('59a-sketch');
    await cap('Image, in the Import group: a PNG goes on the sketch plane', 2);
    await hold(1500);
    await k.clickEl(`document.querySelector('.slot[data-slot="sketch-underlay"] .slot-btn, .slot[data-slot="sketch-underlay"]')`, 'left', 600);
    await k.waitUi(`!!${TID('ul-panel')}`, 'the image panel');
    await k.settle();
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('59b-image');
    await hold(2500);
    await cap('Width, position, turn and opacity are in the panel', 3);
    await k.clickEl(`document.querySelector('[data-testid="ul-opacity"]')`, 'left', 600);
    await hold(2000);
    await cap('Calibrate: click two points, then give the real distance', 4);
    await k.clickEl(TID('ul-calibrate'), 'left', 900);
    await k.waitUi(`!!${TID('ul-cal')}`, 'the calibrate step');
    await k.snap('59c-cal');
    await k.click(PT.a[0], PT.a[1], 'left', 1200);
    await k.click(PT.b[0], PT.b[1], 'left', 1200);
    await k.waitUi(`!!${TID('ul-real')}`, 'the distance box');
    await k.clickEl(TID('ul-real'), 'left', 400);
    await k.typeOut('80', 450);
    await k.snap('59d-real');
    await hold(2500);
    await k.clickEl(TID('ul-cal-apply'), 'left', 900);
    await k.settle();
    await k.snap('59e-calibrated');
    await hold(2500);
    await cap('Now draw over it: a circle on the large hole', 5);
    await k.clickEl(`document.querySelector('[data-slot="circle"] .slot-btn, [data-slot="circle"]')`, 'left', 700);
    await k.click(PT.c[0], PT.c[1], 'left', 700);
    await k.click(PT.e[0], PT.e[1], 'left', 900);
    await k.settle(600);
    await k.snap('59f-circle');
    rec.mark('poster');
    await hold(2500);
    await cap('And a line along the base, at true size', 6);
    await k.clickEl(`document.querySelector('[data-slot="line"] .slot-btn, [data-slot="line"]')`, 'left', 700);
    await k.click(PT.a2[0], PT.a2[1], 'left', 700);
    await k.click(PT.b2[0], PT.b2[1], 'left', 900);
    await k.key('Escape');
    await k.settle(600);
    await k.snap('59g-line');
    await hold(2200);
    if (process.env.CLIP_DRY) return { id: 'image-trace', dry: true };
    return rec.finish('image-trace', ctx.outDir, ctx.posterDir);
  },
};
