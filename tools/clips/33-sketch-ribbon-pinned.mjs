// The Sketch tab of the ribbon (0.7.5), in a window about 1000 px wide: the tools scroll sideways while Select and Finish stay pinned at the left; then the Import group:
// Import DXF adds the outline in a file to the open sketch, Import SVG adds a second shape. The file chooser is replaced by a stub that hands the page a small file (off camera).
// Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const dxfLine = (x1, y1, x2, y2) => `0\nLINE\n8\n0\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0\n`;
// a 60 x 40 plate outline with a 12 mm hole, in mm
const DXF = `0\nSECTION\n2\nENTITIES\n${dxfLine(-30, -20, 30, -20)}${dxfLine(30, -20, 30, 20)}${dxfLine(30, 20, -30, 20)}${dxfLine(-30, 20, -30, -20)}0\nCIRCLE\n8\n0\n10\n0\n20\n0\n30\n0\n40\n6\n0\nENDSEC\n0\nEOF\n`;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40"><path d="M20 2 L38 36 L2 36 Z" fill="none" stroke="black"/></svg>`;
const FRONT = `[...document.querySelectorAll('.tree .row')].find((e) => /^Front Plane/.test(e.querySelector('.row-name')?.textContent ?? ''))`;
const RIBBON = `document.querySelector('.ribbon-wrap .rb-groups')`;

export default {
  id: 'sketch-ribbon-pinned',
  viewport: [1000, 650],
  async run(rec, ctx) {
    const { page } = ctx;
    // the first-visit layout (the ribbon carries the tools): no workspace is stored
    await openDoc(ctx, newDoc('Plate', []), { workspace: null });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    // a still hold longer than 1.5 s is cut short by the encoder (frame durations are capped): paint every 0.7 s so a hold keeps its length
    const wait0 = rec.wait.bind(rec);
    rec.wait = async (ms) => { for (let t = 0; t < ms; t += 700) await wait0(Math.min(700, ms - t)); };
    // the file chooser stub: the next file input clicked gets the file named by window.__pick
    await page.eval(`(() => { const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type !== 'file') return orig.call(this); const p = window.__pick; const dt = new DataTransfer(); dt.items.add(new File([p.text], p.name)); Object.defineProperty(this, 'files', { value: dt.files }); setTimeout(() => this.onchange && this.onchange(), 400); }; })(); 0`);
    const pick = (name, text) => page.eval(`window.__pick = ${JSON.stringify({ name, text })}; 0`);
    await rec.begin();
    rec.x = 600; rec.y = 400;
    await rec.wait(1400);
    // ---- a sketch on the Front Plane
    const p = await k.rect(FRONT);
    await k.rightClick(p.x - 30, p.y, 900);
    await k.clickEl(k.menuItem('/Sketch on this plane/'), 'left', 300);
    await k.waitUi(`!!document.querySelector('.sketch-bar, .ribbon-wrap [data-testid="ribbon-tab-Sketch"]')`, 'the sketch');
    await k.settle();
    await rec.wait(1800);
    await k.snap('33a-sketch');
    // ---- the tools scroll, Select and Finish stay pinned
    const scrollTo = async (x, steps = 10) => {
      const cur = await page.eval(`${RIBBON}.scrollLeft`);
      for (let i = 1; i <= steps; i++) await k.step(() => page.eval(`${RIBBON}.scrollLeft = ${cur + ((x - cur) * i) / steps}; 0`), 60);
    };
    const max = await page.eval(`${RIBBON}.scrollWidth - ${RIBBON}.clientWidth`);
    await scrollTo(max, 14);
    await rec.wait(1500);
    await k.snap('33b-scrolled');
    rec.mark('poster');
    await scrollTo(0, 10);
    await rec.wait(900);
    // ---- the Import group
    await pick('plate.dxf', DXF);
    await k.clickEl(`document.querySelector('[data-slot="sketch-import-dxf"] .slot-btn, [data-slot="sketch-import-dxf"]')`, 'left', 300);
    await k.waitUi(`document.querySelectorAll('.toast, .sketch-bar').length > 0`, 'the import');
    await k.settle(2000);
    await rec.wait(2200);
    await k.snap('33c-dxf');
    await pick('triangle.svg', SVG);
    await k.clickEl(`document.querySelector('[data-slot="sketch-import-svg"] .slot-btn, [data-slot="sketch-import-svg"]')`, 'left', 300);
    await k.settle(2000);
    await rec.wait(2400);
    await k.snap('33d-svg');
    if (process.env.CLIP_DRY) return { id: 'sketch-ribbon-pinned', dry: true };
    return rec.finish('sketch-ribbon-pinned', ctx.outDir, ctx.posterDir);
  },
};
