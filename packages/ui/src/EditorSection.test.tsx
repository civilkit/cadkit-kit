import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { EditorSection, loadCollapsed } from './EditorSection';

beforeEach(() => { cleanup(); try { localStorage.clear(); } catch { /* none */ } });

describe('EditorSection', () => {
  it('collapses on click, shows the summary while collapsed, and remembers the state per id', () => {
    const a = render(<EditorSection id="x" title="X" summary="Full · Right"><span data-testid="in">in</span></EditorSection>);
    expect(a.container.querySelector('.fedit-sec-sum')).toBeNull();
    fireEvent.click(a.container.querySelector('.fedit-sec-head')!);
    expect(a.container.querySelector('[data-testid="in"]')).toBeNull();
    expect(a.container.querySelector('.fedit-sec-sum')!.textContent).toBe('Full · Right');
    expect(loadCollapsed()).toEqual({ x: true });
    cleanup();
    const b = render(<EditorSection id="x" title="X"><span data-testid="in">in</span></EditorSection>);
    expect(b.container.querySelector('.fedit-sec')!.classList.contains('closed')).toBe(true);
    fireEvent.click(b.container.querySelector('.fedit-sec-head')!);
    expect(loadCollapsed()).toEqual({});
  });
  it('a defaultClosed section starts closed, and only a choice against the default is stored', () => {
    const a = render(<EditorSection id="d" title="D" summary="Draft 5°" defaultClosed><span data-testid="in">in</span></EditorSection>);
    expect(a.container.querySelector('[data-testid="in"]')).toBeNull();
    expect(a.container.querySelector('.fedit-sec-sum')!.textContent).toBe('Draft 5°');
    expect(loadCollapsed()).toEqual({});   // the default is not stored
    fireEvent.click(a.container.querySelector('.fedit-sec-head')!);
    expect(a.container.querySelector('[data-testid="in"]')).not.toBeNull();
    expect(loadCollapsed()).toEqual({ d: false });
    cleanup();
    const b = render(<EditorSection id="d" title="D" defaultClosed><span data-testid="in">in</span></EditorSection>);
    expect(b.container.querySelector('[data-testid="in"]')).not.toBeNull();   // the user's open choice is remembered
    fireEvent.click(b.container.querySelector('.fedit-sec-head')!);
    expect(loadCollapsed()).toEqual({});   // back to the default: nothing stored
  });
  it('works without storage', () => {
    const orig = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); }, configurable: true });
    try {
      const a = render(<EditorSection id="y" title="Y"><span data-testid="in">in</span></EditorSection>);
      fireEvent.click(a.container.querySelector('.fedit-sec-head')!);
      expect(a.container.querySelector('[data-testid="in"]')).toBeNull();
    } finally { Object.defineProperty(window, 'localStorage', orig); }
  });
});
