import { describe, expect, it } from 'vitest';
import { registerCatalog } from '@kit/i18n';
import { adviceOf, reasonOf } from './diagnosticsText';
import { diagStrings } from './strings';

registerCatalog('en', diagStrings);

const CODES = [
  'offsetCurveCorner', 'offsetCurveFold', 'offsetCurveDirection', 'offsetCurvePlane', 'offsetCurveNoInput', 'compositeCurveNoInput', 'offsetCurveFailed', 'compositeCurveFailed',
  'projectCurveGap', 'offsetCurveGap', 'compositeCurveGap', 'projectCurveNotChain', 'offsetCurveNotChain', 'compositeCurveNotChain', 'projectCurveMisses', 'projectCurveSeveral', 'projectCurveFailed',
  'fillNotClosed', 'fillContinuity', 'fillFailed', 'fillInvalid',
  'sweepSurfaceNoInput', 'sweepSurfaceFrame', 'sweepSurfaceDegenerate', 'sweepSurfaceFold', 'sweepSurfaceCaps', 'sweepSurfaceFailed', 'sweepSurfaceGap', 'sweepSurfaceNotChain',
  'blendSurfaceNoInput', 'blendSurfaceSpan', 'blendSurfaceSides', 'blendSurfaceNoContact', 'blendSurfaceRadius', 'blendSurfaceFailed',
];

describe('curve, fill and procedural surface refusals of the kernel', () => {
  it.each(CODES)('%s has its own reason and its own advice', (code) => {
    const root = { code } as never;
    expect(diagStrings['diag.reason.' + code]).toBeTruthy();
    expect(diagStrings['diag.advice.' + code]).toBeTruthy();
    expect(reasonOf(root)).toBe(diagStrings['diag.reason.' + code]);
    expect(adviceOf(root)).toBe(diagStrings['diag.advice.' + code]);
  });
  it('the kernel\'s own detail and hint lead the reason when it gives them', () => {
    const root = { code: 'offsetCurveFold', params: { detail: 'the offset reverses at 3 mm', hint: 'use a distance below the radius' } } as never;
    expect(reasonOf(root)).toBe('the offset reverses at 3 mm; use a distance below the radius');
  });
  it('a pipe on a bad path says which case it is: the kernel\'s sweepPathInvalid message, then its hint', () => {
    const root = { code: 'sweepPathInvalid', params: { message: 'the path has 2 splines', supported: 'one spline, or lines and arcs', hint: 'use one spline or a compositeCurve' } } as never;
    expect(reasonOf(root)).toBe('the path has 2 splines; use one spline or a compositeCurve');
    expect(reasonOf({ code: 'sweepPathInvalid' } as never)).toBe(reasonOf({ code: 'sweepPathInvalid', params: {} } as never));   // no message: the plain phrase as before
  });
  it('a blend radius that does not fit says the largest radius that does', () => {
    const root = { code: 'blendSurfaceRadius', params: { radius: 12, maxRadius: 10 } } as never;
    expect(adviceOf(root)).toBe('The largest size that builds is 10 mm. ' + diagStrings['diag.advice.blendSurfaceRadius']);
  });
  it('a counterbore, countersink or cut the kernel refuses says so and passes its hint on as the advice', () => {
    const hint = 'make the counterbore narrower than the face it sits on';
    for (const code of ['holeCboreInvalid', 'holeCskDiameter', 'cutRemovedBody']) {
      expect(reasonOf({ code } as never)).toBe(diagStrings['diag.reason.' + code]);
      expect(adviceOf({ code, params: { hint } } as never)).toBe(hint);
      expect(adviceOf({ code } as never)).toBe(diagStrings['diag.advice.generic']);   // no hint: the generic line, as before
    }
  });
  it('a refused expression (a decimal comma, an unknown name) says what is accepted', () => {
    expect(reasonOf({ code: 'badExpression' } as never)).toBe('a value could not be read as a number or an expression');
    expect(adviceOf({ code: 'badExpression' } as never)).toContain('write 1.5, not 1,5');
  });
});
