import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { Splitter, CornerGrip, resolveDrag } from './Splitter';

afterEach(cleanup);

const ptr = (type: string) => (el: Element, init: { clientX?: number; clientY?: number; pointerId?: number; button?: number } = {}) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0, button: init.button ?? 0 });
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 0 });
  act(() => { el.dispatchEvent(e); });
};
const pointer = { down: ptr('pointerdown'), move: ptr('pointermove'), up: ptr('pointerup'), cancel: ptr('pointercancel') };
// jsdom has no PointerEvent: a MouseEvent carrying pointerId is enough. It also lacks the onpointer* properties, so Preact would
// register 'pointerDown'; declaring them makes it listen for the real lowercase event names.
for (const n of ['onpointerdown', 'onpointermove', 'onpointerup', 'onpointercancel']) if (!(n in HTMLElement.prototype)) Object.defineProperty(HTMLElement.prototype, n, { value: null, writable: true, configurable: true });

const lim = { min: 200, max: 600, collapsible: true };
describe('resolveDrag', () => {
  it('grows with the pointer for grow=1 and shrinks for grow=-1', () => {
    expect(resolveDrag(280, 50, 1, lim)).toBe(330);
    expect(resolveDrag(210, -40, -1, lim)).toBe(250);
  });
  it('clamps to min and max', () => {
    expect(resolveDrag(280, 1000, 1, lim)).toBe(600);
    expect(resolveDrag(280, -60, 1, lim)).toBe(220);
    expect(resolveDrag(280, -100, 1, { min: 200, max: 600 })).toBe(200);
  });
  it('collapses past the snap distance and opens from collapsed past half of min', () => {
    expect(resolveDrag(280, -200, 1, lim)).toBe(0);
    expect(resolveDrag(280, -120, 1, lim)).toBe(200);
    expect(resolveDrag(0, 60, 1, lim)).toBe(0);
    expect(resolveDrag(0, 150, 1, lim)).toBe(200);
    expect(resolveDrag(0, 900, 1, lim)).toBe(600);
  });
});

const setup = (over: Partial<Parameters<typeof Splitter>[0]> = {}) => {
  const onLive = vi.fn(), onCommit = vi.fn();
  render(<Splitter orientation="vertical" value={280} min={200} max={600} def={280} grow={1} collapsible onLive={onLive} onCommit={onCommit} label="Resize" {...over} />);
  return { sep: screen.getByRole('separator'), onLive, onCommit };
};

