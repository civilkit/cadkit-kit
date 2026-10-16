// Repro for docs/kernel-bug-text-lens.md (run: node tools/repro_text_lens.mjs): an embossed text fused into a dial plate fails with
// booleanFailed when a domed glass lens (revolved spherical shell of a very large radius, far above the dial) exists in the part.
// Prints, per case, the script errors; the last block scans the radius of the numeral.
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../apps/cad/src/controller';
import { runScript, type ScriptHost } from '@kit/script';
import { writeFileSync } from 'node:fs';

// disc r 26 (z 0..1.9), lens = revolved shell: inner sphere through (0, zi+hi) and (Rl, zi), outer sphere 1.5 mm further out
function script(o: { lens: boolean; rho: number; label?: string; shape?: 'rect' | 'circle'; hLens?: number; ang?: number; fuse?: number }): string {
  const Rl = 27, hi = o.hLens ?? 1.2, zi = 7.6, Rsi = (Rl * Rl + hi * hi) / (2 * hi), zc = zi + hi - Rsi, Rso = Rsi + 1.5, za = zc + Math.sqrt(Rso * Rso - Rl * Rl);
  const mid = (Rs: number, zz: number) => { const a0 = Math.atan2(zz - zc, Rl), am = (a0 + Math.PI / 2) / 2; return [Rs * Math.cos(am), zc + Rs * Math.sin(am)]; };
  const a = ((o.ang ?? 225) * Math.PI) / 180;
  return `
const P = part('Dial');
P.sketch('front', (s) => s.circle(26)).extrude(1.9);
${o.lens ? `
const f = (q) => [q[0], -q[1]];   // 'top' plane: sketch y = -z
P.sketch('top', (s) => {
  s.line(f([0, ${zi + hi}]), f([0, ${zc + Rso}]));
  s.arc3(f([0, ${zc + Rso}]), f([${mid(Rso, za)[0]}, ${mid(Rso, za)[1]}]), f([${Rl}, ${za}]));
  s.line(f([${Rl}, ${za}]), f([${Rl}, ${zi}]));
  s.arc3(f([${Rl}, ${zi}]), f([${mid(Rsi, zi)[0]}, ${mid(Rsi, zi)[1]}]), f([0, ${zi + hi}]));
}); P.revolve(360, { axis: { from: [0, 0], to: [0, -1] } });` : ''}
P.sketch(at('front', ${1.9 - (o.fuse ?? 0.1)}), (s) => ${o.shape === 'rect' ? `s.rect(1.4, 2.4, [${(o.rho * Math.cos(a)).toFixed(4)}, ${(o.rho * Math.sin(a)).toFixed(4)}])` : o.shape === 'circle' ? `s.circle(0.8, [${(o.rho * Math.cos(a)).toFixed(4)}, ${(o.rho * Math.sin(a)).toFixed(4)}])` : `s.text('${o.label ?? '0'}', [${(o.rho * Math.cos(a)).toFixed(4)}, ${(o.rho * Math.sin(a)).toFixed(4)}], { height: 2.4, anchor: ['center', 'middle'] })`}).extrude(0.25);
`;
}

const sessions: Session[] = [];
async function run(src: string): Promise<{ errors: string; doc: unknown }> {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('x') as never);
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
  };
  const r = await runScript(src, h);
  return { errors: r.errors.length ? r.errors.map((e) => e.message).join('; ') : 'ok', doc: r.document };
}

const cases: Array<[string, Parameters<typeof script>[0]]> = [
  ['no lens, rho 10', { lens: false, rho: 10 }],
  ['lens,    rho 10', { lens: true, rho: 10 }],
  ['lens,    rho 14', { lens: true, rho: 14 }],
];
for (const [name, o] of cases) { const r = await run(script(o)); console.log(name.padEnd(20), r.errors); if (name.startsWith('lens,    rho 10')) writeFileSync(process.env.REPRO_DOC ?? 'repro_text_lens_doc.json', JSON.stringify(r.doc, null, 1)); }
console.log('\nscan of the numeral radius rho (mm from the dial centre, at 225 deg), lens present:');
const row: string[] = [];
for (let rho = 4; rho <= 16; rho += 0.5) { const r = await run(script({ lens: true, rho })); row.push(`${rho.toFixed(1)}:${r.errors === 'ok' ? 'ok' : 'FAIL'}`); }
console.log(row.join('  '));
console.log('\nscan of the angle (deg) at rho 13:');
const row2: string[] = [];
for (let ang = 0; ang < 360; ang += 30) { const r = await run(script({ lens: true, rho: 13, ang })); row2.push(`${ang}:${r.errors === 'ok' ? 'ok' : 'FAIL'}`); }
console.log(row2.join('  '));
console.log('\nscan of the lens rise hi (mm; sphere radius = (27^2 + hi^2) / (2 hi)) at rho 13, 225 deg:');
const row3: string[] = [];
for (const hLens of [0.3, 0.6, 1.2, 2, 3, 5, 8]) { const r = await run(script({ lens: true, rho: 13, hLens })); row3.push(`${hLens}:${r.errors === 'ok' ? 'ok' : 'FAIL'}`); }
console.log(row3.join('  '));
console.log('\nfuse depth (how far the text starts inside the dial; 0 = coplanar start on the top face) at rho 13:');
const row4: string[] = [];
for (const fuse of [0, 0.05, 0.1, 0.3, 1]) { const r = await run(script({ lens: true, rho: 13, fuse })); row4.push(`${fuse}:${r.errors === 'ok' ? 'ok' : 'FAIL'}`); }
console.log(row4.join('  '));
console.log('\nother labels at rho 13, 225 deg:');
const row5: string[] = [];
for (const label of ['0', '1', 'A', 'I', '8', '100']) { const r = await run(script({ lens: true, rho: 13, label })); row5.push(`${label}:${r.errors === 'ok' ? 'ok' : 'FAIL'}`); }
console.log(row5.join('  '));
console.log('\nthe same without text: a plain rectangle / circle boss instead of the glyph (rho 13, 225 deg):');
const row6: string[] = [];
for (const shape of ['rect', 'circle'] as const) { const r = await run(script({ lens: true, rho: 13, shape })); row6.push(`${shape}:${r.errors === 'ok' ? 'ok' : 'FAIL'}`); }
console.log(row6.join('  '));
for (const s of sessions) await s.close().catch(() => {});
