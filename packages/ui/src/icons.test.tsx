import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { sketchTools } from '@kit/sketch';
import { Icon, ICON_NAMES, hasIcon } from './icons';

afterEach(cleanup);

describe('Icon', () => {
  it('has an icon for every sketch tool and Select', () => {
    const missing = ['select', ...sketchTools().map((x) => x.id)].filter((id) => !hasIcon(id));
    expect(missing).toEqual([]);
  });
  it('renders a 24x24 stroke icon in currentColor at the requested size, aria-hidden', () => {
    const { container } = render(<Icon name="line" size={16} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('1.75');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('data-icon')).toBe('line');
    expect(svg.innerHTML).toContain('<path');
  });
  it('defaults to 20 px', () => {
    const { container } = render(<Icon name="circle" />);
    expect(container.querySelector('svg')!.getAttribute('width')).toBe('20');
  });
  it('draws a placeholder for an unknown name and never throws', () => {
    for (const name of ['nope', '', '__proto__', 'constructor', 'toString']) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector('svg')!.getAttribute('data-icon')).toBe('placeholder');
      unmount();
    }
  });
  it('uses only currentColor and the accent variable (no hard-coded colours)', () => {
    for (const n of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={n} />);
      const html = container.innerHTML;
      expect(html, n).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb\(|url\(/);
      expect(html.match(/var\((--[a-z-]+)/g) ?? [], n).toSatisfy((v: string[]) => v.every((x) => x === 'var(--accent'));
      unmount();
    }
  });
  it('every icon draws something and names are unique', () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
    for (const n of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={n} />);
      expect(container.querySelector('svg')!.children.length, n).toBeGreaterThan(0);
      unmount();
    }
  });
});
