// Where a hover tooltip goes so it does not sit on top of the dimension labels. The tooltip belongs beside the pointer; when that spot
// is covered by labels it moves to the nearest spot that is clear (beside, above or past the labels), and stays inside the viewport.
export interface Box { x: number; y: number; w: number; h: number }

const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * `at` is the pointer, `size` the tooltip, `avoid` the boxes to keep clear (all in the same frame), `bounds` the area it must stay in.
 * Candidates are the four corners round the pointer and, for every box in the way, the spots just past each of its sides. The one with the
 * least overlap wins; among equals, the nearest to the preferred spot (below and right of the pointer).
 */
export function placeTip(at: { x: number; y: number }, size: { w: number; h: number }, avoid: Box[], bounds: { w: number; h: number }, gap = 14): { x: number; y: number } {
  const clamp = (p: { x: number; y: number }) => ({ x: Math.max(0, Math.min(bounds.w - size.w, p.x)), y: Math.max(0, Math.min(bounds.h - size.h, p.y)) });
  const pref = clamp({ x: at.x + gap, y: at.y + gap + 2 });
  const cands = [pref, { x: at.x + gap, y: at.y - size.h - gap }, { x: at.x - size.w - gap, y: at.y + gap + 2 }, { x: at.x - size.w - gap, y: at.y - size.h - gap }];
  for (const r of avoid) {
    if (overlap({ ...pref, ...size }, r) === 0) continue;
    cands.push({ x: pref.x, y: r.y + r.h + 6 }, { x: pref.x, y: r.y - size.h - 6 }, { x: r.x + r.w + 6, y: pref.y }, { x: r.x - size.w - 6, y: pref.y });
  }
  let best = pref, bestScore = Infinity;
  for (const c0 of cands) {
    const c = clamp(c0);
    const box = { ...c, ...size };
    const score = avoid.reduce((s, r) => s + overlap(box, r), 0) * 1000 + Math.hypot(c.x - pref.x, c.y - pref.y);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}
