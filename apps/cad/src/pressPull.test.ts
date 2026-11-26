import { describe, expect, it } from 'vitest';
import {
  PRESS_CONTINUES, TAPER_DEFAULTS, hasOptions, managedPaths, patchContinue, patchTaperAngle, patchTaperScale, patchTaperType, pressContinueEnabled, pressContinueOf, pressHasContinue,
  scaleTaperAngle, taperAngleOf, taperScaleOf, taperTypeOf,
} from './optionRules';
import { optionsFor } from './FeatureOptions';
import { editorFixes } from './editorFixes';
import { diagnose } from './errorSummary';
import { adviceOf, reasonOf, summaryLine } from './diagnosticsText';
import { opsFromDraftFor } from './pressPullDraft';
import './i18n';

const move = { type: 'moveFace', id: 'F5', faces: ['F2.C1'], mode: 'offset', distance: 4 };
const press = { type: 'pressPull', id: 'F5', faces: ['F2.C1'], continue: 'straight', distance: 4 };

describe('Press Pull: Continue', () => {
  it('offers Offset, Straight and Along the walls, and Along cannot be chosen yet', () => {
    expect(PRESS_CONTINUES).toEqual(['offset', 'straight', 'along']);
    expect(PRESS_CONTINUES.filter((c) => !pressContinueEnabled(c))).toEqual(['along']);
    expect(patchContinue(move, 'along')).toBeNull();
  });
  it('a moveFace is Offset and a pressPull is Straight (a translate move has no Continue choice)', () => {
    expect(pressContinueOf(move)).toBe('offset');
    expect(pressContinueOf(press)).toBe('straight');
    expect(pressContinueOf({ ...press, continue: 'along' })).toBe('along');
    expect(pressHasContinue(move)).toBe(true);
    expect(pressHasContinue({ ...move, mode: 'translate' })).toBe(false);
    expect(pressHasContinue({ type: 'extrude' })).toBe(false);
  });
  it('Offset -> Straight converts to pressPull and keeps the faces and the distance', () => {
    expect(patchContinue(move, 'straight')).toEqual({ type: 'pressPull', continue: 'straight', mode: null, translate: null, flip: null, distance: 4, taper: null });
    expect(patchContinue({ ...move, flip: true }, 'straight')).toMatchObject({ distance: -4 });
    expect(patchContinue({ ...move, distance: '=W/2' }, 'straight')).toMatchObject({ distance: '=W/2' });
    expect(patchContinue({ ...move, distance: '=W/2', flip: true }, 'straight')).toMatchObject({ distance: '=-(W/2)' });
    expect(patchContinue(press, 'straight')).toBeNull();
  });
  it('Straight -> Offset converts to moveFace in offset mode and drops the taper', () => {
    expect(patchContinue({ ...press, taper: { type: 'scale', endScale: 2 } }, 'offset')).toEqual({ type: 'moveFace', mode: 'offset', continue: null, taper: null, distance: 4 });
    expect(patchContinue(move, 'offset')).toBeNull();
  });
  it('the converted feature is replaced whole in the document (type and fields), faces kept', () => {
    const ops = opsFromDraftFor(move, 'F5', patchContinue(move, 'straight')!);
    expect(ops).toEqual([{ op: 'replace', id: 'F5', feature: { type: 'pressPull', id: 'F5', faces: ['F2.C1'], continue: 'straight', distance: 4 } }]);
    const back = opsFromDraftFor(press, 'F5', patchContinue(press, 'offset')!);
    expect(back).toEqual([{ op: 'replace', id: 'F5', feature: { type: 'moveFace', id: 'F5', faces: ['F2.C1'], mode: 'offset', distance: 4 } }]);
  });
  it('the forms: Offset keeps the generic fields, Straight owns distance and taper', () => {
    expect(hasOptions('moveFace')).toBe(true);
    expect([...managedPaths('moveFace')].sort()).toEqual(['continue', 'taper']);
    expect(managedPaths('pressPull').has('distance')).toBe(true);
    expect(managedPaths('pressPull').has('taper')).toBe(true);
    expect(managedPaths('moveFace').has('distance')).toBe(false);
    const off = optionsFor({ eff: move, change() {} });
    expect(off?.hide.has('distance')).toBe(false);
    expect(optionsFor({ eff: press, change() {} })?.hide.has('distance')).toBe(true);
    expect(optionsFor({ eff: { ...move, mode: 'translate', translate: [1, 0, 0] }, change() {} })).toBeNull();   // a translate move is the ball's: no Continue choice
  });
});

