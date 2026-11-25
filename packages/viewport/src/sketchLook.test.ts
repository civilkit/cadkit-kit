import { describe, expect, it } from 'vitest';
import { CONSTRUCTION_DARK, CONSTRUCTION_LIGHT, CONSTRUCTION_PX, SOLID_COLOUR, SOLID_PX, constructionColour } from './sketchLook';

/** WCAG relative luminance of a 0xRRGGBB colour. */
const lum = (c: number): number => {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f((c >> 16) & 255) + 0.7152 * f((c >> 8) & 255) + 0.0722 * f(c & 255);
};
const contrast = (a: number, b: number): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('sketch line look', () => {
  it('construction lines have a hue of their own and are as heavy as the solid lines', () => {
    expect(constructionColour(false)).not.toBe(SOLID_COLOUR);
    expect(constructionColour(true)).not.toBe(SOLID_COLOUR);
    expect(CONSTRUCTION_PX).toBe(SOLID_PX);
  });
  it('they stand out from the light (0xe2e8ef) and the dark (0x14181d) background by at least 3:1', () => {
    expect(contrast(CONSTRUCTION_LIGHT, 0xe2e8ef)).toBeGreaterThanOrEqual(3);
    expect(contrast(CONSTRUCTION_DARK, 0x14181d)).toBeGreaterThanOrEqual(3);
  });
});
