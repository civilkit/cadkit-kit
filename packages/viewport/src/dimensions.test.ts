import { describe, it, expect } from 'vitest';
import { buildBoxDimensions, formatLength } from './dimensions';

describe('overall size dimensions', () => {
  it('formats lengths without trailing zeros', () => {
    expect([40, 12.5, 0.25, 0.1 + 0.2, 123.456, 3.999].map(formatLength)).toEqual(['40', '12.5', '0.25', '0.3', '123', '4']);
  });
  it('draws three dimensions for a box, each with a line, two ticks and a label', () => {
    const g = buildBoxDimensions({ min: [0, 0, 0], max: [40, 25, 12.5] })!;
    expect(g.children.filter((c) => (c as { isLine?: boolean }).isLine).length).toBe(9);
    expect(g.children.filter((c) => (c as { isSprite?: boolean }).isSprite).length).toBe(3);
  });
  it('skips a flat direction and refuses an empty box', () => {
    const flat = buildBoxDimensions({ min: [0, 0, 0], max: [10, 0, 5] })!;
    expect(flat.children.filter((c) => (c as { isSprite?: boolean }).isSprite).length).toBe(2);
    expect(buildBoxDimensions({ min: [1, 1, 1], max: [1, 1, 1] })).toBeNull();
  });
});
