import { describe, it, expect, afterEach } from 'vitest';
import { DEFAULT_MASS_PREFS, loadMassPrefs, sanitizeMassPrefs, setMassPrefs } from './massPrefs';
import { massText } from './inspect/mass';

afterEach(() => setMassPrefs(DEFAULT_MASS_PREFS));
describe('mass display', () => {
  it('is automatic with five digits as before, and the stored setting is read strictly', () => {
    expect(massText(12.5)).toBe('12.5 g');
    expect(massText(1250)).toBe('1.25 kg');
    expect(massText(1234.5678)).toBe('1.2346 kg');
    expect(loadMassPrefs({ getItem: () => '{"unit":"stone","digits":9}' })).toEqual(DEFAULT_MASS_PREFS);
    expect(sanitizeMassPrefs({ unit: 'lb', digits: 3 })).toEqual({ unit: 'lb', digits: 3 });
  });
  it('shows the chosen unit and digits, converting from grams', () => {
    expect(massText(1000, { unit: 'kg', digits: 5 })).toBe('1 kg');
    expect(massText(250, { unit: 'kg', digits: 5 })).toBe('0.25 kg');
    expect(massText(4535.9237, { unit: 'lb', digits: 5 })).toBe('10 lb');
    expect(massText(28.349523125, { unit: 'oz', digits: 5 })).toBe('1 oz');
    expect(massText(1234.5678, { unit: 'g', digits: 3 })).toBe('1230 g');
  });
  it('follows the setting made through setMassPrefs, in every place that shows a mass', () => {
    setMassPrefs({ unit: 'lb', digits: 4 });
    expect(massText(453.59237)).toBe('1 lb');
  });
});
