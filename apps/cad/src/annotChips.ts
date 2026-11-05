/** Chips on the sketch: the pill that carries a dimension value and the small square that carries a constraint glyph.
 *  Pure: sizes, hit areas, placement (a glyph chip never sits on a dimension value) and hit-testing, in screen pixels.
 *  `SketchAnnotations` draws them; the glyph outlines are our own 16 x 16 stroke icons. */

/** The smallest tap target on a phone or tablet, in px (the visible chip may be smaller; its hit area is not). */
export const MIN_TAP = 44;
/** The smallest hit target on a desktop pointer, in px: a 14 px chip is still easy to hit. */
export const MIN_HIT = 24;
/** The visible size of a glyph chip, in px (the glyph inside is 10 px). */
export const MARK = 14;
const DIM_H = 22, CHAR_W = 6.8, PAD_X = 16, FX_W = 16;

export interface ChipItem { id: string; kind: 'dimension' | 'mark'; text: string; x: number; y: number; fx?: boolean }
/** A rectangle by its top-left corner. */
export interface Box { x: number; y: number; w: number; h: number }

/** The size of a chip as drawn (centred on its position). A dimension grows with its text, a glyph chip is a square. */
export function chipSize(kind: 'dimension' | 'mark', text: string, fx = false): { w: number; h: number } {
  if (kind === 'mark') return { w: MARK, h: MARK };
  return { w: Math.ceil(Math.max(text.length, 1) * CHAR_W + PAD_X + (fx ? FX_W : 0)), h: DIM_H };
}
/** The area a pointer may hit: the chip, at least `MIN_TAP` square when `touch` and `MIN_HIT` otherwise. */
export function hitSize(w: number, h: number, touch: boolean): { w: number; h: number } {
  const m = touch ? MIN_TAP : MIN_HIT;
  return { w: Math.max(w, m), h: Math.max(h, m) };
}
export const chipBox = (it: ChipItem): Box => { const s = chipSize(it.kind, it.text, it.fx); return { x: it.x - s.w / 2, y: it.y - s.h / 2, w: s.w, h: s.h }; };
export const hitBox = (it: ChipItem, touch: boolean): Box => { const c = chipSize(it.kind, it.text, it.fx), s = hitSize(c.w, c.h, touch); return { x: it.x - s.w / 2, y: it.y - s.h / 2, w: s.w, h: s.h }; };
const meets = (a: Box, b: Box, gap = 0): boolean => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** Moves glyph chips off the dimension chips and off each other: each steps down, then to the right, until it is clear (at most a few tries,
 *  then it stays where it is). Dimension chips never move. Returns new items in the same order. */
export function separateMarks<T extends ChipItem>(items: T[]): T[] {
  const fixed: Box[] = items.filter((i) => i.kind === 'dimension').map(chipBox);
  const out = items.map((i) => ({ ...i }));
  const placed: Box[] = [];
  const STEP = MARK + 3;
  for (const m of out) {
    if (m.kind !== 'mark') continue;
    const x0 = m.x, y0 = m.y;
    let done = false;
    for (let ring = 0; ring < 4 && !done; ring++) {
      for (const [dx, dy] of ring === 0 ? [[0, 0]] : [[0, ring], [ring, 0], [0, -ring], [-ring, 0], [ring, ring], [-ring, ring]]) {
        m.x = x0 + dx * STEP; m.y = y0 + dy * STEP;
        const b = chipBox(m);
        if (!fixed.some((f) => meets(b, f, 2)) && !placed.some((f) => meets(b, f, 1))) { done = true; break; }
      }
    }
    if (!done) { m.x = x0; m.y = y0; }
    placed.push(chipBox(m));
  }
  return out;
}

/** Which constraint chips are drawn: `always` all of them, `hover` those of what is hovered or selected, `off` none. Setting `constraintMarkers`. */
export const MARK_MODES = ['always', 'hover', 'off'] as const;
export type MarkMode = typeof MARK_MODES[number];

export interface MarkFilter {
  mode: MarkMode;
  /** The ids under the pointer or selected (entities, plus their points: see `expandFocus`). */
  focus: ReadonlySet<string>;
  /** The chip being hovered and the chip selected: they stay. */
  hot?: string | null;
  selected?: string | null;
}
/** The chips to draw. Value chips always stay. A glyph chip stays when the solver blames its constraint (conflict / redundant: even with markers off),
 *  when it is the hovered or selected chip, and by mode: all (`always`), those touching the focus (`hover`), none (`off`).
 *  Axis locks that only close a rectangle (`axisLock`) show for the hovered or selected sides only, in any mode. */
export function visibleChips<T extends ChipItem & { refs?: string[]; blame?: string; axisLock?: boolean }>(items: T[], f: MarkFilter): T[] {
  return items.filter((i) => {
    if (i.kind !== 'mark') return true;
    if (i.blame) return true;
    if (f.mode === 'off') return false;
    if (i.id === f.hot || i.id === f.selected) return true;
    const touches = (i.refs ?? []).some((r) => f.focus.has(r));
    if (i.axisLock) return touches;
    return f.mode === 'always' || touches;
  });
}

/** The chip under a point: the later one (drawn on top) when several, glyph chips before dimension chips when equal. Null for none. */
export function hitChip(items: ChipItem[], px: number, py: number, touch: boolean): string | null {
  let best: { id: string; d: number } | null = null;
  for (let i = items.length - 1; i >= 0; i--) {
    const b = hitBox(items[i], touch);
    if (px < b.x || px > b.x + b.w || py < b.y || py > b.y + b.h) continue;
    const d = Math.hypot(px - items[i].x, py - items[i].y);
    if (!best || d < best.d) best = { id: items[i].id, d };
  }
  return best ? best.id : null;
}

/** Outlines of the constraint glyphs, 16 x 16, stroked in the chip's colour (round caps). A tiny segment with a round cap is a dot. */
export const GLYPH_PATHS: Record<string, string> = {
  coincident: 'M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11M8 8h.01',
  horizontal: 'M2 8h12M2 5v6M14 5v6',
  vertical: 'M8 2v12M5 2h6M5 14h6',
  tangent: 'M3.5 10a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M1.5 5.5h13',
  equal: 'M3 5.5h10M3 10.5h10',
  parallel: 'M6 3L3 13M12 3L9 13',
  perpendicular: 'M3 13h10M8 13V3M8 10.5h2.5V13',
  concentric: 'M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12M8 5.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
  fix: 'M4 7.5h8v6H4zM5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2',
  midpoint: 'M2 8h4M10 8h4M8 6a2 2 0 1 0 0 4a2 2 0 1 0 0-4',
  symmetric: 'M8 2v12M5.5 5L2.5 8l3 3M10.5 5l3 3-3 3',
  collinear: 'M3 12h.01M8 8h.01M13 4h.01M2 13L14 3',
  pointOnLine: 'M2 12L14 4M8 8h.01',
  pointOnCircle: 'M3.5 8a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M12.5 8h.01',
};
