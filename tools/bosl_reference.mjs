// Regenerates apps/cad/src/catalog/bosl_reference.json: for every BOSL2 catalog entry and parameter set (defaults + four seeded
// random sets) it runs the real BOSL2 module in OpenSCAD, exports an STL and records volume, surface area and bounding box.
// CI and other machines do NOT need OpenSCAD: they read the JSON. Run this only when entries change or BOSL2 is updated.
//
//   node tools/bosl_reference.mjs --bosl <dir that contains BOSL2/> --scratch <empty work dir> [--only cuboid,tube] [--fn 256]
//
// One OpenSCAD process at a time. Needs Node 22.18+ (type stripping) to read the TypeScript entries.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']] : a), []));
const bosl = resolve(args.bosl ?? process.env.OPENSCADPATH ?? '');
const scratch = resolve(args.scratch ?? '');
if (!args.bosl && !process.env.OPENSCADPATH) throw new Error('give --bosl <dir that contains BOSL2/>');
if (!args.scratch) throw new Error('give --scratch <work dir> (never a system temp dir shared with other work)');
if (!existsSync(join(bosl, 'BOSL2', 'std.scad'))) throw new Error(`${bosl}/BOSL2/std.scad not found`);
mkdirSync(scratch, { recursive: true });
const FN = Number(args.fn ?? 256);
const OPENSCAD = args.openscad ?? (existsSync('/opt/homebrew/bin/openscad') ? '/opt/homebrew/bin/openscad' : 'openscad');
const out = resolve(args.out ?? new URL('../apps/cad/src/catalog/bosl_reference.json', import.meta.url).pathname);

const { BOSL_ENTRIES, defaultParams, randomParams } = await import(new URL('../apps/cad/src/catalog/bosl/entries.ts', import.meta.url).href);

/** Binary STL to volume (signed tetrahedra), area and bounding box. */
export function measureStl(buf) {
  const n = buf.readUInt32LE(80);
  let vol = 0, area = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    const v = [0, 1, 2].map((k) => [buf.readFloatLE(o + k * 12), buf.readFloatLE(o + k * 12 + 4), buf.readFloatLE(o + k * 12 + 8)]);
    for (const p of v) for (let i = 0; i < 3; i++) { if (p[i] < min[i]) min[i] = p[i]; if (p[i] > max[i]) max[i] = p[i]; }
    const [a, b, c] = v;
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    area += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
  }
  return { volume: Math.abs(vol), area, bbox: { min, max }, triangles: n };
}

const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const only = args.only ? new Set(args.only.split(',')) : null;
const prev = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { entries: {} };
const vr = spawnSync(OPENSCAD, ['--version'], { encoding: 'utf8' });
const version = `${vr.stdout}${vr.stderr}`.trim();
let commit = 'unknown';
try { commit = execFileSync('git', ['-C', join(bosl, 'BOSL2'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }

const result = { openscad: version, bosl2: { repo: 'https://github.com/BelfrySCAD/BOSL2', commit, licence: 'BSD-2-Clause' }, fn: FN, entries: { ...(prev.entries ?? {}) } };
for (const e of BOSL_ENTRIES) {
  if (only && !only.has(e.id)) continue;
  const sets = [{ name: 'default', params: defaultParams(e) }, ...randomParams(e, hash(e.id), 4).map((params, i) => ({ name: `random${i + 1}`, params })), ...Object.entries(e.samples ?? {}).map(([name, params]) => ({ name, params }))];
  const old = prev.openscad === version && prev.bosl2?.commit === commit && prev.fn === FN ? prev.entries?.[e.id] ?? [] : [];
  result.entries[e.id] = [];
  for (const s of sets) {
    const cached = old.find((o) => o.name === s.name && o.scad === e.scad(s.params));
    if (cached) { result.entries[e.id].push(cached); console.log(e.id, s.name, 'cached'); continue; }
    const scad = `include <BOSL2/std.scad>\n$fn=${FN};\n${e.scad(s.params)}\n`;
    const f = join(scratch, `${e.id}_${s.name}`);
    writeFileSync(`${f}.scad`, scad);
    execFileSync(OPENSCAD, ['-o', `${f}.stl`, '--export-format', 'binstl', `${f}.scad`], { env: { ...process.env, OPENSCADPATH: bosl }, stdio: ['ignore', 'ignore', 'pipe'] });
    const m = measureStl(readFileSync(`${f}.stl`));
    result.entries[e.id].push({ name: s.name, params: s.params, scad: e.scad(s.params), volume: m.volume, area: m.area, bbox: m.bbox });
    console.log(e.id, s.name, m.volume.toFixed(3));
  }
}
result.generated = new Date().toISOString().slice(0, 10);
writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
console.log('wrote', out);
