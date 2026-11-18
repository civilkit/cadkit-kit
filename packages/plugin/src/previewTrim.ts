// A live preview does not need every small detail: an engraved label costs the kernel about 3 s a board, a row of shelf-pin holes about 0.15 s a hole, and neither
// changes what the user is placing. `trimForPreview` takes the script a plugin generated and leaves out those cuts, found by the shape of the statement, so no plugin
// has to declare anything (ParamDef.previewOff still does it for a switch the author knows about). Add always builds the full script.
//
// Only a statement that is one plain `p.sketch(...)....cut(...)` line is ever dropped, never one that names a body of its own (`newBody`), is kept in a handle
// (`H[...] =`) or shares its line with another statement; a script this does not understand is returned as it came. A later statement that names a dropped cut makes
// the script fail to run: the caller then runs the full script (see pluginOps).

export interface TrimmedScript {
  script: string;
  /** what was left out, by kind, with how many statements */
  skipped: Array<{ what: 'engraved text' | 'repeated holes'; count: number }>;
}

/** a group of this many identical cuts into one body is a row of holes, not a feature of the part (a door has two or three hinge cups) */
export const REPEAT_MIN = 8;

const cutLine = (l: string): boolean => {
  const t = l.trim();
  if (!t.startsWith('p.sketch(') || !t.endsWith(';') || !/\)\.cut\(/.test(t)) return false;
  if (/\bnewBody\b|\bH\[[^\]]*\]\s*=/.test(t)) return false;
  return !t.slice(0, -1).includes(';');   // one statement on the line
};
const isText = (l: string): boolean => /\bs\.text\(/.test(l);
/** the kind of profile and where it is cut, without its position: the same key means the same hole at another place */
const repeatKey = (l: string): string | null => {
  const sk = /^\s*p\.sketch\(\s*(at\([^)]*\))\s*,\s*\(s\)\s*=>\s*s\.(circle|rect)\(([^[\]]*?)\s*\[[^\]]*\]\s*\)\s*\)\.cut\(\s*([-\d.]+)\s*,\s*\{([^}]*)\}\s*\)\s*;\s*$/.exec(l);
  if (!sk) return null;
  const from = /from:\s*(\[[^\]]*\])/.exec(sk[5])?.[1];
  return from ? [sk[1], sk[2], sk[3].replace(/\s+/g, ''), sk[4], from].join('|') : null;
};

export function trimForPreview(script: string, minRepeat = REPEAT_MIN): TrimmedScript {
  const lines = script.split('\n');
  const drop = new Set<number>();
  let texts = 0;
  const groups = new Map<string, number[]>();
  lines.forEach((l, i) => {
    if (!cutLine(l)) return;
    if (isText(l)) {
      drop.add(i); texts++;
      // the plane the text was cut on, when it was made for it one line above
      if (/\bat\(\s*p\.handle\(\)\s*\)/.test(l) && i > 0 && /^\s*p\.workplane\(.*\);\s*$/.test(lines[i - 1]) && !/\bH\[[^\]]*\]\s*=/.test(lines[i - 1])) drop.add(i - 1);
      return;
    }
    const k = repeatKey(l);
    if (k) groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  let holes = 0;
  for (const idx of groups.values()) if (idx.length >= minRepeat) { for (const i of idx) drop.add(i); holes += idx.length; }
  if (!drop.size) return { script, skipped: [] };
  return {
    script: lines.filter((_, i) => !drop.has(i)).join('\n'),
    skipped: [...(texts ? [{ what: 'engraved text' as const, count: texts }] : []), ...(holes ? [{ what: 'repeated holes' as const, count: holes }] : [])],
  };
}