describe('Splitter', () => {
  it('is a focusable separator with orientation and value', () => {
    const { sep } = setup();
    expect(sep.getAttribute('aria-orientation')).toBe('vertical');
    expect(sep.getAttribute('aria-valuenow')).toBe('280');
    expect(sep.getAttribute('aria-valuemin')).toBe('200');
    expect(sep.getAttribute('aria-valuemax')).toBe('600');
    expect(sep.tabIndex).toBe(0);
  });
  it('drags: live updates, one commit on release, busy flag on the document', () => {
    const { sep, onLive, onCommit } = setup();
    pointer.down(sep, { clientX: 280, pointerId: 1, button: 0 });
    expect(document.documentElement.getAttribute('data-resizing')).toBe('vertical');
    pointer.move(sep, { clientX: 340, pointerId: 1 });
    expect(onLive).toHaveBeenLastCalledWith(340);
    pointer.move(sep, { clientX: 2000, pointerId: 1 });
    expect(onLive).toHaveBeenLastCalledWith(600);
    expect(onCommit).not.toHaveBeenCalled();
    pointer.up(sep, { clientX: 2000, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(600);
    expect(document.documentElement.getAttribute('data-resizing')).toBeNull();
  });
  it('dragging far below the minimum commits a collapse (0); cancel restores', () => {
    const a = setup();
    pointer.down(a.sep, { clientX: 280, pointerId: 1 });
    pointer.move(a.sep, { clientX: 20, pointerId: 1 });
    pointer.up(a.sep, { clientX: 20, pointerId: 1 });
    expect(a.onCommit).toHaveBeenCalledWith(0);
    cleanup();
    const b = setup();
    pointer.down(b.sep, { clientX: 280, pointerId: 2 });
    pointer.move(b.sep, { clientX: 330, pointerId: 2 });
    pointer.cancel(b.sep, { pointerId: 2 });
    expect(b.onCommit).not.toHaveBeenCalled();
    expect(b.onLive).toHaveBeenLastCalledWith(280);
  });
  it('dragging from a collapsed edge re-opens at the minimum or further', () => {
    const { sep, onCommit } = setup({ value: 0 });
    pointer.down(sep, { clientX: 0, pointerId: 1 });
    pointer.move(sep, { clientX: 150, pointerId: 1 });
    pointer.up(sep, { clientX: 150, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith(200);
  });
  it('a bottom drawer (grow=-1, horizontal) grows when dragged up', () => {
    const { sep, onCommit } = setup({ orientation: 'horizontal', value: 210, min: 80, max: 500, def: 210, grow: -1 });
    pointer.down(sep, { clientY: 600, pointerId: 1 });
    pointer.move(sep, { clientY: 500, pointerId: 1 });
    pointer.up(sep, { clientY: 500, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith(310);
  });
  it('arrow keys move 16px, shift 64px, Home/End jump, Enter resets, all clamped', () => {
    const { sep, onCommit } = setup({ value: 300 });
    fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenLastCalledWith(316);
    fireEvent.keyDown(sep, { key: 'ArrowLeft', shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(236);
    fireEvent.keyDown(sep, { key: 'Home' });
    expect(onCommit).toHaveBeenLastCalledWith(200);
    fireEvent.keyDown(sep, { key: 'End' });
    expect(onCommit).toHaveBeenLastCalledWith(600);
    fireEvent.keyDown(sep, { key: 'Enter' });
    expect(onCommit).toHaveBeenLastCalledWith(280);
    fireEvent.dblClick(sep);
    expect(onCommit).toHaveBeenCalledTimes(6);
  });
  it('keys never go below min or above max, and ignore the wrong axis', () => {
    const { sep, onCommit } = setup({ value: 205 });
    fireEvent.keyDown(sep, { key: 'ArrowLeft', shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(200);
    onCommit.mockClear();
    fireEvent.keyDown(sep, { key: 'ArrowUp' });
    expect(onCommit).not.toHaveBeenCalled();
  });
  it('drawer keys: ArrowUp grows a grow=-1 horizontal splitter', () => {
    const { sep, onCommit } = setup({ orientation: 'horizontal', value: 210, min: 80, max: 500, def: 210, grow: -1 });
    fireEvent.keyDown(sep, { key: 'ArrowUp' });
    expect(onCommit).toHaveBeenLastCalledWith(226);
    fireEvent.keyDown(sep, { key: 'ArrowDown', shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(146);
  });
  it('max may be a function evaluated at drag time', () => {
    const { sep, onLive } = setup({ max: () => 300 });
    pointer.down(sep, { clientX: 280, pointerId: 1 });
    pointer.move(sep, { clientX: 900, pointerId: 1 });
    expect(onLive).toHaveBeenLastCalledWith(300);
  });
});

describe('CornerGrip', () => {
  it('drags width and height together with clamps and commits once', () => {
    const onLive = vi.fn(), onCommit = vi.fn();
    render(<CornerGrip width={264} height={400} min={[200, 150]} max={() => [500, 700]} onLive={onLive} onCommit={onCommit} label="Resize panel" />);
    const g = screen.getByRole('separator');
    pointer.down(g, { clientX: 100, clientY: 100, pointerId: 1 });
    pointer.move(g, { clientX: 150, clientY: 80, pointerId: 1 });
    expect(onLive).toHaveBeenLastCalledWith(314, 380);
    pointer.move(g, { clientX: 900, clientY: 900, pointerId: 1 });
    pointer.up(g, { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith(500, 700);
  });
});
