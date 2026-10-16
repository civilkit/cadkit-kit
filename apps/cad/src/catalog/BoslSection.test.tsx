// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import '../i18n';
import { BoslSection } from './BoslSection';
import { boslCategory, boslQuery, boslSelected, boslValues, paramsOf } from './bosl/state';
import { searchEntries } from './bosl/search';
import { BOSL_ENTRIES, boslEntry, defaultParams, randomParams } from './bosl/entries';
import { catalogItem } from './shapes';

afterEach(() => { cleanup(); boslQuery.value = ''; boslCategory.value = 'all'; boslSelected.value = null; boslValues.value = {}; });

describe('parts library search', () => {
  it('finds entries through names, tags and CAD synonyms', () => {
    expect(searchEntries('pipe')[0].id).toBe('tube');
    expect(searchEntries('hexagon')[0].id).toBe('regular_prism');
    expect(searchEntries('ramp')[0].id).toBe('wedge');
    expect(searchEntries('donut')[0].id).toBe('torus');
    expect(searchEntries('printable hole')[0].id).toBe('teardrop');
    expect(searchEntries('', 'round').map((e) => e.id)).toEqual(['spheroid', 'torus']);
    expect(searchEntries('tube', 'round')).toEqual([]);
  });
});

describe('parts library parameters', () => {
  it('every entry has valid defaults, valid random sets and a script mentioning its BOSL2 module', () => {
    for (const e of BOSL_ENTRIES) {
      expect(e.check(defaultParams(e)), e.id).toBeNull();
      for (const p of randomParams(e, 5, 4)) {
        expect(e.check(p), e.id).toBeNull();
        for (const d of e.params) {
          if (d.type === 'length' || d.type === 'angle' || d.type === 'integer') { expect(Number(p[d.key])).toBeGreaterThanOrEqual(d.min!); expect(Number(p[d.key])).toBeLessThanOrEqual(d.max!); }
          if (d.type === 'choice') expect(d.choices).toContain(p[d.key]);
        }
      }
      const s = e.script(defaultParams(e), { plane: "'front'", ground: true, at: [0, 0], prefix: 'x1_' });
      expect(s).toContain(`${e.source.module}()`);
      expect(s).toContain('BSD-2-Clause');
      expect(e.scad(defaultParams(e))).toMatch(/;$/);
    }
  });
  it('randomised sets are deterministic', () => {
    const e = boslEntry('cuboid')!;
    expect(randomParams(e, 3, 4)).toEqual(randomParams(e, 3, 4));
  });
  it('linked parameters appear as variables and expr() in the script; unlinked sets use numbers only', () => {
    const e = boslEntry('cuboid')!;
    const linked = e.script({ ...defaultParams(e), rounding: 3 }, { plane: "'front'", ground: true, at: [0, 0], prefix: 'cuboid1_' });
    expect(linked).toContain('variables({ cuboid1_z: 20, cuboid1_rounding: 3, cuboid1_chamfer: 0 })');
    expect(linked).toContain("expr('cuboid1_z')");
    const plain = e.script({ ...defaultParams(e), rounding: 3 }, { plane: "'front'", ground: true, at: [0, 0], prefix: null });
    expect(plain).not.toContain('variables(');
    expect(plain).not.toContain('expr(');
  });
});

describe('BoslSection', () => {
  const props = () => ({ onItemDown: vi.fn(), onItemKey: vi.fn() });
  it('lists the entries, filters by search and category, and shows the form of the selected entry', () => {
    const p = props();
    const { container } = render(<BoslSection {...p} />);
    expect(container.querySelectorAll('.bosl-item').length).toBe(BOSL_ENTRIES.length);
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'pipe' } });
    expect(container.querySelectorAll('.bosl-item').length).toBeGreaterThan(0);
    expect(container.querySelector('.bosl-item')!.getAttribute('data-item')).toBe('bosl:tube');
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Round' }));
    expect(Array.from(container.querySelectorAll('.bosl-item')).map((b) => b.getAttribute('data-item'))).toEqual(['bosl:spheroid', 'bosl:torus']);
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    fireEvent.pointerDown(container.querySelector('[data-item="bosl:cuboid"]')!, { button: 0 });
    expect(p.onItemDown).toHaveBeenCalledTimes(1);
    expect(p.onItemDown.mock.calls[0][0].bosl.entryId).toBe('cuboid');
    expect(screen.getByTestId('bosl-form')).toBeTruthy();
  });
  it('editing a field changes the item that is placed; an invalid combination shows a message', () => {
    const p = props();
    const { container } = render(<BoslSection {...p} />);
    fireEvent.pointerDown(container.querySelector('[data-item="bosl:cuboid"]')!, { button: 0 });
    const x = container.querySelector('#bosl-cuboid-x') as HTMLInputElement;
    fireEvent.input(x, { target: { value: '55' } });
    expect(paramsOf('cuboid').x).toBe(55);
    expect(catalogItem('bosl:cuboid')!.bosl!.params.x).toBe(55);
    fireEvent.input(container.querySelector('#bosl-cuboid-rounding')!, { target: { value: '3' } });
    fireEvent.input(container.querySelector('#bosl-cuboid-chamfer')!, { target: { value: '2' } });
    expect(screen.getByRole('alert').textContent).toContain('rounding or chamfer');
    fireEvent.click(screen.getByText('Reset'));
    expect(paramsOf('cuboid').x).toBe(40);
  });
});
