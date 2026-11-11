import { describe, expect, it } from 'vitest';
import { evaluate, reservedNames } from './index';

describe('reserved script names', () => {
  it('lists the API helpers', () => {
    const r = reservedNames();
    for (const n of ['part', 'plane', 'at', 'face', 'edges', 'variables']) expect(r).toContain(n);
  });
  it('explains "already declared" as a helper name, with the line and a suggestion', () => {
    const { errors } = evaluate("const P = part('X');\nconst plane = at('top', 3);\nP.sketch(plane, (s) => s.circle(5));");
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
    expect(errors[0].message).toContain("'plane' is a script API helper");
    expect(errors[0].message).toContain('rename');
  });
  it('leaves other syntax errors as they are', () => {
    const { errors } = evaluate('const = 3;');
    expect(errors[0].message).not.toContain('script API helper');
  });
});
