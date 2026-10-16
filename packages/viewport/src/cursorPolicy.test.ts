import { describe, expect, it } from 'vitest';
import { cursorFor } from './cursorPolicy';

describe('cursor policy', () => {
  it('crosshair in drawing tools, arrow for select', () => {
    expect(cursorFor({ tool: 'draw' })).toBe('crosshair');
    expect(cursorFor({ tool: 'select' })).toBe('default');
  });
  it('pointer over a draggable point or handle, grabbing while dragging', () => {
    expect(cursorFor({ tool: 'select', hover: 'point' })).toBe('pointer');
    expect(cursorFor({ tool: 'select', hover: 'handle' })).toBe('pointer');
    expect(cursorFor({ tool: 'select', hover: 'point', drag: 'drag' })).toBe('grabbing');
  });
  it('move, resize and rotate cursors over handles', () => {
    expect(cursorFor({ tool: 'select', hover: 'move' })).toBe('move');
    expect(cursorFor({ tool: 'select', hover: 'resize-ns' })).toBe('ns-resize');
    expect(cursorFor({ tool: 'select', hover: 'resize-ew' })).toBe('ew-resize');
    expect(cursorFor({ tool: 'select', hover: 'resize-nwse' })).toBe('nwse-resize');
    expect(cursorFor({ tool: 'select', hover: 'resize-nesw' })).toBe('nesw-resize');
    expect(cursorFor({ tool: 'select', hover: 'rotate' })).toBe('alias');
  });
  it('not-allowed over a locked element, also with a drawing tool', () => {
    expect(cursorFor({ tool: 'select', hover: 'locked' })).toBe('not-allowed');
    expect(cursorFor({ tool: 'draw', invalid: true })).toBe('not-allowed');
  });
  it('zoom cursors during a zoom drag, grab hand while panning', () => {
    expect(cursorFor({ tool: 'draw', drag: 'zoom' })).toBe('zoom-in');
    expect(cursorFor({ tool: 'draw', drag: 'zoom', zoomOut: true })).toBe('zoom-out');
    expect(cursorFor({ tool: 'draw', panHeld: true })).toBe('grab');
    expect(cursorFor({ tool: 'draw', panHeld: true, drag: 'drag' })).toBe('grabbing');
    expect(cursorFor({ tool: 'draw', drag: 'pan' })).toBe('grabbing');
  });
  it('text cursor over typed-value fields beats everything but a drag', () => {
    expect(cursorFor({ tool: 'draw', overField: true })).toBe('text');
    expect(cursorFor({ tool: 'select', hover: 'text' })).toBe('text');
  });
});
