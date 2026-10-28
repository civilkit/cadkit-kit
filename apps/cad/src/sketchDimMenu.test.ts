import { describe, expect, it } from 'vitest';
import { dimensionMenu } from './sketchDimMenu';

describe('dimension menu', () => {
  it('offers the radius/diameter switch only on those, and always driven and delete', () => {
    expect(dimensionMenu('radius', false).map((m) => m.id)).toEqual(['flip', 'driven', 'delete']);
    expect(dimensionMenu('diameter', true).map((m) => m.id)).toEqual(['flip', 'driven', 'delete']);
    expect(dimensionMenu('distance', false).map((m) => m.id)).toEqual(['driven', 'delete']);
  });
  it('names the switch for the kind it leads to', () => {
    expect(dimensionMenu('radius', false)[0].label).toMatch(/diameter/i);
    expect(dimensionMenu('diameter', false)[0].label).toMatch(/radius/i);
  });
});
