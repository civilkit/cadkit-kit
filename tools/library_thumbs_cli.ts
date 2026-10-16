// CLI behind tools/library_thumbs.mjs (run via vite-node; see the launcher).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { snapshotOf } from '@kit/snapshot';

const USAGE = `usage: node tools/library_thumbs.mjs <library folder> [options]
  Renders every .ckpart under the folder to thumbs/<id>.webp and sets "thumb" for the parts library.json lists.
  --force         render again even when the part already has a thumbnail file
  --size WxH      image size in px (default 480x360)
  --png           write png instead of webp (webp needs the cwebp tool on PATH)
  --wasm FILE     kernel wasm (default CK_WASM or apps/cad/public/kernel/ck_wasm.wasm)`;

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) { console.log(USAGE); process.exit(args.length ? 0 : 1); }
const dir = resolve(args.shift()!);
const opt: Record<string, string | true> = {};
while (args.length) {
  const k = args.shift()!;
  if (!k.startsWith('--')) { console.error('unexpected argument ' + k); process.exit(1); }
  opt[k.slice(2)] = ['force', 'png'].includes(k.slice(2)) ? true : (args.shift() ?? '');
}
const [W, H] = typeof opt.size === 'string' ? opt.size.split('x').map(Number) : [480, 360];
const wasm = (opt.wasm as string | undefined) ?? process.env.CK_WASM ?? resolve(process.cwd(), 'apps/cad/public/kernel/ck_wasm.wasm');
const haveWebp = !opt.png && spawnSync('cwebp', ['-version']).status === 0;
if (!opt.png && !haveWebp) console.log('cwebp not found: writing png thumbnails');
const ext = haveWebp ? 'webp' : 'png';

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  if (n === 'thumbs' || n === 'node_modules' || n.startsWith('.')) return [];
  return statSync(p).isDirectory() ? walk(p) : n.endsWith('.ckpart') ? [p] : [];
});
const files = walk(dir).sort();
if (!files.length) { console.error('no .ckpart files under ' + dir); process.exit(1); }

const manifestPath = join(dir, 'library.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) as { parts?: Array<{ id: string; file: string; thumb?: string }> } : null;
if (!manifest) console.log('no library.json here: only the images are written');
const byFile = new Map((manifest?.parts ?? []).map((p) => [p.file, p] as const));

mkdirSync(join(dir, 'thumbs'), { recursive: true });
let made = 0, skipped = 0, failed = 0;
for (const f of files) {
  const rel = relative(dir, f).split('\\').join('/');
  const entry = byFile.get(rel);
  const id = entry?.id ?? rel.replace(/^.*\//, '').replace(/\.ckpart$/, '');
  const out = `thumbs/${id}.${ext}`;
  if (!opt.force && existsSync(join(dir, out))) { skipped++; if (entry && entry.thumb !== out) entry.thumb = out; continue; }
  let session: Session | null = null;
  try {
    session = await Session.open(JSON.parse(readFileSync(f, 'utf8')) as PartDoc, { wasmPath: wasm });
    const snap = await snapshotOf(session, { view: 'iso', size: { width: W, height: H } });
    const png = join(dir, `thumbs/${id}.png`);
    writeFileSync(png, snap.png);
    if (haveWebp) {
      if (spawnSync('cwebp', ['-quiet', '-q', '88', png, '-o', join(dir, out)]).status !== 0) throw new Error('cwebp failed');
      unlinkSync(png);
    }
    if (entry) entry.thumb = out;
    made++;
    console.log('ok   ' + rel + ' -> ' + out);
  } catch (e) {
    failed++;
    console.log('FAIL ' + rel + ': ' + String((e as Error).message ?? e).slice(0, 120));
  } finally { await session?.close().catch(() => {}); }
}
if (manifest) writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
console.log(`${made} made, ${skipped} already had one, ${failed} failed${manifest ? '; library.json updated' : ''}`);
const unlisted = manifest ? files.filter((f) => !byFile.has(relative(dir, f).split('\\').join('/'))) : [];
if (unlisted.length) console.log(`${unlisted.length} file(s) are not listed in library.json (their images were written but nothing points to them)`);
process.exit(failed ? 2 : 0);
