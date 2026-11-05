import { describe, expect, it } from 'vitest';
import { completions, evalExpr, isExprValue, nameError, parseAssignment, parseFieldText, resolveVariables, valueOf } from './expr';

const ev = (s: string, v?: Record<string, number>) => { const r = evalExpr(s, v); return r.ok ? r.value : r.code; };

describe('expression evaluator (mirrors the kernel)', () => {
  it('grammar, as pinned by the kernel tests', () => {
    expect(ev('20')).toBe(20);
    expect(ev('=2^3^2')).toBe(512);
    expect(ev('=-2^2')).toBe(-4);
    expect(ev('--3')).toBe(3);
    expect(ev('abs(-4)')).toBe(4);
    expect(ev('SQRT(4)')).toBe(2);
    expect(ev('PI')).toBe(Math.PI);
    expect(ev('=cos(60)*10')).toBeCloseTo(5, 12);
    expect(ev('1cm')).toBe(10);
    expect(ev('1in')).toBe(25.4);
    expect(ev('3 m')).toBe(3000);
    expect(ev('3 mm')).toBe(3);
    expect(ev('1,5')).toBe(1.5);
    expect(ev('1e1')).toBe(10);
    expect(ev('=7)')).toBe('badExpression');
    expect(ev('=sqrt 4')).toBe('badExpression');
    expect(ev('=1e400')).toBe('badExpression');
  });
  it('variables are case sensitive and unknown names are named', () => {
    expect(ev('=w*2+3', { w: 30 })).toBe(63);
    expect(ev('=W', { w: 30 })).toEqual('unknownName');
    expect(evalExpr('=abc', {})).toEqual({ ok: false, code: 'unknownName', name: 'abc' });
  });
  it('the kernel\'s multi-argument and inverse functions', () => {
    expect(ev('=max(1,5)')).toBe(5);   // a comma separates the arguments inside the call
    expect(ev('max(1.5, 2) + 1,5')).toBe(3.5);   // and is a decimal point outside it
    expect(ev('min(3, 1, 2)')).toBe(1);
    expect(ev('mod(-7, 4)')).toBe(-3);
    expect(ev('hypot(3, 4)')).toBe(5);
    expect(ev('atan2(1, 1)')).toBeCloseTo(45, 12);
    expect(ev('asin(0.5)')).toBeCloseTo(30, 12);
    expect(ev('round(2.5) + round(-2.5) + round(2.4)')).toBe(2);   // halves away from zero
    expect(ev('exp(0) + ln(1) + log10(1000)')).toBe(4);
    expect(ev('max(sqrt(16), min(9, 7)) * 2 cm')).toBe(140);
    expect(ev('sqrt(2,25)')).toBe(1.5);   // the older functions keep the decimal comma
    for (const bad of ['max()', 'min(1,)', 'pow(2)', 'ln(0)', 'asin(2)', 'mod(1,0)', 'exp(1000)']) expect(ev(bad), bad).toBe('badExpression');
    expect(ev('Max(1,2)')).toBe('unknownName');   // lower case only
    expect(ev('max 1')).toBe('unknownName');   // a name that is not called is just a name
    expect(ev('=max*2', { max: 7 })).toBe(14);   // a variable of that name still works
    expect(ev('=max(1, 3)', { max: 7 })).toBe(3);
  });
  it('hyperbolic functions and their inverses (unitless, as in the kernel)', () => {
    expect(ev('sinh(1)')).toBeCloseTo(1.1752011936438014, 12);
    expect(ev('cosh(1)')).toBeCloseTo(1.5430806348152437, 12);
    expect(ev('tanh(1)')).toBeCloseTo(0.7615941559557649, 12);
    expect(ev('asinh(1)')).toBeCloseTo(0.881373587019543, 12);
    expect(ev('acosh(2)')).toBeCloseTo(1.3169578969248166, 12);
    expect(ev('atanh(0.5)')).toBeCloseTo(0.5493061443340549, 12);
    expect(ev('acosh(1)')).toBe(0);
    expect(ev('2 * sinh(1) + 1 cm')).toBeCloseTo(12.350402387287603, 12);
    expect(ev('=sinh*2', { sinh: 3 })).toBe(6);
    for (const bad of ['acosh(0.5)', 'acosh(-1)', 'atanh(1)', 'atanh(-1)', 'atanh(1.5)', 'sinh(1000)', 'cosh(1000)', 'sinh()', 'cosh(1,2)', 'asinh(1,2)']) expect(ev(bad), bad).toBe('badExpression');
    expect(ev('sinh 1')).toBe('unknownName');
    expect(ev('Sinh(1)')).toBe('unknownName');
  });
});

