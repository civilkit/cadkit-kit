import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { Callout, placeBeside, placeCallout } from './Callout';

afterEach(cleanup);
const view = { width: 1000, height: 700 };
const card = { width: 300, height: 120 };

describe('placeCallout', () => {
  it('rises above an anchor at the bottom, its arrow under the anchor middle', () => {
    const r = placeCallout({ left: 900, top: 680, width: 60, height: 20 }, card, view);
    expect(r.side).toBe('top');
    expect(r.top).toBe(680 - 10 - 120);
    expect(r.left).toBe(1000 - 8 - 300);   // kept inside the window
    expect(r.arrowLeft).toBe(930 - r.left);
  });
  it('drops below when there is no room above, and the other way round when asked', () => {
    expect(placeCallout({ left: 100, top: 20, width: 40, height: 20 }, card, view).side).toBe('bottom');
    expect(placeCallout({ left: 100, top: 300, width: 40, height: 20 }, card, view, 'bottom').side).toBe('bottom');
  });
});

describe('Callout', () => {
  it('shows the title, body and Done, and closes by Done, the X and Escape', () => {
    const anchor = document.createElement('a'); document.body.appendChild(anchor);
    const onClose = vi.fn(), run = vi.fn();
    const { getByText, getByLabelText } = render(<Callout anchor={anchor} title="What's new" closeLabel="Close" onClose={onClose} primary={{ label: 'Done', run }}>Body text</Callout>);
    expect(getByText('Body text')).toBeTruthy();
    fireEvent.click(getByText('Done')); expect(run).toHaveBeenCalledTimes(1);
    fireEvent.click(getByLabelText('Close')); fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    anchor.remove();
  });
  it('stays hidden while its anchor does not exist, and shows once the anchor appears', async () => {
    vi.useFakeTimers();
    const { container } = render(<Callout anchor="#late" title="x" closeLabel="Close" onClose={() => {}} />);
    expect(container.querySelector('.callout-hidden')).not.toBeNull();
    const a = document.createElement('a'); a.id = 'late'; document.body.appendChild(a);
    await vi.advanceTimersByTimeAsync(600);
    expect(container.querySelector('.callout-hidden')).toBeNull();
    expect(container.querySelector('.callout-top, .callout-bottom')).not.toBeNull();
    a.remove(); vi.useRealTimers();
  });
});

describe('placeBeside', () => {
  const card = { width: 340, height: 120 }, view = { width: 1440, height: 900 };
  it('goes to the right of the panel, level with its top, so it never covers the fields', () => {
    expect(placeBeside({ left: 290, top: 170, width: 290, height: 380 }, card, view)).toEqual({ left: 290 + 290 + 10, top: 170 });
  });
  it('goes to the left when the right has no room, and null when neither side does', () => {
    expect(placeBeside({ left: 1000, top: 170, width: 300, height: 380 }, card, view)).toEqual({ left: 1000 - 10 - 340, top: 170 });
    expect(placeBeside({ left: 8, top: 100, width: 360, height: 300 }, card, { width: 400, height: 800 })).toBeNull();
  });
  it('keeps the flyout inside the window vertically', () => {
    expect(placeBeside({ left: 290, top: 850, width: 290, height: 300 }, card, view)!.top).toBe(900 - 8 - 120);
  });
});

describe('Callout and Escape', () => {
  it('Escape closes it when nothing else has the focus, not while a text box elsewhere has it', () => {
    const anchor = document.createElement('a'); document.body.appendChild(anchor);
    const box = document.createElement('input'); document.body.appendChild(box);
    const onClose = vi.fn();
    render(<Callout anchor={anchor} title="x" closeLabel="Close" onClose={onClose} />);
    box.focus(); fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    box.blur(); fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    anchor.remove(); box.remove();
  });
});
