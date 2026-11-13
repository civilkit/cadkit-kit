import { describe, expect, it } from 'vitest';
import { evaluate } from './run';

// the argument checks of split() and lipJoint(); the kernel behaviour is in enclosure.kernel.test.ts
const errs = (code: string) => evaluate(`part('P').sketch('front', (s) => s.rect(40, 20)).extrude(10)${code};`).errors.map((e) => e.message);

describe('split()', () => {
  it('accepts a plane with names', () => {
    expect(errs(".split(at('front', 5), { names: ['A', 'B'] })")).toEqual([]);
    expect(errs(".split('front', { keep: 'below' })")).toEqual([]);
  });
  it('needs a plane', () => {
    expect(errs('.split()')[0]).toMatch(/give the plane/);
  });
  it('refuses a bad keep, equal names or a name list of the wrong size', () => {
    expect(errs(".split('front', { keep: 'middle' })")[0]).toMatch(/keep is/);
    expect(errs(".split('front', { names: ['A', 'A'] })")[0]).toMatch(/two different names/);
    expect(errs(".split('front', { names: ['A'] })")[0]).toMatch(/two different names/);
    expect(errs(".split('front', { target: '' })")[0]).toMatch(/target is the name/);
  });
});

describe('lipJoint()', () => {
  it('accepts the documented options', () => {
    expect(errs(".lipJoint(at('front', 5), { height: 1.5, width: 1, clearance: 0.2, inset: 0.5, tongue: 'above', names: ['Base', 'Lid'] })")).toEqual([]);
  });
  it('needs a height and a known tongue side', () => {
    expect(errs(".lipJoint(at('front', 5), {})")[0]).toMatch(/height/);
    expect(errs(".lipJoint(at('front', 5), { height: 1, tongue: 'left' })")[0]).toMatch(/tongue is/);
  });
});
