import { describe, expect, it } from 'vitest';
import { evaluate } from './run';

// DENIED (run.ts) shadows names such as `window`, `globalThis` and `Function` with `undefined`, but a denylist of names cannot
// stop a script reaching the global object through a value's constructor. These tests state what SHOULD hold. They are marked
// `it.fails` because today the escape works: when the sandbox in docs/proposals/script-sandbox.md lands they start passing and
// `it.fails` will report it, so switch them to plain `it`.
const probe = (expr: string): string => `const g = ${expr};\nif (g) g.__escape_probe = 'reached';\npart("P");`;
const reached = (): boolean => (globalThis as Record<string, unknown>).__escape_probe === 'reached';

describe('script sandbox: reaching the global object', () => {
  it('the denied name is shadowed (what the denylist does stop)', () => {
    const r = evaluate('const g = typeof globalThis === "undefined"; if (!g) throw new Error("visible"); part("P");');
    expect(r.errors).toEqual([]);
  });
  it.fails('(function(){}).constructor("return this")() does not give the global object', () => {
    delete (globalThis as Record<string, unknown>).__escape_probe;
    evaluate(probe('(function(){}).constructor("return this")()'));
    expect(reached()).toBe(false);
  });
  it.fails('[].constructor.constructor("return this")() does not give the global object', () => {
    delete (globalThis as Record<string, unknown>).__escape_probe;
    evaluate(probe('[].constructor.constructor("return this")()'));
    expect(reached()).toBe(false);
  });
});
