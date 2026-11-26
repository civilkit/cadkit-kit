import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { PanelHint, ProblemSlot, ProblemsContext } from './ProblemContext';

afterEach(cleanup);
const value = (over = {}) => ({ problems: [{ id: 'a', cause: 'The depth is zero.', action: 'Enter a depth.' }], isNeutralHint: (h: string) => h.startsWith('Pick'), ...over });

describe('ProblemSlot and PanelHint', () => {
  it('without a provider a panel keeps its own red hint and shows no icon', () => {
    const { container } = render(<div><ProblemSlot /><PanelHint hint="Something is wrong" testid="x-hint" /></div>);
    expect(container.querySelector('[data-testid="problem-badge"]')).toBeNull();
    expect(container.querySelector('[data-testid="x-hint"]')!.getAttribute('role')).toBe('alert');
  });
  it('with a provider the header gets the alert icon and the red hint is gone', () => {
    const { container } = render(<ProblemsContext.Provider value={value()}><ProblemSlot /><PanelHint hint="The depth is zero." testid="x-hint" /></ProblemsContext.Provider>);
    expect(container.querySelector('[data-testid="problem-badge"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="x-hint"]')).toBeNull();
  });
  it('guidance (a neutral hint) stays a plain note, not an alert, and no icon without problems', () => {
    const { container } = render(<ProblemsContext.Provider value={value({ problems: [] })}><ProblemSlot /><PanelHint hint="Pick an edge." testid="x-hint" /></ProblemsContext.Provider>);
    expect(container.querySelector('[data-testid="problem-badge"]')).toBeNull();
    const h = container.querySelector('[data-testid="x-hint"]')!;
    expect(h.getAttribute('role')).toBe('status');
    expect(h.className).toContain('neutral');
  });
});
