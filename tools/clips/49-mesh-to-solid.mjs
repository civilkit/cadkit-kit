// Convert mesh to solid (0.8.5): in an empty part, Search commands "mesh to solid" opens the panel and asks for a mesh file (the file picker is answered with a
// cube that has a square hole in one face); Convert is refused in red and the gaps are marked with red crosses in the view; "Close the gaps and try again" gives the
// green result with the filled hole listed; the Show choice is switched Solid, Mesh, Both. The mesh is read from CLIP_MESH_FILE (default: the cube_with_hole.stl of the
// meshsolid test folder). Load-tolerant (see clipkit.mjs).
import { readFileSync } from 'node:fs';
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const FILE = process.env.CLIP_MESH_FILE || '/path/to/Development/cadkit/_scratch-meshsolid-gui/cube_with_hole.stl';
const TID = (id) => `document.querySelector('[data-testid="${id}"]')`;

export default {
  id: 'mesh-to-solid',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, newDoc('Part', []), { workspace: null });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    // the browser's file picker cannot be driven: an input of type file that is clicked is answered with this file
    const b64 = readFileSync(FILE).toString('base64');
    const name = FILE.split('/').pop();
    await page.eval(`(() => { const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type !== 'file') return orig.call(this); const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([u], ${JSON.stringify(name)})); Object.defineProperty(this, 'files', { value: dt.files }); setTimeout(() => this.onchange && this.onchange(), 50); }; return 0; })()`);
    await k.settle();
    await rec.begin();
    rec.x = 900; rec.y = 560;
    await rec.wait(1200);
    // ---- the command
    await k.key('f');
    await k.waitUi(`!!document.querySelector('[role=dialog] input, .cmdk input, input[placeholder*="Search"]')`, 'the command search');
    await k.step(() => page.send('Input.insertText', { text: 'mesh to solid' }), 1200);
    await k.snap('49a-search');
    await k.step(() => page.key('Enter'), 300);
    await k.waitUi(`!!${TID('m2s-panel')} && !!${TID('m2s-run')} && !${TID('m2s-run')}.disabled`, 'the panel with the mesh', 120000);
    await k.settle();
    await k.snap('49b-panel');
    rec.mark('poster-a');
    await rec.wait(2200);
    // ---- Convert: refused, gaps marked
    await k.clickEl(TID('m2s-run'), 'left', 500);
    await k.waitUi(`!!${TID('m2s-refusal')}`, 'the refusal', 120000);
    await k.settle();
    await k.snap('49c-refused');
    await rec.wait(4200);
    // ---- Close the gaps and try again
    await k.clickEl(TID('m2s-retry-closed'), 'left', 500);
    await k.waitUi(`!!${TID('m2s-headline')}`, 'the result', 120000);
    await k.settle();
    await k.snap('49d-result');
    rec.mark('poster');
    await rec.wait(4200);
    // ---- Show: Solid, Mesh, Both
    for (const s of ['solid', 'mesh', 'both']) {
      await k.clickEl(`document.querySelector('[data-testid="m2s-show"] [data-show="${s}"]')`, 'left', 400);
      await k.settle(800);
      await rec.wait(1700);
    }
    await k.snap('49e-both');
    if (process.env.CLIP_DRY) return { id: 'mesh-to-solid', dry: true };
    return rec.finish('mesh-to-solid', ctx.outDir, ctx.posterDir);
  },
};
