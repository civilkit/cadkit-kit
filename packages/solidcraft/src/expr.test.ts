import { describe, expect, it } from 'vitest';
import { evalExpr, ExprError } from './expr';

describe('parameter expressions', () => {
  it('numbers, units and arithmetic', () => {
    expect(evalExpr(14)).toBe(14);
    expect(evalExpr('80 mm')).toBe(80);
    expect(evalExpr('2 * (3 + 4) - 1')).toBe(13);
    expect(evalExpr('10 / 4')).toBe(2.5);
    expect(evalExpr('-5 + +2')).toBe(-3);
    expect(evalExpr('1.5e1 mm')).toBe(15);
    expect(evalExpr('90 deg')).toBe(90);
  });
  it('named parameters', () => {
    const v = { thickness: 8, width: 80 };
    expect(evalExpr('thickness', v)).toBe(8);
    expect(evalExpr('thickness + 14 mm', v)).toBe(22);
    expect(evalExpr('width / 2 - thickness', v)).toBe(32);
  });
  it('the spellings SolidCraft accepts besides the plain one', () => {
    expect(evalExpr('=d3', { d3: 4 })).toBe(4);   // a leading = marks a formula (#4681)
    expect(evalExpr('= 2 * 3')).toBe(6);
    expect(evalExpr('w = 3 mm + 1')).toBe(4);   // a definition stands for its expression (#3638)
    expect(evalExpr('2,5 mm')).toBe(2.5);   // a decimal comma (#1347)
    expect(evalExpr(',5')).toBe(0.5);   // a leading one (#2966)
    expect(evalExpr('1 + ,25')).toBe(1.25);
    expect(evalExpr('(2,5 + 1)')).toBe(3.5);
  });
  it('refuses what it cannot evaluate, never guesses', () => {
    for (const bad of ['', 'x', 'width', '1 +', '(1 + 2', '1 / 0', '2 cm', 'foo(1)', '1 ^ 2', '3 $ 4', '1 2', '==3', '= =3', '2 ,5', '1.5,5', '3,']) expect(() => evalExpr(bad), bad).toThrow(ExprError);
    expect(() => evalExpr(NaN)).toThrow(ExprError);
    expect(() => evalExpr('toString')).toThrow(ExprError);   // not an inherited property
  });
});