describe('Press Pull: taper', () => {
  it('reads the type, angle and end scale of a feature', () => {
    expect(taperTypeOf(press)).toBe('none');
    expect(taperTypeOf({ ...press, taper: { type: 'draft', angle: -3 } })).toBe('draft');
    expect(taperAngleOf({ ...press, taper: { type: 'draft', angle: -3 } })).toBe(-3);
    expect(taperAngleOf(press)).toBe(0);
    expect(taperTypeOf({ ...press, taper: { type: 'scale', endScale: 1.1 } })).toBe('scale');
    expect(taperScaleOf({ ...press, taper: { type: 'scale', endScale: 1.1 } })).toBe(1.1);
    expect(taperScaleOf({ ...press, taper: { type: 'scale', endScale: '=S' } })).toBe('=S');
    expect(taperScaleOf(press)).toBe(1);
  });
  it('choosing the type starts from a default, keeps an earlier value and None removes it', () => {
    expect(patchTaperType(press, 'none')).toEqual({ taper: null });
    expect(patchTaperType(press, 'draft')).toEqual({ taper: { type: 'draft', angle: TAPER_DEFAULTS.draft } });
    expect(patchTaperType(press, 'scale')).toEqual({ taper: { type: 'scale', endScale: TAPER_DEFAULTS.scale } });
    expect(patchTaperType({ ...press, taper: { type: 'draft', angle: -3 } }, 'draft')).toEqual({ taper: { type: 'draft', angle: -3 } });
    expect(patchTaperType({ ...press, taper: { type: 'draft', angle: -3 } }, 'scale')).toEqual({ taper: { type: 'scale', endScale: TAPER_DEFAULTS.scale } });
  });
  it('typing the angle or the scale writes the taper object; the neutral values remove it', () => {
    expect(patchTaperAngle(-3)).toEqual({ taper: { type: 'draft', angle: -3 } });
    expect(patchTaperAngle(0)).toEqual({ taper: null });
    expect(patchTaperAngle('=A')).toEqual({ taper: { type: 'draft', angle: '=A' } });
    expect(patchTaperScale(1.1)).toEqual({ taper: { type: 'scale', endScale: 1.1 } });
    expect(patchTaperScale(1)).toEqual({ taper: null });
  });
  it('the scale readout is atan(reach * (endScale - 1) / distance) in degrees', () => {
    expect(scaleTaperAngle(20, 1.5, 10)).toBeCloseTo((Math.atan(20 * 0.5 / 10) * 180) / Math.PI, 9);
    expect(scaleTaperAngle(10, 1.1, 10)).toBeCloseTo(5.71, 2);
    expect(scaleTaperAngle(10, 0.9, 10)).toBeCloseTo(-5.71, 2);
    expect(scaleTaperAngle(10, 1.1, -10)).toBeCloseTo(5.71, 2);   // a cut: the outline still grows along the run, the sign follows the draft's
    expect(scaleTaperAngle(10, 1, 10)).toBe(0);
  });
  it('has no readout without a usable reach, scale or distance', () => {
    expect(scaleTaperAngle(undefined, 1.1, 10)).toBeNull();
    expect(scaleTaperAngle(10, '=S', 10)).toBeNull();
    expect(scaleTaperAngle(10, 1.1, 0)).toBeNull();
    expect(scaleTaperAngle(0, 1.1, 10)).toBeNull();
    expect(scaleTaperAngle(10, 0, 10)).toBeNull();
  });
});

