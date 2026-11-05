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
  it('units are converted: lengths to mm, angles to degrees', () => {
    expect(evalExpr('2 cm')).toBe(20);
    expect(evalExpr('1.5 m')).toBe(1500);
    expect(evalExpr('1 in + 1 mm')).toBeCloseTo(26.4, 12);
    expect(evalExpr('2 ft')).toBeCloseTo(609.6, 12);
    expect(evalExpr('0.5 rad')).toBeCloseTo(28.6478897565, 9);
    expect(evalExpr('w / 2 cm', { w: 40 })).toBe(2);   // the unit belongs to the number it follows
    expect(evalExpr('in * 2', { in: 3 })).toBe(6);   // a unit word that is not after a number is a name
  });
  it('powers, constants and functions', () => {
    expect(evalExpr('2 ^ 3 ^ 2')).toBe(512);   // right to left
    expect(evalExpr('-2 ^ 2')).toBe(-4);
    expect(evalExpr('2 ^ -1')).toBe(0.5);
    expect(evalExpr('2 * pi')).toBeCloseTo(6.283185307179586, 12);
    expect(evalExpr('PI')).toBe(Math.PI);
    expect(evalExpr('sqrt(a ^ 2 + b ^ 2)', { a: 3, b: 4 })).toBe(5);
    expect(evalExpr('sin(30 deg)')).toBeCloseTo(0.5, 12);   // degrees in, degrees out
    expect(evalExpr('cos(60) * 10')).toBeCloseTo(5, 12);
    expect(evalExpr('atan2(1, 1)')).toBeCloseTo(45, 12);
    expect(evalExpr('asin(0.5)')).toBeCloseTo(30, 12);
    expect(evalExpr('max(1, 5, 3) - min(2, 4)')).toBe(3);
    expect(evalExpr('max(1,5)')).toBe(5);   // inside a function a comma separates arguments
    expect(evalExpr('hypot(3, 4) + pow(2, 3) + mod(7, 4)')).toBe(16);
    expect(evalExpr('round(2.5) + round(-2.5) + floor(1.9) + ceil(1.1) + trunc(-1.9) + abs(-1)')).toBe(3 - 3 + 1 + 2 - 1 + 1);
    expect(evalExpr('ln(exp(2)) + log10(1000)')).toBeCloseTo(5, 12);
    expect(evalExpr('max(a, 1)', { a: 7 })).toBe(7);
    expect(evalExpr('max', { max: 9 })).toBe(9);   // a parameter may be called like a function
  });
  it('hyperbolic functions and their inverses: unitless, like the part grammar', () => {
    expect(evalExpr('sinh(1)')).toBeCloseTo(1.1752011936438014, 12);
    expect(evalExpr('cosh(1)')).toBeCloseTo(1.5430806348152437, 12);
    expect(evalExpr('tanh(1)')).toBeCloseTo(0.7615941559557649, 12);
    expect(evalExpr('asinh(1)')).toBeCloseTo(0.881373587019543, 12);
    expect(evalExpr('acosh(2)')).toBeCloseTo(1.3169578969248166, 12);
    expect(evalExpr('atanh(0.5)')).toBeCloseTo(0.5493061443340549, 12);
    expect(evalExpr('acosh(1)')).toBe(0);
    expect(evalExpr('asinh(sinh(2.5)) + acosh(cosh(2.5)) + atanh(tanh(0.7))')).toBeCloseTo(5.7, 12);
    expect(evalExpr('cosh(a) ^ 2 - sinh(a) ^ 2', { a: 1 })).toBeCloseTo(1, 12);
    expect(evalExpr('sinh', { sinh: 4 })).toBe(4);   // a parameter may be called like a function
  });
  it('hyperbolic domain errors and overflow are refused', () => {
    for (const bad of ['acosh(0.5)', 'acosh(-1)', 'atanh(1)', 'atanh(-1)', 'atanh(2)', 'sinh(1000)', 'cosh(1000)', 'sinh(-1000)', 'sinh()', 'sinh(1, 2)', 'asinh(1, 2)', 'Sinh']) expect(() => evalExpr(bad), bad).toThrow(ExprError);
  });
  it('refuses what it cannot evaluate, never guesses', () => {
    for (const bad of ['', 'x', 'width', '1 +', '(1 + 2', '1 / 0', 'foo(1)', 'log(10)', 'sign(2)', 'max(', 'sqrt(1, 2)', 'atan2(1)', '2 mm mm', '3 $ 4', '1 2', '==3', '= =3', '2 ,5', '1.5,5', '3,']) expect(() => evalExpr(bad), bad).toThrow(ExprError);
    expect(() => evalExpr(NaN)).toThrow(ExprError);
    expect(() => evalExpr('toString')).toThrow(ExprError);   // not an inherited property
  });
});
