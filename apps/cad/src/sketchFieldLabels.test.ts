import { describe, expect, it } from 'vitest';
import { t } from '@kit/i18n';
import './i18n';

describe('dimension value box labels', () => {
  it('every dimension type the tool can place has a short label (no raw key shown)', () => {
    for (const k of ['distance', 'hdist', 'vdist', 'pldist', 'radius', 'diameter', 'angle', 'raddiff', 'arclength']) {
      const key = 'app.sketch.field.' + k;
      expect(t(key), key).not.toBe(key);
    }
  });
});
