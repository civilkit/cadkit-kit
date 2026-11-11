export type Theme = 'auto' | 'light' | 'dark' | 'solarized-dark';
export const THEMES: Theme[] = ['auto', 'light', 'dark', 'solarized-dark'];

/** Apply a theme choice to the page. 'auto' follows the system setting. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
}

export const asTheme = (v: unknown): Theme => (THEMES as unknown[]).includes(v) ? (v as Theme) : 'auto';
