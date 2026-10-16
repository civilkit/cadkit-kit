// Which bundled samples go into the public static site: only those on the explicit allowlist (apps/cad/pages-samples.allow.json).
// Pure functions (tested in samples.test.ts); tools/build_pages.mjs does the copying.

/** Never published whatever the allowlist says: a private design in heavy/, and the BLDC motors (dimensions from a GPL-licensed table, withheld until a licence decision). */
export const HARD_DENY = [
  { test: (e) => /(^|\/)heavy\//.test(e.file), why: 'samples/heavy/ is a private design' },
  { test: (e) => /(^|\/)bldc-[^/]*\.ckpart$/.test(e.file) || /^bldc-/.test(e.id), why: 'BLDC motors: dimensions come from a GPL-licensed table, withheld until a licence decision' },
];

/**
 * @param {Array<{id:string,title:string,file:string}>} index the full samples/index.json
 * @param {{samples:string[]}} allow parsed pages-samples.allow.json
 * @returns {{kept:Array<{id:string,title:string,file:string}>, dropped:Array<{id:string,reason:string}>}}
 * Throws when the allowlist names an id that is not in the index (stale list), lists an id twice, or lists a hard-denied sample.
 */
export function filterSamples(index, allow) {
  const ids = allow?.samples;
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) throw new Error('allowlist: "samples" must be an array of sample ids');
  const byId = new Map(index.map((e) => [e.id, e]));
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`allowlist: duplicate id ${id}`);
    seen.add(id);
    const e = byId.get(id);
    if (!e) throw new Error(`allowlist: ${id} is not in samples/index.json`);
    const deny = HARD_DENY.find((d) => d.test(e));
    if (deny) throw new Error(`allowlist: ${id} may never be published (${deny.why})`);
    if (!/^[A-Za-z0-9._-]+\.ckpart$/.test(e.file)) throw new Error(`allowlist: ${id} has an unexpected file name ${e.file}`);
  }
  const kept = index.filter((e) => seen.has(e.id));
  const dropped = index.filter((e) => !seen.has(e.id)).map((e) => ({ id: e.id, reason: HARD_DENY.find((d) => d.test(e))?.why ?? 'not on the allowlist' }));
  return { kept, dropped };
}

/** Words in an id, title or file name that suggest a private or personal design: such samples are left off the allowlist until the owner decides. */
export const SUSPECT = /matx|\bcase\b|_case|-case|dash|speedboat|hair|dryer|customer|internal|company|client|\bmy\b/i;

/** The entries whose id, title or file name match SUSPECT. */
export function suspectSamples(index) {
  return index.filter((e) => SUSPECT.test(`${e.id} ${e.title} ${e.file}`));
}
