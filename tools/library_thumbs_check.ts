// Is every part of a library folder pictured, and is the picture of the part as it is now? Shared by tools/library_thumbs.mjs --check
// (CI) and apps/cad/src/library/samples.thumbs.test.ts. The picture of part <id> is thumbs/<id>.webp (or .png); thumbs/hashes.json
// holds, per id, the docHash of the document the picture was drawn from. A picture with no hash entry counts as stale.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { docHash } from '../apps/cad/src/files/docThumb';

export interface LibPart { id: string; file: string; path: string }
export type ThumbProblem = { id: string; file: string; problem: 'missing' | 'stale' | 'unhashed' };

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  if (n === 'thumbs' || n === 'node_modules' || n.startsWith('.')) return [];
  return statSync(p).isDirectory() ? walk(p) : n.endsWith('.ckpart') ? [p] : [];
});

/** The parts of a folder: those library.json lists, else those index.json lists (the bundled samples), else every .ckpart under it. */
export function libraryParts(dir: string): LibPart[] {
  const read = (n: string): unknown => (existsSync(join(dir, n)) ? JSON.parse(readFileSync(join(dir, n), 'utf8')) : null);
  const lib = read('library.json') as { parts?: Array<{ id: string; file: string }> } | null;
  const idx = read('index.json');
  const listed = lib?.parts ?? (Array.isArray(idx) ? (idx as Array<{ id: string; file: string }>) : null);
  if (listed) return listed.map((p) => ({ id: p.id, file: p.file, path: join(dir, p.file) }));
  return walk(dir).sort().map((f) => { const rel = relative(dir, f).split('\\').join('/'); return { id: rel.replace(/^.*\//, '').replace(/\.ckpart$/, ''), file: rel, path: f }; });
}

export const thumbFile = (dir: string, id: string): string | null => ['webp', 'png'].map((e) => join(dir, 'thumbs', `${id}.${e}`)).find(existsSync) ?? null;
export const readHashes = (dir: string): Record<string, string> => { try { return JSON.parse(readFileSync(join(dir, 'thumbs', 'hashes.json'), 'utf8')) as Record<string, string>; } catch { return {}; } };
export const partHash = (p: LibPart): string => docHash(JSON.parse(readFileSync(p.path, 'utf8')));

export function thumbProblems(dir: string, parts: LibPart[] = libraryParts(dir)): ThumbProblem[] {
  const hashes = readHashes(dir);
  const out: ThumbProblem[] = [];
  for (const p of parts) {
    if (!thumbFile(dir, p.id)) out.push({ id: p.id, file: p.file, problem: 'missing' });
    else if (!hashes[p.id]) out.push({ id: p.id, file: p.file, problem: 'unhashed' });
    else if (hashes[p.id] !== partHash(p)) out.push({ id: p.id, file: p.file, problem: 'stale' });
  }
  return out;
}
