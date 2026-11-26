import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { ProblemBadge, type Problem } from './ProblemBadge';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); delete (window as { matchMedia?: unknown }).matchMedia; });
const label = { problems: (n: number) => (n === 1 ? 'This edit has a problem' : `This edit has ${n} problems`), checking: 'Checking...', close: 'Close', details: 'Details', announce: (n: number) => `${n} problems with this edit` };
const one: Problem[] = [{ id: 'a', cause: 'The fillet is wider than the face.', action: 'Use 4 mm or less.', details: 'blendOverflow (F3)' }];
const two: Problem[] = [...one, { id: 'b', cause: 'No edge is picked.', action: 'Pick an edge.' }];
const touch = () => { (window as { matchMedia?: unknown }).matchMedia = (q: string) => ({ matches: q.includes('coarse'), addEventListener() {}, removeEventListener() {} }); };

describe('ProblemBadge', () => {
  it('renders nothing visible without problems', () => {
    const { container } = render(<ProblemBadge problems={[]} label={label} />);
    expect(container.querySelector('button')).toBeNull();
  });
  it('is a real button with a label and aria-expanded; hover opens the popover and leaving closes it', () => {
    const { container, getByTestId, queryByTestId } = render(<ProblemBadge problems={one} label={label} />);
    const b = getByTestId('problem-badge');
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('aria-label')).toBe('This edit has a problem');
    expect(b.getAttribute('aria-expanded')).toBe('false');
    fireEvent.mouseEnter(container.querySelector('.fedit-problem')!);
    expect(getByTestId('problem-popover').textContent).toContain('The fillet is wider than the face.');
    expect(getByTestId('problem-popover').textContent).toContain('Use 4 mm or less.');
    expect(b.getAttribute('aria-expanded')).toBe('true');
    fireEvent.mouseLeave(container.querySelector('.fedit-problem')!);
    act(() => { vi.advanceTimersByTime(300); });
    expect(queryByTestId('problem-popover')).toBeNull();
  });
  it('the pointer can cross onto the popover and it stays (to read or scroll it); leaving that closes it', () => {
    const { container, getByTestId, queryByTestId } = render(<ProblemBadge problems={one} label={label} />);
    fireEvent.mouseEnter(container.querySelector('.fedit-problem')!);
    fireEvent.mouseLeave(container.querySelector('.fedit-problem')!);
    fireEvent.mouseEnter(getByTestId('problem-popover'));
    act(() => { vi.advanceTimersByTime(300); });
    expect(queryByTestId('problem-popover')).not.toBeNull();
    expect(getByTestId('problem-popover').parentElement!.parentElement).toBe(document.body);   // not clipped by the editor card
    fireEvent.mouseLeave(getByTestId('problem-popover'));
    act(() => { vi.advanceTimersByTime(300); });
    expect(queryByTestId('problem-popover')).toBeNull();
  });
  it('keyboard focus opens it, and Escape after a tap closes it', () => {
    const { getByTestId, queryByTestId } = render(<ProblemBadge problems={one} label={label} />);
    fireEvent.focus(getByTestId('problem-badge'));
    expect(queryByTestId('problem-popover')).not.toBeNull();
    fireEvent.blur(getByTestId('problem-badge'));
    act(() => { vi.advanceTimersByTime(300); });
    expect(queryByTestId('problem-popover')).toBeNull();
    fireEvent.click(getByTestId('problem-badge'));
    expect(queryByTestId('problem-popover')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(queryByTestId('problem-popover')).toBeNull();
  });
  it('touch: a tap opens it and it stays until Close or a tap outside; hover does nothing', () => {
    touch();
    const { container, getByTestId, queryByTestId, getByLabelText } = render(<div><ProblemBadge problems={one} label={label} /><p id="out">elsewhere</p></div>);
    fireEvent.mouseEnter(container.querySelector('.fedit-problem')!);
    expect(queryByTestId('problem-popover')).toBeNull();
    fireEvent.click(getByTestId('problem-badge'));
    expect(getByTestId('problem-popover').getAttribute('role')).toBe('dialog');
    fireEvent.mouseLeave(container.querySelector('.fedit-problem')!);
    act(() => { vi.advanceTimersByTime(300); });
    expect(queryByTestId('problem-popover')).not.toBeNull();   // it stays
    fireEvent.click(getByLabelText('Close'));
    expect(queryByTestId('problem-popover')).toBeNull();
    fireEvent.click(getByTestId('problem-badge'));
    fireEvent(container.querySelector('#out')!, new Event('pointerdown', { bubbles: true }));   // jsdom has no PointerEvent
    expect(queryByTestId('problem-popover')).toBeNull();
  });
  it('two simultaneous problems show a count of 2 and both causes', () => {
    const { getByTestId, container } = render(<ProblemBadge problems={two} label={label} />);
    expect(getByTestId('problem-count').textContent).toBe('2');
    expect(getByTestId('problem-badge').getAttribute('aria-label')).toBe('This edit has 2 problems');
    fireEvent.mouseEnter(container.querySelector('.fedit-problem')!);
    expect(document.querySelectorAll('[data-problem]').length).toBe(2);
    expect(document.querySelector('details')!.hasAttribute('open')).toBe(false);   // Details collapsed
  });
  it('while checking the icon says so instead of the last answer, and a newer answer replaces an older one', () => {
    const { getByTestId, rerender, container } = render(<ProblemBadge problems={one} label={label} />);
    rerender(<ProblemBadge problems={one} checking label={label} />);
    expect(getByTestId('problem-badge').getAttribute('aria-label')).toBe('Checking...');
    fireEvent.mouseEnter(container.querySelector('.fedit-problem')!);
    expect(getByTestId('problem-popover').textContent).toBe('Checking...');   // not the stale cause
    rerender(<ProblemBadge problems={[{ id: 'c', cause: 'The depth is zero.', action: 'Enter a depth.' }]} label={label} />);
    const t = getByTestId('problem-popover').textContent!;
    expect(t).toContain('The depth is zero.');
    expect(t).not.toContain('wider than the face');   // only the answer for the current inputs
  });
  it('announces the list in a polite live region and closes when the problems go away', () => {
    const { container, rerender, getByTestId, queryByTestId } = render(<ProblemBadge problems={two} label={label} />);
    expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe('2 problems with this edit');
    fireEvent.click(getByTestId('problem-badge'));
    act(() => { rerender(<ProblemBadge problems={[]} label={label} />); });
    expect(queryByTestId('problem-popover')).toBeNull();
    expect(queryByTestId('problem-badge')).toBeNull();
  });
});
