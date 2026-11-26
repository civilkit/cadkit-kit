import { describe, expect, it } from 'vitest';
import { diagnose, isOpenChainSketch } from './errorSummary';
import { registerCatalog } from '@kit/i18n';
import { adviceOf, reasonOf } from './diagnosticsText';
import { diagStrings } from './strings';

registerCatalog('en', diagStrings);

const L = (id: string, p1: string, p2: string) => ({ id, type: 'line', p1, p2 });
describe('isOpenChainSketch', () => {
  it('is true for one line or one chain, whatever the order of the entities', () => {
    expect(isOpenChainSketch({ entities: [L('e1', 'a', 'b')] })).toBe(true);
    expect(isOpenChainSketch({ entities: [L('e2', 'b', 'c'), L('e1', 'a', 'b'), { id: 'e3', type: 'arc', c: 'o', p1: 'c', p2: 'd' }] })).toBe(true);
    expect(isOpenChainSketch({ entities: [L('e1', 'a', 'b'), { id: 'e2', type: 'circle', c: 'o', r: 3, construction: true }] })).toBe(true);   // construction geometry does not count
  });
  it('is false for a loop, a branch, two chains, a circle or nothing', () => {
    expect(isOpenChainSketch({ entities: [L('e1', 'a', 'b'), L('e2', 'b', 'c'), L('e3', 'c', 'a')] })).toBe(false);
    expect(isOpenChainSketch({ entities: [L('e1', 'a', 'b'), L('e2', 'b', 'c'), L('e3', 'b', 'd')] })).toBe(false);
    expect(isOpenChainSketch({ entities: [L('e1', 'a', 'b'), L('e2', 'c', 'd')] })).toBe(false);
    expect(isOpenChainSketch({ entities: [{ id: 'e1', type: 'circle', c: 'o', r: 3 }] })).toBe(false);
    expect(isOpenChainSketch({ entities: [] })).toBe(false);
    expect(isOpenChainSketch(undefined)).toBe(false);
  });
});

describe('noClosedProfile on one open line', () => {
  const features = [{ id: 'F1', type: 'sketch', entities: [L('e1', 'a', 'b')] }, { id: 'F2', type: 'extrude', sketch: 'F1' }];
  it('says to use Rib or Thin wall', () => {
    const d = diagnose([{ id: 'F2', code: 'noClosedProfile' }], features);
    expect(d.roots[0].openLine).toBe(true);
    expect(reasonOf(d.roots[0])).toContain('one open line');
    expect(adviceOf(d.roots[0])).toMatch(/Rib/);
    expect(adviceOf(d.roots[0])).toMatch(/Thin wall/);
  });
  it('keeps the general text for a sketch that is not one open line', () => {
    const d = diagnose([{ id: 'F2', code: 'noClosedProfile' }], [{ id: 'F1', type: 'sketch', entities: [L('e1', 'a', 'b'), L('e2', 'b', 'c'), L('e3', 'c', 'd')].concat([L('e4', 'x', 'y')]) }, features[1]]);
    expect(d.roots[0].openLine).toBeUndefined();
    expect(adviceOf(d.roots[0])).toBe('The sketch is not a closed outline. Close the gaps, then try again.');
  });
});

describe('a reference plane that lacks an input its mode needs', () => {
  const root = (f: Record<string, unknown>, code = 'missingReference') => diagnose([{ id: 'P1', code }], [{ id: 'P1', type: 'plane', name: 'Plane 1', ...f }]).roots[0];
  const TOP = { kind: 'std', id: 'top' };
  it('names the missing axis, second plane or base instead of "a face or edge no longer exists"', () => {
    const a = root({ mode: 'angle', base: TOP, angle: 30 });
    expect(a.planeInput).toBe('axis');
    expect(reasonOf(a)).toBe('it has no axis to turn about');
    expect(adviceOf(a)).toContain('Pick the axis the plane turns about');
    expect(root({ mode: 'perpendicular', base: TOP }).planeInput).toBe('axis');
    const m = root({ mode: 'mid', base: TOP });
    expect(m.planeInput).toBe('base2');
    expect(adviceOf(m)).toContain('second plane');
    const o = root({ mode: 'offset' });
    expect(o.planeInput).toBe('base');
    expect(reasonOf(o)).toBe('it has no plane to start from');
  });
  it('keeps the old wording when every input is given (a reference that is really gone)', () => {
    const r = root({ mode: 'angle', base: TOP, axis: { kind: 'axis', axis: 'x' }, angle: 30 });
    expect(r.planeInput).toBeUndefined();
    expect(reasonOf(r)).toBe('a face or edge it uses no longer exists');
  });
  it('another feature type with a missing reference is unchanged', () => {
    const r = diagnose([{ id: 'F2', code: 'missingReference' }], [{ id: 'F2', type: 'extrude' }]).roots[0];
    expect(r.planeInput).toBeUndefined();
  });
  it('planeLineNormal says the axis lies along the base normal', () => {
    const r = root({ mode: 'perpendicular', base: TOP, axis: { kind: 'axis', axis: 'z' } }, 'planeLineNormal');
    expect(reasonOf(r)).toContain("along the base plane's normal");
    expect(adviceOf(r)).toContain('axis that lies in the base plane');
  });
});

describe('adviceOf for blendUnsupported', () => {
  const root = (params?: Record<string, unknown>) => ({ code: 'blendUnsupported', params } as never);
  it('shows the kernel hint when there is one, else the general line', () => {
    expect(adviceOf(root({ hint: 'close the profile with a short straight line or an arc' }))).toBe('Close the profile with a short straight line or an arc');
    expect(adviceOf(root())).toMatch(/Use a chamfer/);
  });
});

import { userReason } from './userError';
describe('userReason (a raw exception as a plain clause)', () => {
  it('maps known failures, keeps plain text, and hides the rest', () => {
    expect(userReason('RangeError: Array buffer allocation failed')).toMatch(/too big for the memory/);
    expect(userReason('Unexpected end of file at 1048576')).toMatch(/damaged/);
    expect(userReason('RuntimeError: unreachable')).toMatch(/something went wrong/);
    expect(userReason('')).toBe('the file could not be read');
    expect(userReason('The file has no solids.')).toBe('the file has no solids');
    expect(userReason('at foo (bar.js:12:3) TypeError: x is not a function')).toBe('the file could not be read');
    expect(userReason(new Error('Failed to fetch'))).toMatch(/connection/);
  });
});

describe('userReason classifies the error, not the file name', () => {
  it('a part named network.step or cancel.ckpart does not read as a network failure or a cancel', async () => {
    const { userReason: ur } = await import('./userError');
    expect(ur('Unexpected token } in JSON of network.ckpart')).toMatch(/damaged/);
    expect(ur('Could not read cancel.step: Unexpected end of file')).toMatch(/damaged/);
    expect(ur('Failed to fetch')).toMatch(/connection/);
  });
});

describe('plainEnough numbers', () => {
  it('machine-style numbers keep a kernel detail out of the sentence', async () => {
    const { plainEnough } = await import('./diagnosticsText');
    expect(plainEnough('the countersink (head diameter 0.0000 mm) removes the whole part')).toBe(false);
    expect(plainEnough('the offset reverses at 3 mm')).toBe(true);
  });
});
