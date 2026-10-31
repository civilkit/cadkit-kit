import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { Sheet, BottomNav, snapHeights, settleSnap, SPLIT_FRACTION, BROWSE_FRACTION } from './Sheet';

afterEach(cleanup);

// jsdom has no PointerEvent and no onpointer* properties (see Splitter.test.tsx): a MouseEvent carrying the pointer fields, and the properties declared so Preact listens to the lowercase names
for (const n of ['onpointerdown', 'onpointermove', 'onpointerup', 'onpointercancel']) if (!(n in HTMLElement.prototype)) Object.defineProperty(HTMLElement.prototype, n, { value: null, writable: true, configurable: true });
const ptr = (type: string) => (el: Element, init: { clientY?: number; pointerId?: number; timeStamp?: number } = {}) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: init.clientY ?? 0 });
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 0 });
  Object.defineProperty(e, 'timeStamp', { value: init.timeStamp ?? 0 });
  act(() => { el.dispatchEvent(e); });
};
const pointer = { down: ptr('pointerdown'), move: ptr('pointermove'), up: ptr('pointerup'), cancel: ptr('pointercancel') };
beforeEach(() => { Object.defineProperty(window, 'innerHeight', { configurable: true, value: 808 }); });   // 800 px of room after the 8 px gap

describe('snapHeights', () => {
  it('splits the room into peek, half and full, leaving a gap at the top', () => {
    expect(snapHeights(808)).toEqual({ peek: 256, half: 440, full: 720 });
    expect(snapHeights(0)).toEqual({ peek: 0, half: 0, full: 0 });
  });
});

describe('settleSnap', () => {
  const hs = snapHeights(808);
  it('settles on the nearest snap', () => {
    expect(settleSnap(hs, 270)).toBe('peek');
    expect(settleSnap(hs, 400)).toBe('half');
    expect(settleSnap(hs, 650)).toBe('full');
  });
  it('closes when pulled well under the lowest snap', () => {
    expect(settleSnap(hs, 100)).toBe('close');
    expect(settleSnap(hs, 170)).toBe('peek');
  });
  it('a flick goes to the next snap in its direction, wherever it was let go', () => {
    expect(settleSnap(hs, 430, -1)).toBe('half');
    expect(settleSnap(hs, 450, -1)).toBe('full');
    expect(settleSnap(hs, 450, 1)).toBe('half');
    expect(settleSnap(hs, 430, 1)).toBe('peek');
    expect(settleSnap(hs, 250, 1)).toBe('close');
    expect(settleSnap(hs, 700, -1)).toBe('full');
  });
});

