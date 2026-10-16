/**
 * One cursor policy for the viewport: given the active tool, what is under the pointer and the drag state, the CSS cursor.
 * Pure; the viewport applies the result to its container whenever the context changes.
 */
/** A circular arrow, for the rotate ring (CSS has no rotate cursor); falls back to `alias`. */
export const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"><path d="M19 12a7 7 0 1 1-2.2-5.1"/><path d="M19 3v5h-5" fill="black"/></svg>')}") 12 12, alias`;

export type CursorTool = 'select' | 'draw' | 'zoom' | 'pan' | 'pick' | 'place' | 'text';
export type HoverTarget =
  | 'none' | 'point' | 'handle' | 'move' | 'rotate' | 'locked' | 'text'
  | 'resize-ns' | 'resize-ew' | 'resize-nwse' | 'resize-nesw';
export type DragState = 'none' | 'drag' | 'pan' | 'zoom' | 'orbit';

export interface CursorContext {
  tool: CursorTool;
  hover?: HoverTarget;
  drag?: DragState;
  /** Space or the middle button is held: the view pans. */
  panHeld?: boolean;
  /** The pointer is over a typed-value field. */
  overField?: boolean;
  /** The zoom drag direction: out when the pointer moves away from zooming in. */
  zoomOut?: boolean;
  /** The action under the pointer is invalid (a locked or fixed element). */
  invalid?: boolean;
}

/** The hover target a handle of this kind stands for. */
export function handleHover(kind: string): HoverTarget {
  return kind === 'ring' ? 'rotate' : kind === 'plane' || kind === 'pad' ? 'move' : kind === 'label' ? 'text' : 'handle';
}

export function cursorFor(c: CursorContext): string {
  const drag = c.drag ?? 'none';
  if (drag === 'pan') return 'grabbing';
  if (drag === 'zoom') return c.zoomOut ? 'zoom-out' : 'zoom-in';
  if (drag === 'orbit') return 'grabbing';
  if (c.overField || c.hover === 'text') return 'text';
  if (c.panHeld) return drag === 'drag' ? 'grabbing' : 'grab';
  if (drag === 'drag') return c.hover === 'locked' || c.invalid ? 'not-allowed' : 'grabbing';
  if (c.invalid || c.hover === 'locked') return 'not-allowed';
  switch (c.hover) {
    case 'point': case 'handle': return 'pointer';
    case 'move': return 'move';
    case 'rotate': return ROTATE_CURSOR;
    case 'resize-ns': return 'ns-resize';
    case 'resize-ew': return 'ew-resize';
    case 'resize-nwse': return 'nwse-resize';
    case 'resize-nesw': return 'nesw-resize';
  }
  switch (c.tool) {
    case 'draw': case 'pick': case 'place': return 'crosshair';
    case 'zoom': return 'zoom-in';
    case 'pan': return 'grab';
    case 'text': return 'text';
    default: return 'default';
  }
}
