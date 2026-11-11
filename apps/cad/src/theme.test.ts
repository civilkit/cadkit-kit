import { describe, expect, it } from 'vitest';
import { applyTheme, asTheme, THEMES } from './theme';

describe('theme', () => {
  it('knows the four choices and falls back to auto', () => {
    expect(THEMES).toEqual(['auto', 'light', 'dark', 'solarized-dark']);
    expect(asTheme('solarized-dark')).toBe('solarized-dark');
    expect(asTheme('nope')).toBe('auto');
  });
  it('applies a theme as data-theme and clears it for auto', () => {
    const root = document.createElement('div');
    applyTheme('solarized-dark', root);
    expect(root.getAttribute('data-theme')).toBe('solarized-dark');
    applyTheme('auto', root);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});
