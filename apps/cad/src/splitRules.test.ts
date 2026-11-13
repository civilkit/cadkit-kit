import { describe, expect, it } from 'vitest';
import type { PartDoc } from '@ck/part-model';
import { defaultSplitPlane, newNames, targetChoices } from './splitRules';
import './i18n';

describe('split defaults and rules', () => {
  it('cuts across the smallest side at its middle', () => {
    expect(defaultSplitPlane({ min: [0, 0, 0], max: [40, 20, 10] })).toEqual({ plane: { kind: 'std', id: 'front' }, offset: 5 });
    expect(defaultSplitPlane({ min: [0, 0, 0], max: [40, 8, 30] })).toEqual({ plane: { kind: 'std', id: 'top' }, offset: 4 });
    expect(defaultSplitPlane({ min: [-5, 0, 0], max: [5, 20, 30] })).toEqual({ plane: { kind: 'std', id: 'right' }, offset: 0 });
    expect(defaultSplitPlane(null).plane.id).toBe('front');
  });
  it('names: typing one keeps the other; blank pair removes the field', () => {
    expect(newNames(['Base', 'Lid'], 1, ' Cover ')).toEqual(['Base', 'Cover']);
    expect(newNames(undefined, 0, 'A')).toEqual(['A', '']);
    expect(newNames(['A', ''], 0, '')).toBeNull();
  });
  it('target choices: bodies named before this feature only', () => {
    const doc = { features: [
      { id: 'F1', type: 'extrude', body: 'Case' }, { id: 'F2', type: 'split', names: ['Base', 'Lid'] }, { id: 'F3', type: 'split', names: ['X', 'Y'] },
    ] } as unknown as PartDoc;
    expect(targetChoices(doc, 'F3', undefined).map(([v]) => v)).toEqual(['', 'Case', 'Base', 'Lid']);
    expect(targetChoices(doc, 'F1', undefined)).toEqual([]);
    expect(targetChoices(doc, 'F1', { body: 'Case' }).map(([v]) => v)).toEqual(['', 'Case']);
  });
});