describe('Press Pull: refusals read as sentences', () => {
  const feats = [{ id: 'F5', type: 'pressPull' }];
  const say = (code: string, params?: Record<string, unknown>) => { const d = diagnose([{ id: 'F5', code, params }], feats); return { reason: reasonOf(d.roots[0]), advice: adviceOf(d.roots[0]), line: summaryLine(d) }; };
  it('invalidValue keeps API words out of the sentence', () => {
    const l = say('invalidValue', { field: 'taper.endScale', detail: 'endScale 0 is not above 0', hint: 'use an endScale above 0' }).line;
    expect(l).toMatch(/^Change not applied\./);
    expect(l).not.toMatch(/endScale/);   // API words stay in Details
  });
  it('pressPullUnsupported shows the kernel detail, or says Straight needs a flat face', () => {
    expect(say('pressPullUnsupported', { detail: 'F2.C1 is a cylinder, not flat' }).reason).toBe('the picked face is a cylinder, not flat');   // the id becomes words, the finding stays
    expect(say('pressPullUnsupported').reason).toMatch(/cannot continue this face/);
    expect(say('pressPullUnsupported').advice).toMatch(/flat faces/);
  });
  it('draftTooLarge with maxHeight says where the taper closes and the longest run', () => {
    const r = say('draftTooLarge', { maxHeight: 12.4567 });
    expect(r.reason).toBe('the taper closes to a point after 12.46 mm');
    expect(r.advice).toBe('Make the run 12.46 mm or shorter, or use a smaller taper.');
    expect(r.line).toMatch(/12\.46 mm/);
  });
  it('draftTooLarge with maxSize (degrees) gives the largest angle', () => {
    const r = say('draftTooLarge', { maxSize: { param: 'draft', value: 44.5, unit: 'deg' } });
    expect(r.reason).toBe('the taper is too steep for this size');
    expect(r.advice).toMatch(/^Set the [a-z ]+ to 44\.5° or less\.$/);
  });
  it('moveFaceFailed shows the detail and the largest distance', () => {
    const r = say('moveFaceFailed', { detail: 'the cut goes through the body', maxSize: { param: 'distance', value: 9.93, unit: 'mm' } });
    expect(r.reason).toBe('the cut goes through the body');
    expect(r.advice).toMatch(/^Set the [a-z ]+ to 9\.93 mm or less\.$/);
  });
});

describe('Press Pull: one-click fixes', () => {
  it('a draft that is too steep takes the largest angle with its own sign', () => {
    const f = { type: 'pressPull', id: 'F5', distance: 10, taper: { type: 'draft', angle: -60 } };
    expect(editorFixes({ id: 'F5', code: 'draftTooLarge', params: { maxSize: { param: 'draft', value: 26.4, unit: 'deg' } } }, f).fixes)
      .toEqual([{ key: 'maxSize', label: 'Use the largest size (26.4°)', path: 'taper', value: { type: 'draft', angle: -26.4 } }]);
  });
  it('a taper that closes sets the distance to the longest run, keeping join or cut', () => {
    expect(editorFixes({ id: 'F5', code: 'draftTooLarge', params: { maxHeight: 7 } }, { type: 'pressPull', id: 'F5', distance: -12, taper: { type: 'scale', endScale: 0.1 } }).fixes)
      .toEqual([{ key: 'maxSize', label: 'Use the largest size (7 mm)', path: 'distance', value: -7 }]);
  });
  it('a distance limit works as it does for Move face', () => {
    expect(editorFixes({ id: 'F5', code: 'moveFaceFailed', params: { maxSize: { param: 'distance', value: 9.93, unit: 'mm' } } }, { type: 'pressPull', id: 'F5', distance: 12 }).fixes[0])
      .toMatchObject({ path: 'distance', value: 9.93 });
  });
});
