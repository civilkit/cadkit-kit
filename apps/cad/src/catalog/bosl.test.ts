import { describe, expect, it } from 'vitest';
import { searchEntries } from './bosl/search';
import { BOSL_ENTRIES, boslEntry, defaultParams, randomParams } from './bosl/entries';

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
