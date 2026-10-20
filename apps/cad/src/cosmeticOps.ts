// Edits that only label features (a folder is the `group` string, plus renames and hide flags). The kernel leaves these keys out of its regen
// cache key and never reads them (kernel docs/regen-cache.md, "Cosmetic fields"), so such an edit is answered from the cache and rebuilds
// nothing: the app must not call it a rebuild.
import type { EditOp } from '@ck/session';

/** The feature keys that are labels only. Keep in step with the kernel's list. */
export const COSMETIC_KEYS: readonly string[] = ['group', 'name', 'autoName', 'visible', 'userHidden'];

/** How long a label-only edit may take before the "Rebuilding model" panel is raised for it (a cache hit is far below this; a cold
 *  kernel that really rebuilds is not). */
export const LABEL_BUSY_MS = 2000;

type Feat = { id: string; [k: string]: unknown };
const bare = (f: Feat): string => JSON.stringify(Object.fromEntries(Object.entries(f).filter(([k]) => !COSMETIC_KEYS.includes(k))));

/** True when every op only sets cosmetic keys (a `set` of one) or replaces a feature by itself but for them (ungrouping). */
export function cosmeticOnly(features: readonly Feat[], ops: readonly EditOp[]): boolean {
  return ops.length > 0 && ops.every((o) => {
    if (o.op === 'set') return COSMETIC_KEYS.includes(o.path.split('.')[0]);
    if (o.op !== 'replace') return false;
    const cur = features.find((f) => f.id === o.id);
    return !!cur && bare(cur) === bare(o.feature as unknown as Feat);
  });
}
