/**
 * One cursor policy for the viewport: given the active tool, what is under the pointer and the drag state, the CSS cursor.
 * Pure; the viewport applies the result to its container whenever the context changes.
 */
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
    case 'rotate': return 'alias';
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