describe('variables', () => {
  it('resolve in dependency order', () => {
    const sc = resolveVariables([{ name: 'b', expr: 'a*2' }, { name: 'a', expr: '5' }]);
    expect(sc.values).toEqual({ a: 5, b: 10 });
    expect(sc.errors).toEqual({});
  });
  it('report bad names, duplicates, bad expressions and cycles per variable', () => {
    const sc = resolveVariables([
      { name: '1x', expr: '1' }, { name: 'sin', expr: '1' }, { name: 'ok', expr: '1' }, { name: 'ok', expr: '2' },
      { name: 'bad', expr: '1+' }, { name: 'c1', expr: 'c2' }, { name: 'c2', expr: 'c1+1' }, { name: 'self', expr: 'self' },
    ]);
    expect(sc.errors).toEqual({ '1x': 'badName', sin: 'badName', ok: 'duplicateName', bad: 'badExpression', c1: 'cyclicVariables', c2: 'cyclicVariables', self: 'cyclicVariables' });
    expect(sc.values).toEqual({ ok: 1 });
  });
  it('name rules', () => {
    expect(nameError('width', [])).toBeNull();
    expect(nameError('PI', [])).toBe('badName');
    expect(nameError('mm', [])).toBe('badName');
    expect(nameError('a', ['a'])).toBe('duplicateName');
  });
});

describe('field text', () => {
  it('numbers stay numbers, everything else becomes =expr', () => {
    expect(parseFieldText('12,5')).toEqual({ kind: 'number', value: 12.5 });
    expect(parseFieldText('width')).toEqual({ kind: 'expr', expr: '=width' });
    expect(parseFieldText('=w*2')).toEqual({ kind: 'expr', expr: '=w*2' });
    expect(parseFieldText(' ')).toEqual({ kind: 'empty' });
    expect(isExprValue('=1')).toBe(true);
    expect(isExprValue(1)).toBe(false);
  });
  it('valueOf evaluates against a scope', () => {
    const sc = resolveVariables([{ name: 'w', expr: '30' }]);
    expect(valueOf('=w/2', sc)).toBe(15);
    expect(valueOf(7, sc)).toBe(7);
    expect(valueOf('=q', sc)).toBeNull();
  });
  it('completes variable names, functions and pi', () => {
    const sc = resolveVariables([{ name: 'width', expr: '30' }, { name: 'wall', expr: '2' }, { name: 'depth', expr: '9' }]);
    expect(completions('=wa', sc).map((c) => c.name)).toEqual(['wall']);
    expect(completions('=2*w', sc).map((c) => c.name)).toEqual(['width', 'wall']);
    expect(completions('=', sc).map((c) => c.name)).toEqual(['width', 'wall', 'depth']);
    expect(completions('=si', sc).map((c) => c.name)).toEqual(['sin']);
    expect(completions('=p', sc).map((c) => c.name)).toEqual(['pi']);
    expect(completions('=3', sc)).toEqual([]);
  });
});

describe('parseAssignment', () => {
  it('splits name = value', () => {
    expect(parseAssignment('w = 5')).toEqual({ name: 'w', expr: '=5' });
    expect(parseAssignment(' width=h*2+1 ')).toEqual({ name: 'width', expr: '=h*2+1' });
    expect(parseAssignment('r = =4')).toEqual({ name: 'r', expr: '=4' });
  });
  it('is not a plain number, an expression, a comparison or a half-typed assignment', () => {
    for (const t of ['5', '=w*2', 'w', 'w == 5', '= 5', '2w = 3', 'w =', 'w = ']) expect(parseAssignment(t)).toBeNull();
  });
});
