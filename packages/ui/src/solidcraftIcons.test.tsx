import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import attribution from './solidcraft/ATTRIBUTION.md?raw';
import licence from './solidcraft/LICENSE-MIT?raw';
import { Icon, ICON_NAMES } from './icons';
import { SOLIDCRAFT_MAP, SOLIDCRAFT_SVGS, OWN_SVGS, solidcraftArt, setIconSet, getIconSet, asIconSet, DEFAULT_ICON_SET, ICON_SETS } from './solidcraftIcons';

afterEach(() => { cleanup(); setIconSet('default'); });

describe('SolidCraft icon map', () => {
  it('maps only names that are in our icon table, to masters that are vendored', () => {
    for (const [id, ref] of Object.entries(SOLIDCRAFT_MAP)) {
      expect(ICON_NAMES, id).toContain(id);
      expect([...Object.keys(SOLIDCRAFT_SVGS), ...Object.keys(OWN_SVGS)], id + ' -> ' + ref).toContain(ref.split('@')[0]);
    }
  });
  it('vendors nothing that is unused, and lists every vendored file in ATTRIBUTION.md', () => {
    const used = new Set(Object.values(SOLIDCRAFT_MAP).map((r) => r.split('@')[0]));
    const own = [...used].filter((f) => f.startsWith('own/'));
    expect(Object.keys(OWN_SVGS).sort(), 'every own drawing is mapped').toEqual(own.sort());
    for (const f of own) expect(OWN_SVGS[f], f).not.toMatch(/#(?!(34465b|6f879c|ffffff|e2e8ef|b8c3cf|8e9faf|b9ddf8|328bd3|236ead)\b)[0-9a-fA-F]{6}/i);   // only palette colours
    expect([...Object.keys(SOLIDCRAFT_SVGS)].filter((f) => !used.has(f))).toEqual([]);
    for (const f of [...used].filter((u) => !u.startsWith('own/'))) expect(attribution, f).toContain('| svg/' + f + '.svg |');
    expect(licence).toContain('SolidCraft contributors');
  });
  it('covers a broad share of the table, the sketch tools and constraints first', () => {
    expect(Object.keys(SOLIDCRAFT_MAP).length).toBeGreaterThan(120);
    for (const id of ['line', 'rectangle', 'circle', 'dimension', 'coincident', 'tangent', 'parallel', 'equal', 'horizontal', 'fix', 'trim', 'offset']) expect(SOLIDCRAFT_MAP[id], id).toBeTruthy();
  });
  it('recolours every fixed hex of a master to a theme variable', () => {
    for (const id of Object.keys(SOLIDCRAFT_MAP)) {
      const art = solidcraftArt(id)!;
      expect(art.inner, id).not.toMatch(/#[0-9a-fA-F]{6}/);
      expect(art.inner, id).not.toMatch(/<svg|<title/);
    }
  });
  it('gives sketch tools the sketch accent and constraints the constraint accent', () => {
    expect(solidcraftArt('line')!.accent).toBe('sketch');
    expect(solidcraftArt('coincident')!.accent).toBe('constraint');
    expect(solidcraftArt('add-extrude')!.accent).toBe('solid');
    expect(solidcraftArt('move')!.accent).toBe('sketch');
    expect(solidcraftArt('add-surface-extrude')!.accent).toBe('surface');
  });
});

describe('icon set setting', () => {
  it('defaults to our own set and rejects unknown values', () => {
    expect(DEFAULT_ICON_SET).toBe('default');
    expect(getIconSet()).toBe('default');
    expect(ICON_SETS).toEqual(['default', 'solidcraft']);
    expect(asIconSet('nope')).toBe('default');
    expect(asIconSet(null)).toBe('default');
    expect(asIconSet('solidcraft')).toBe('solidcraft');
  });
  it('redraws mounted icons live: SolidCraft art on a 64 grid for mapped names, our own for the rest', () => {
    const { container } = render(<><Icon name="line" /><Icon name="triball" /></>);
    const [a, b] = Array.from(container.querySelectorAll('svg'));
    expect(a.getAttribute('viewBox')).toBe('0 0 24 24');
    act(() => setIconSet('solidcraft'));
    const [a2, b2] = Array.from(container.querySelectorAll('svg'));
    expect(a2.getAttribute('viewBox')).toBe('0 0 64 64');
    expect(a2.getAttribute('data-icon')).toBe('line');
    expect(a2.getAttribute('data-sc')).toBe('sketch');
    expect(a2.innerHTML).toContain('var(--sc-');
    expect(b2.getAttribute('viewBox')).toBe('0 0 24 24');   // triball has no master
    expect(b2.getAttribute('data-icon')).toBe('triball');
    act(() => setIconSet('default'));
    expect(container.querySelectorAll('svg')[0].getAttribute('viewBox')).toBe('0 0 24 24');
    void a; void b;
  });
});
