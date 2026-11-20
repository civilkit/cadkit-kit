/** Pure rules of the definition badge's popover: how many free parts show, when the constraint list starts folded, and where the panel sits. */

/** The free parts listed before "Show all". */
export const FREE_VISIBLE = 5;
/** More free parts than this and the Constraints section starts folded (the free list is what matters then). */
export const FREE_FOLD_ABOVE = 3;
/** At or below this window width the popover is a full-width sheet under the ribbon. */
export const SHEET_MAX_WIDTH = 520;

export const freeVisibleCount = (total: number, expanded: boolean): number => (expanded ? total : Math.min(total, FREE_VISIBLE));
export const constraintsStartFolded = (freeCount: number): boolean => freeCount > FREE_FOLD_ABOVE;

export interface PopoverLayout { top: number; right: number; left: number | null; maxWidth: number; maxHeight: number; sheet: boolean }

/** Fixed placement under the badge (`anchorBottom` = its bottom edge): right-aligned to the window with an 8 px margin, never wider than the
 *  window less 16 px, as tall as the space below it less 16 px; a full-width sheet on a narrow window. */
export function popoverLayout(anchorBottom: number, winW: number, winH: number): PopoverLayout {
  const top = Math.round(anchorBottom + 6);
  const sheet = winW <= SHEET_MAX_WIDTH;
  return { top, right: 8, left: sheet ? 8 : null, maxWidth: Math.max(0, winW - 16), maxHeight: Math.max(120, Math.round(winH - top - 16)), sheet };
}
