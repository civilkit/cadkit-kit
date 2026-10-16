// The i18n verifier as part of the normal suite: static key checks (tools/i18n_check.mjs) plus rendering the feature
// editor for every feature type and every enum value, asserting no raw identifier or unresolved key is ever visible.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { FeatureEditor, ENUMS, humanise } from '@kit/ui';
import { optionsFor } from './FeatureOptions';
import './i18n';
import { run, schemaFeatures } from '../../../tools/i18n_check.mjs';

afterEach(cleanup);

describe('i18n static checks', () => {
  it('no missing/duplicate keys, locale drift, unlabelled enums or new hardcoded strings', () => {
    const r = run();
    expect(r.errors).toEqual([]);
  });
});

describe('humanise', () => {
  it('turns identifiers into words', () => {
    expect(humanise('threePoints')).toBe('Three points');
    expect(humanise('up_to_next')).toBe('Up to next');
  });
});

type Rec = Record<string, unknown>;
const schema: Record<string, Record<string, string[]>> = schemaFeatures();
// editor enums keyed 'type.field' or 'field'
const types = new Set<string>([...Object.keys(schema), 'extrude', 'plane', 'deleteBody']);
const enumFields = (type: string): Record<string, string[]> => {
  const out: Record<string, string[]> = { ...(schema[type] ?? {}) };
  for (const [k, v] of Object.entries(ENUMS)) {
    const [a, b] = k.split('.');
    if (b !== undefined) { if (a === type) out[b] = v; }
    else if (['op', 'end'].includes(k) && ['extrude', 'revolve', 'sweep', 'loft'].includes(type)) out[k] = v;
    else if (!['op', 'end'].includes(k) && (type in schema)) out[k] ??= v;
  }
  return out;
};
const RAW_CAMEL = /^[a-z]+[A-Z][A-Za-z]*$/;
const KEY_LIKE = /^[a-z]+(\.[a-zA-Z]+){1,4}$/;

describe('feature editor shows no raw enum values or keys', () => {
  const allRaw = new Set<string>(Object.values(ENUMS).flat());
  for (const v of Object.values(schema)) for (const vals of Object.values(v)) for (const x of vals) if (!/^[A-Z]\d$/.test(x)) allRaw.add(x);
  for (const type of [...types].sort()) {
    it(type, () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const ef = enumFields(type);
      const n = Math.max(1, ...Object.values(ef).map((a) => a.length));
      for (let k = 0; k < n; k++) {
        const feature: Rec = { type, id: 'F9', name: 'X' };
        for (const [f, vals] of Object.entries(ef)) feature[f] = vals[Math.min(k, vals.length - 1)];
        const r = render(<FeatureEditor feature={feature} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} options={optionsFor} />);
        const texts: string[] = [];
        r.container.querySelectorAll('*').forEach((el) => {
          if (el.tagName === 'OPTION' || el.children.length === 0) { const s = (el.textContent ?? '').trim(); if (s && el.tagName !== 'STYLE') texts.push(s); }
        });
        for (const s of texts) {
          expect(allRaw.has(s) && !/^[A-Z]/.test(s), `raw enum value visible in ${type}: "${s}"`).toBe(false);
          expect(RAW_CAMEL.test(s), `raw identifier visible in ${type}: "${s}"`).toBe(false);
          expect(KEY_LIKE.test(s), `unresolved key visible in ${type}: "${s}"`).toBe(false);
        }
        cleanup();
      }
      const noLabel = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('missing enum label'));
      expect(noLabel).toEqual([]);
      warn.mockRestore();
    });
  }
});

describe('reference plane Mode dropdown (regression)', () => {
  it('lists localised labels, not the schema values', () => {
    const r = render(<FeatureEditor feature={{ type: 'plane', id: 'P1', mode: 'offset' }} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} options={optionsFor} />);
    const sel = r.container.querySelector('[data-path="mode"] select') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Offset', 'Angle', 'Midplane', 'Parallel', 'Three points']);
  });
});
