// CLI behind tools/snapshot.mjs: render a .ckpart through the kernel to a PNG (run via vite-node; see the launcher).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { diffImages, snapshotOf, type SessionSnapshotOpts, type SectionRequest, type V3 } from '@kit/snapshot';

const USAGE = `usage: node tools/snapshot.mjs <part.ckpart> [options]
  --out FILE            output PNG (default snapshot.png)
  --view NAME|az,el     iso top front right back left bottom, or azimuth,elevation in degrees (default iso)
  --up y|z              up axis of the standard views (default y)
  --size N|WxH          panel size in px (default 768)
  --style S             shaded edges xray hidden-line mono
  --projection P        ortho (default) or persp
  --sheet S             single drawing-first-angle drawing-third-angle ab orthos section
  --section SPEC        x=5 | y=5 | z=5 | ox,oy,oz:nx,ny,nz  (draws the exact cut; with --sheet section a section view)
  --marker x,y,z[:LABEL]   repeatable
  --dim x,y,z:x,y,z[:LABEL]   dimension line between two points, repeatable
  --highlight ID,ID     face ids to colour
  --frame cx,cy,cz,r    pin the framing (before / after comparisons)
  --bg #rrggbb          background
  --diff OTHER.png      also write <out>.diff.png and print the changed percentage against OTHER.png
  --wasm FILE           kernel wasm (default CK_WASM or apps/cad/public/kernel/ck_wasm.wasm)`;

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) { console.log(USAGE); process.exit(args.length ? 0 : 1); }
const part = args.shift()!;
const o: Record<string, string[]> = {};
while (args.length) {
  const k = args.shift()!;
  if (!k.startsWith('--')) { console.error('unexpected argument ' + k); process.exit(1); }
  (o[k.slice(2)] ??= []).push(args.shift() ?? '');
}
const one = (k: string) => o[k]?.[0];
const nums = (s: string) => s.split(',').map(Number) as number[];

const opts: SessionSnapshotOpts = {};
const v = one('view');
if (v) opts.view = /^-?[\d.]+,-?[\d.]+$/.test(v) ? { azimuth: nums(v)[0], elevation: nums(v)[1] } : (v as never);
if (one('up')) opts.up = one('up') as 'y' | 'z';
const sz = one('size');
if (sz) opts.size = sz.includes('x') ? { width: +sz.split('x')[0], height: +sz.split('x')[1] } : +sz;
if (one('style')) opts.style = one('style') as never;
if (one('projection')) opts.projection = one('projection') as never;
if (one('sheet')) opts.sheet = one('sheet') as never;
if (one('bg')) opts.background = one('bg');
if (one('highlight')) opts.highlight = one('highlight')!.split(',');
if (one('frame')) { const f = nums(one('frame')!); opts.frame = { center: [f[0], f[1], f[2]], radius: f[3] }; }
const sec = one('section');
if (sec) {
  const m = /^([xyz])=(-?[\d.]+)$/.exec(sec);
  opts.section = (m ? { axis: m[1], at: +m[2] } : (() => { const [a, b] = sec.split(':'); return { origin: nums(a), normal: nums(b) }; })()) as SectionRequest;
}
opts.markers = (o.marker ?? []).map((m) => { const [p, label] = m.split(':'); return { p: nums(p) as V3, label }; });
opts.annotate = (o.dim ?? []).map((m) => { const [a, b, label] = m.split(':'); return { from: nums(a) as V3, to: nums(b) as V3, label }; });

const doc = JSON.parse(readFileSync(part, 'utf8')) as PartDoc;
const wasm = one('wasm') ?? process.env.CK_WASM ?? resolve(process.cwd(), 'apps/cad/public/kernel/ck_wasm.wasm');
const session = await Session.open(doc, { wasmPath: wasm });
try {
  const r = await snapshotOf(session, opts);
  const out = one('out') ?? 'snapshot.png';
  writeFileSync(out, r.png);
  console.log(`${out}: ${r.width}x${r.height}, ${r.meta.triangles} triangles, ${r.meta.ms} ms, view ${r.meta.view}, scale ${r.meta.scale.toFixed(3)} px/mm`);
  console.log(`bbox ${r.meta.bbox.min.map((x) => +x.toFixed(3))} .. ${r.meta.bbox.max.map((x) => +x.toFixed(3))}; frame centre ${r.meta.frame.center.map((x) => +x.toFixed(3))} radius ${+r.meta.frame.radius.toFixed(3)}`);
  if (one('diff')) {
    const d = await diffImages(new Uint8Array(readFileSync(one('diff')!)), r.png);
    writeFileSync(out.replace(/\.png$/, '') + '.diff.png', d.diffPng);
    console.log(`diff vs ${one('diff')}: ${d.changedPct}% changed${d.bbox ? ` in box ${JSON.stringify(d.bbox)}` : ''}`);
  }
} finally {
  await session.close();
}
process.exit(0);
