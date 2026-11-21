import { describe, expect, it } from 'vitest';
import { registerCatalog } from '@kit/i18n';
import { en } from './locales/en';
import { paramValues, warningEntries, warningText, warningTips } from './featureWarnings';
import { warningsById } from './threadData';

registerCatalog('en', en);

const feats = [
  { id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude', name: 'Box' },
  { id: 'F3', type: 'fillet', name: 'Top rounds' }, { id: 'F4', type: 'thread' }, { id: 'F5', type: 'chamfer', suppressed: true },
];
const cross = ['F3', { code: 'blendRoundsCross', params: { detail: 'the two roundings are wider than the face between them, so they cross in a sharp edge', width: 4, radii: [3, 3], meetRadius: 2 } }];
const reason = en['diag.reason.blendRoundsCross'] as string;
const advice = en['diag.advice.blendRoundsCross'] as string;

describe('meshToSolidReport', () => {
  const rep = { code: 'meshToSolidReport', hint: '24000 triangles became 23739 faces (3 analytic surfaces fitted)', featureId: 'F3' } as never;
  it('shows the kernel summary as the text and marks the row as informational', () => {
    const [e] = warningEntries({ F3: rep }, [{ id: 'F3', type: 'meshToSolid', name: 'Van' }]);
    expect(e).toMatchObject({ code: 'meshToSolidReport', text: '24000 triangles became 23739 faces (3 analytic surfaces fitted)', advice: '' });
    const tip = warningTips([e]).F3;
    expect(tip.info).toBe(true);
    expect(tip.hint).toBe('24000 triangles became 23739 faces (3 analytic surfaces fitted)');
  });
  it('a real warning on the same feature takes the info mark off', () => {
    const tips = warningTips([
      { featureId: 'F3', label: 'a', code: 'meshToSolidReport', text: 'summary', advice: '' },
      { featureId: 'F3', label: 'a', code: 'something', text: 'bad', advice: '' },
    ]);
    expect(tips.F3.info).toBeUndefined();
  });
});

describe('feature warnings', () => {
  it('a code with strings: the reason as a sentence, then the advice', () => {
    const [e] = warningEntries(warningsById([cross]), feats);
    expect(e).toEqual({ featureId: 'F3', label: 'Top rounds', code: 'blendRoundsCross', text: reason[0].toUpperCase() + reason.slice(1) + '.', advice });
  });

  it('params are put into the strings (numbers rounded, lists read "3 and 2")', () => {
    registerCatalog('en', { 'diag.reason.testMeet': 'the face is {width} wide, radii {radii}', 'diag.advice.testMeet': 'use {meetRadius} or less' });
    expect(paramValues({ width: 4.00000001, radii: [3, 2], meetRadius: 2, nested: { a: 1 } })).toEqual({ width: '4', radii: '3 and 2', meetRadius: '2' });
    expect(warningText({ code: 'testMeet', params: { width: 4, radii: [3, 2], meetRadius: 1.6 } })).toEqual({ text: 'The face is 4 wide, radii 3 and 2.', advice: 'use 1.6 or less' });
  });

  it('an unknown code: the generic line with the kernel sentence, so nothing is dropped', () => {
    const e = warningEntries(warningsById([['F2', { code: 'endRefRelinked', params: { from: 'F1.S.e2', to: 'F2.S.e3' } }]]), feats);
    expect(e).toEqual([{ featureId: 'F2', label: 'Box', code: 'endRefRelinked', text: 'This feature built with a warning: endRefRelinked', advice: '' }]);
    // the {feature, code, message} shape, the kernel's message as the advice line
    const m = warningEntries(warningsById([{ feature: 'F2', code: 'mystery', message: 'something odd happened' }]), feats);
    expect(m.map((x) => [x.text, x.advice])).toEqual([['This feature built with a warning: mystery', 'Something odd happened.']]);
  });

  it('two warnings on one feature: two entries, the tooltip lists them one per line', () => {
    const list = [cross, ['F3', { code: 'mystery', params: { detail: 'a second note' } }]];
    const entries = warningEntries(warningsById(list), feats);
    expect(entries.map((e) => e.code)).toEqual(['blendRoundsCross', 'mystery']);
    const tips = warningTips(entries);
    expect(Object.keys(tips)).toEqual(['F3']);
    expect(tips.F3.code).toBe('blendRoundsCross');
    expect(tips.F3.hint.split('\n')).toEqual([`${entries[0].text} ${advice}`, 'This feature built with a warning: mystery. A second note.']);
  });

  it('thread warnings keep their own kernel text (the thread editor acts on them), no generic wrapper', () => {
    const e = warningEntries(warningsById([['F4', { code: 'threadDiameterMismatch', params: { detail: 'hole is 6.5, M6 tap drill is 5' } }]]), feats);
    expect(e.map((x) => [x.text, x.advice])).toEqual([['hole is 6.5, M6 tap drill is 5', '']]);
  });

  it('none for a suppressed feature, one after the rollback marker, or a feature that is gone', () => {
    const w = warningsById([cross, ['F5', { code: 'mystery' }], ['F9', { code: 'mystery' }]]);
    expect(warningEntries(w, feats).map((e) => e.featureId)).toEqual(['F3']);
    expect(warningEntries(w, feats, 2)).toEqual([]);
    expect(warningEntries(w, feats, 3).map((e) => e.featureId)).toEqual(['F3']);
  });

  it('an empty list clears everything', () => {
    expect(warningEntries(warningsById([]), feats)).toEqual([]);
    expect(warningTips([])).toEqual({});
  });
});
