// Importing a mesh: a .glb file dropped on the window (a bracket of five coloured bodies, written with the kit's own GLB writer, in metres and Y up
// as glTF has it), the import dialog (triangles, size, the unit the file states, the colours read, what is not kept), Import, the mesh in the viewport
// in its colours and the notice that lists what was not read; then a small .obj (a nut and a stud) the same way.
// The two files are made outside the repository (the folder named by CLIP_MESH_DIR holds bracket.glb and nut-and-stud.obj) with the
// writers of packages/io (glb.ts, obj.ts, testmesh.ts). Every move, click and wait is made inside rec.skip (its time is cut) and the clip holds
// for fixed, readable times between them, so the pace does not depend on the machine (the pointer moves in a few hops).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIR = process.env.CLIP_MESH_DIR ? resolve(process.env.CLIP_MESH_DIR) : null;
export default {
  id: 'mesh-import',
  async run(rec, ctx) {
    const { page } = ctx;
    if (!DIR) throw new Error('set CLIP_MESH_DIR to the folder with bracket.glb and nut-and-stud.obj');
    await ctx.openApp();
    await rec.waitFor(`/ready/i.test(document.querySelector('.status')?.textContent ?? '')`, 'the app to be ready');
    await sleep(1000);
    await page.eval(`document.querySelector('button[aria-label="New part"]').click()`);
    await sleep(2500);
    const step = async (fn, hold = 130) => { await rec.skip(async () => { await fn(); await rec.paint(); await sleep(150); }); await rec.paint(); await sleep(hold); };
    const hop = (x, y) => step(async () => { await page.mouse('mouseMoved', x, y); rec.x = x; rec.y = y; }, 60);
    const go = async (x, y, n = 5) => { const x0 = rec.x, y0 = rec.y; for (let i = 1; i <= n; i++) { const k = i / n, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; await hop(x0 + (x - x0) * e, y0 + (y - y0) * e); } };
    const click = async (expr) => { const [x, y] = await rec.rect(expr); await go(x, y); await step(async () => { await page.mouse('mousePressed', x, y); await page.mouse('mouseReleased', x, y); await sleep(150); }, 250); };
    // the same path as a file dropped on the window: a synthetic drop event carrying a File made from the bytes
    const drop = async (file) => {
      const b64 = readFileSync(resolve(DIR, file)).toString('base64');
      await page.eval(`(() => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([u], ${JSON.stringify(file)})); for (const t of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true })); return 0; })()`);
      await rec.waitFor(`!!document.querySelector('[data-testid=mesh-import]')`, 'the import dialog');
    };
    const imported = (n) => `document.querySelectorAll('.tree .row').length > 0 && [...document.querySelectorAll('.tree .row-name')].filter((e) => /\\(mesh\\)/.test(e.textContent)).length >= ${n}`;
    await rec.begin();
    await rec.wait(1000);
    // ---- the GLB
    await rec.skip(async () => { await drop('bracket.glb'); await sleep(700); });
    await rec.wait(4800);
    await click(`document.querySelector('[data-testid=mesh-import-ok]')`);
    // the mesh is listed and the notice of what was not read is up (it stays for a few seconds: the hold starts as soon as it shows)
    await rec.skip(async () => { await rec.waitFor(`${imported(1)} && /Not everything in/.test(document.body.innerText)`, 'the mesh and its notice'); await sleep(300); });
    await rec.wait(1800);
    rec.mark('poster');
    await rec.wait(2200);
    await click(`document.querySelector('button[aria-label="Fit"]')`);
    await rec.skip(async () => { await sleep(1500); });
    await rec.wait(1200);
    // ---- the OBJ
    await rec.skip(async () => { await drop('nut-and-stud.obj'); await sleep(700); });
    await rec.wait(2600);
    await click(`document.querySelector('[data-testid=mesh-import-ok]')`);
    await rec.skip(async () => { await rec.waitFor(imported(2), 'the second mesh'); await sleep(2500); });
    await rec.wait(3000);
    return rec.finish('mesh-import', ctx.outDir, ctx.posterDir);
  },
};
