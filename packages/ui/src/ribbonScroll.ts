/** Pure helpers for the ribbon's horizontally scrolling strip (used by Ribbon.tsx; no DOM access here, so they are easy to test). */

export interface StripMetrics { scrollLeft: number; clientWidth: number; scrollWidth: number }

/** Which edges still have content hidden beyond them. `slack` forgives sub-pixel rounding. */
export function hiddenEdges(m: StripMetrics, slack = 2): { left: boolean; right: boolean } {
  return { left: m.scrollLeft > slack, right: m.scrollLeft + m.clientWidth < m.scrollWidth - slack };
}

/** Where to scroll so that an item (given in strip content coordinates) lies fully inside the strip with `pad` to spare,
 *  or null when it already does (or cannot fit: then its left edge wins). */
export function revealScroll(m: StripMetrics, item: { left: number; width: number }, pad = 12): number | null {
  const max = Math.max(0, m.scrollWidth - m.clientWidth);
  const left = item.left - pad, right = item.left + item.width + pad;
  if (left >= m.scrollLeft && right <= m.scrollLeft + m.clientWidth) return null;
  const to = left < m.scrollLeft || right - left > m.clientWidth ? left : right - m.clientWidth;
  return Math.min(max, Math.max(0, Math.round(to)));
}

/** The scrollLeft one group further in `dir` (-1 left, 1 right). `starts` are the groups' left edges in content coordinates (ascending). Always moves at least a little,
 *  and lands on a group start, except that the last step clamps to the end. */
export function stepScroll(m: StripMetrics, starts: number[], dir: -1 | 1): number {
  const max = Math.max(0, m.scrollWidth - m.clientWidth);
  const cur = m.scrollLeft, eps = 4;
  let to = cur;
  if (dir > 0) { const next = starts.find((s) => s > cur + eps); to = next === undefined ? max : next; if (to - cur < 1 && cur < max) to = max; }
  else { const prev = [...starts].reverse().find((s) => s < cur - eps); to = prev ?? 0; }
  return Math.min(max, Math.max(0, Math.round(to)));
}
