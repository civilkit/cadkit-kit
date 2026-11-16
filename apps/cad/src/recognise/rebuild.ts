// Rebuild the recognised script, dropping the features the kernel rejects instead of losing everything for one bad record.
import type { Analysis } from './analyse';

export type Attempt = { ok: true; volume: number; valid: boolean } | { ok: false; line?: number; message: string };
export interface Outcome { analysis: Analysis; rebuilt: { ok: true; volume: number; valid: boolean } | { ok: false; message: string } | null }

/** Try the script; when the kernel rejects a line that stands for one recognised feature, drop that line (and say so in `skipped`) and try again.
 *  The stock line is never dropped: without it there is nothing to rebuild. The returned analysis carries the script that was finally built. */
export async function rebuildDropping(analysis: Analysis, tryBuild: (script: string) => Promise<Attempt>, limit = 40): Promise<Outcome> {
  if (!analysis.script) return { analysis, rebuilt: null };
  let lines = analysis.script.split('\n').slice(0, -1), ids = analysis.lineIds.slice();
  const dropped: Array<{ id: string; why: string; code: string; family: string }> = [];
  for (let n = 0; n <= limit; n++) {
    const r = await tryBuild(lines.join('\n') + '\n');
    const result = dropped.length ? { ...analysis, script: lines.join('\n') + '\n', lineIds: ids, handled: analysis.handled.filter((h) => !dropped.some((d) => d.id === h)), skipped: [...analysis.skipped, ...dropped] } : analysis;
    if (r.ok) return { analysis: result, rebuilt: { ok: true, volume: r.volume, valid: r.valid } };
    const at = (r.line ?? 0) - 1;
    const id = ids[at];
    // a line that is not one recognised feature (the stock, the first line), or no line at all: nothing more to drop
    if (at < 1 || !id || id === 'stock' || ids.length !== lines.length) return { analysis: result, rebuilt: { ok: false, message: r.message } };
    dropped.push({ id, why: r.message, code: 'kernel', family: id.split('/')[0] });
    lines.splice(at, 1); ids.splice(at, 1);
  }
  return { analysis, rebuilt: { ok: false, message: 'too many features were rejected by the kernel' } };
}
