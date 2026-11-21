// Decimate a scan (0.8.7): Convert mesh to solid on a noisy scan-like mesh (about 54,000 triangles, a puck with scan noise; the file is made outside the
// repository, CLIP_MESH_FILE names it). Tick "Reduce the triangles first (Decimate)", set the largest deviation to 0.05, Convert: the card reports the triangles
// before and after and the deviation reached; Add to part puts the solid in the part. Load-tolerant (see clipkit.mjs).
import { readFileSync } from 'node:fs';
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const FILE = process.env.CLIP_MESH_FILE || '/path/to/Development/cadkit/_scratch-clip-087/scanned-puck.stl';
const TID = (id) => `document.querySelector('[data-testid="${id}"]')`;

export default {
  id: 'decimate-scan',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, newDoc('Part', []), { workspace: null });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    // keep the caption clear of the panel's buttons: right of the panel, at the bottom (or the top once the notice shows)
    const cap = async (text, n, top = false) => { await k.caption(text, n); await rec.skip(() => page.eval(`(() => { const e = document.getElementById('__cap'); e.style.left = '790px'; e.style.transform = 'none'; e.style.maxWidth = '470px'; e.style.bottom = ${top} ? 'auto' : '58px'; e.style.top = ${top} ? '200px' : 'auto'; })()`)); await rec.paint(); };
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    const b64 = readFileSync(FILE).toString('base64');
    const name = FILE.split('/').pop();
    // the browser's file picker cannot be driven: an input of type file that is clicked is answered with this file
    await page.eval(`(() => { const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type !== 'file') return orig.call(this); const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([u], ${JSON.stringify(name)})); Object.defineProperty(this, 'files', { value: dt.files }); setTimeout(() => this.onchange && this.onchange(), 50); }; return 0; })()`);
    await k.settle();
    await rec.begin();
    rec.x = 900; rec.y = 560;
    await cap('A scan: tens of thousands of tiny triangles', 1);
    await hold(2400);
    await k.key('f');
    await k.waitUi(`!!document.querySelector('[role=dialog] input, .cmdk input, input[placeholder*="Search"]')`, 'the command search');
    await k.step(() => page.send('Input.insertText', { text: 'mesh to solid' }), 900);
    await k.step(() => page.key('Enter'), 300);
    await k.waitUi(`!!${TID('m2s-panel')} && !!${TID('m2s-run')} && !${TID('m2s-run')}.disabled`, 'the panel with the mesh', 120000);
    await k.settle();
    await k.snap('58a-panel');
    await cap('Convert mesh to solid: the file is opened', 2);
    await hold(3600);
    await cap('Tick Decimate and allow 0.05 mm of deviation', 3);
    await k.clickEl(TID('m2s-decimate'), 'left', 1800);
    await k.waitUi(`!!${TID('m2s-decimateTol')}`, 'the decimate options');
    await k.clickEl(TID('m2s-decimateTol'), 'left', 400);
    await k.typeOut('0.05', 450);
    await hold(3000);
    await k.snap('58b-options');
    await cap('Convert: the triangles are thinned first, then fitted', 4);
    await k.clickEl(TID('m2s-run'), 'left', 500);
    await k.waitUi(`!!${TID('m2s-headline')} || !!${TID('m2s-refusal')} || !!${TID('m2s-failed')}`, 'the result', 170000);
    await k.settle();
    await k.snap('58c-result');
    if (!(await page.eval(`!!${TID('m2s-decimated')}`))) throw new Error('no decimation report line');
    rec.mark('poster');
    await cap('The card says: from N to M triangles, within 0.05 mm', 5);
    await hold(8500);
    await cap('Add to part: a solid you can model on', 6, true);
    await k.clickEl(TID('m2s-accept'), 'left', 600);
    await k.settle();
    await k.snap('58d-added');
    await hold(6000);
    if (process.env.CLIP_DRY) return { id: 'decimate-scan', dry: true };
    return rec.finish('decimate-scan', ctx.outDir, ctx.posterDir);
  },
};