describe('Sheet', () => {
  const base = { title: 'Feature tree', snap: 'half' as const, onSnap: () => {}, onClose: () => {} };
  it('renders nothing while closed', () => {
    const { container } = render(<Sheet {...base} open={false}>body</Sheet>);
    expect(container.querySelector('.sheet')).toBeNull();
  });
  it('is a labelled dialog at the height of its snap, with its content', () => {
    const { container } = render(<Sheet {...base} open>tree body</Sheet>);
    const s = container.querySelector('.sheet') as HTMLElement;
    expect(s.getAttribute('role')).toBe('dialog');
    expect(s.getAttribute('aria-label')).toBe('Feature tree');
    expect(s.style.height).toBe('440px');
    expect(screen.getByText('tree body')).toBeTruthy();
  });
  it('the close button and Escape close it; a scrim only when modal, and tapping it closes', () => {
    const onClose = vi.fn();
    const { container, rerender } = render(<Sheet {...base} open onClose={onClose}>x</Sheet>);
    expect(container.querySelector('.sheet-scrim')).toBeNull();
    fireEvent.click(screen.getByLabelText('Close panel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(<Sheet {...base} open modal onClose={onClose}>x</Sheet>);
    pointer.down(screen.getByTestId('sheet-scrim'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
  it('arrow keys on the handle move between snaps and close from the lowest', () => {
    const onSnap = vi.fn(), onClose = vi.fn();
    const { rerender } = render(<Sheet {...base} open onSnap={onSnap} onClose={onClose}>x</Sheet>);
    const grip = screen.getByRole('separator');
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(onSnap).toHaveBeenLastCalledWith('full');
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(onSnap).toHaveBeenLastCalledWith('peek');
    rerender(<Sheet {...base} open snap="peek" onSnap={onSnap} onClose={onClose}>x</Sheet>);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowDown' });
    expect(onClose).toHaveBeenCalled();
  });
  const drag = (head: Element, from: number, to: number, ms = 400) => {
    pointer.down(head, { clientY: from, pointerId: 1, timeStamp: 0 });
    pointer.move(head, { clientY: (from + to) / 2, pointerId: 1, timeStamp: ms / 2 });
    pointer.move(head, { clientY: to, pointerId: 1, timeStamp: ms });
    pointer.up(head, { clientY: to, pointerId: 1, timeStamp: ms });
  };
  it('dragging the handle up settles on the next snap, and follows the finger while it moves', () => {
    const onSnap = vi.fn();
    const { container } = render(<Sheet {...base} snap="peek" open onSnap={onSnap}>x</Sheet>);
    const s = container.querySelector('.sheet') as HTMLElement;
    const head = container.querySelector('.sheet-head') as HTMLElement;
    pointer.down(head, { clientY: 500, pointerId: 1, timeStamp: 0 });
    pointer.move(head, { clientY: 380, pointerId: 1, timeStamp: 600 });
    expect(s.style.height).toBe('376px');   // 256 + 120
    pointer.up(head, { clientY: 300, pointerId: 1, timeStamp: 1200 });   // settles from where it was last moved to (376 px): nearest is half
    expect(onSnap).toHaveBeenCalledWith('half');
    expect(s.style.height).toBe('440px');
  });
  it('dragging down far enough closes it', () => {
    const onClose = vi.fn();
    const { container } = render(<Sheet {...base} snap="peek" open onClose={onClose}>x</Sheet>);
    drag(container.querySelector('.sheet-head')!, 100, 330, 1500);   // 256 - 230 = 26 px high
    expect(onClose).toHaveBeenCalled();
  });
  it('a tap on the handle, a drag from the close button and a cancelled drag change nothing', () => {
    const onSnap = vi.fn(), onClose = vi.fn();
    const { container } = render(<Sheet {...base} open onSnap={onSnap} onClose={onClose}>x</Sheet>);
    const head = container.querySelector('.sheet-head')!;
    pointer.down(head, { clientY: 100, pointerId: 1, timeStamp: 0 });
    pointer.up(head, { clientY: 101, pointerId: 1, timeStamp: 50 });
    pointer.down(screen.getByLabelText('Close panel'), { clientY: 100, pointerId: 1, timeStamp: 0 });
    pointer.up(screen.getByLabelText('Close panel'), { clientY: 400, pointerId: 1, timeStamp: 900 });
    pointer.down(head, { clientY: 100, pointerId: 1, timeStamp: 0 });
    pointer.move(head, { clientY: 400, pointerId: 1, timeStamp: 900 });
    pointer.cancel(head, { clientY: 400, pointerId: 1, timeStamp: 950 });
    expect(onSnap).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect((container.querySelector('.sheet') as HTMLElement).style.height).toBe('440px');
  });
  it('measures its snaps above the space it leaves at the bottom', () => {
    const { container } = render(<Sheet {...base} open bottom={100}>x</Sheet>);
    const s = container.querySelector('.sheet') as HTMLElement;
    expect(s.style.height).toBe('385px');   // (808 - 100 - 8) * .55
    expect(s.style.getPropertyValue('--sheet-bottom')).toBe('100px');
  });
});

describe('BottomNav', () => {
  it('one button per sheet, the open one pressed, with badges, and picking reports the id', () => {
    const onPick = vi.fn();
    render(<BottomNav onPick={onPick} items={[
      { id: 'tree', label: 'Tree', icon: <i />, pressed: true },
      { id: 'diag', label: 'Issues', icon: <i />, badge: 2, bad: true },
      { id: 'props', label: 'Properties', icon: <i />, disabled: true },
    ]} />);
    expect(screen.getByLabelText('Panels')).toBeTruthy();
    expect(screen.getByText('Tree').closest('button')!.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('2').className).toContain('bad');
    expect((screen.getByText('Properties').closest('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Issues'));
    expect(onPick).toHaveBeenCalledWith('diag');
  });
});

describe('a docked (split) sheet', () => {
  const base = { title: 'Properties', snap: 'half' as const, onSnap: () => {}, onClose: () => {}, docked: true };
  it('takes its place in the layout (class docked, no bottom offset) at a share of the screen, so the canvas can resize above it', () => {
    const { container } = render(<Sheet {...base} bottom={56} fractions={SPLIT_FRACTION} open>fields</Sheet>);
    const s = container.querySelector('.sheet') as HTMLElement;
    expect(s.classList.contains('docked')).toBe(true);
    expect(s.style.getPropertyValue('--sheet-bottom')).toBe('');
    expect(s.style.height).toBe(`${snapHeights(808, SPLIT_FRACTION).half}px`);   // 38% of the screen
  });
  it('an editing sheet never rises above 60% of the screen; a browse list may go higher', () => {
    expect(snapHeights(808, SPLIT_FRACTION).full).toBeLessThanOrEqual(Math.round(0.6 * 808));
    expect(snapHeights(808, BROWSE_FRACTION).full).toBeGreaterThan(snapHeights(808, SPLIT_FRACTION).full);
    const { container } = render(<Sheet {...base} snap="full" fractions={SPLIT_FRACTION} open>fields</Sheet>);
    expect((container.querySelector('.sheet') as HTMLElement).style.height).toBe(`${snapHeights(808, SPLIT_FRACTION).full}px`);
  });
  it('leaves the canvas alone unless modal', () => {
    const { container } = render(<Sheet {...base} open>fields</Sheet>);
    expect(container.querySelector('.sheet-scrim')).toBeNull();
  });
});
