import { describe, expect, it } from 'vitest';
import { registerCatalog } from '@kit/i18n';
import { adviceOf, reasonOf } from './diagnosticsText';
import { diagStrings } from './strings';

registerCatalog('en', diagStrings);

describe('blendResultInvalid (the kernel refused a rounding whose result is wrong at a corner)', () => {
  const root = { code: 'blendResultInvalid', params: { check: 'extent' } } as never;
  it('has its own reason, not the generic one', () => {
    expect(reasonOf(root)).toBe('the fillet comes out wrong at a corner');
  });
  it('tells the user what to try', () => {
    const a = adviceOf(root);
    expect(a).toMatch(/smaller radius/);
    expect(a).toMatch(/sketch corner/);
  });
});

describe('blendRoundsCross (a warning: the two roundings cross in a sharp edge)', () => {
  const root = { code: 'blendRoundsCross', params: { meetRadius: 2 } } as never;
  it('has its own reason and advice', () => {
    expect(reasonOf(root)).toMatch(/wider than the face between them/);
    expect(adviceOf(root)).toMatch(/add up to the face width/);
  });
});
