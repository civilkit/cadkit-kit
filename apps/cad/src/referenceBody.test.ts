import { describe, expect, it } from 'vitest';
import { originalCandidates, originalsToHide } from './referenceBody';

const orig = { type: 'importStep', id: 'F3', name: 'Original (STEP)', body: 'Original (STEP)', blob: 'k' };
const hist = [{ type: 'sketch', id: 'F1' }, { type: 'extrude', id: 'F2', op: 'newBody', sketch: 'F1' }];
const O = { name: 'Original (STEP)', volume: 1000 };

describe('which original solid of a converted part is hidden', () => {
  it('is hidden when the body the history rebuilds has its volume (within 0.5%)', () => {
    expect(originalsToHide({ features: [orig, ...hist] }, [O, { name: 'History', volume: 1000 }])).toEqual(['F3']);
    expect(originalsToHide({ features: [orig, ...hist] }, [O, { name: 'History', volume: 1004 }])).toEqual(['F3']);
  });
  it('stays visible when the rebuilt body is missing, empty, or another size', () => {
    const f = { features: [orig, ...hist] };
    expect(originalsToHide(f, [O])).toEqual([]);
    expect(originalsToHide(f, [O, { name: 'History', volume: 0 }])).toEqual([]);
    expect(originalsToHide(f, [O, { name: 'History', volume: 1010 }])).toEqual([]);
    expect(originalsToHide(f, [O, { name: 'History', volume: 2000 }])).toEqual([]);
    expect(originalsToHide(f, [O, { name: 'History', volume: 803 }])).toEqual([]);
  });
  it('is not a candidate when the history is suppressed or a placeholder, the part already says what is hidden, or there is no original', () => {
    const sup = { features: [orig, { type: 'sketch', id: 'F1' }, { type: 'extrude', id: 'F2', op: 'newBody', suppressed: true }, { type: 'placeholder', id: 'F4', suppressed: true }] };
    expect(originalCandidates(sup)).toEqual([]);
    expect(originalsToHide(sup, [O, { name: 'History', volume: 1000 }])).toEqual([]);
    expect(originalCandidates({ features: [orig, ...hist], view: { hiddenBodies: [] } })).toEqual([]);
    expect(originalCandidates({ features: hist })).toEqual([]);
    expect(originalCandidates({ features: [orig] })).toEqual([]);
    expect(originalCandidates({ features: [{ type: 'importStep', id: 'F3', name: 'SolidWorks body' }, ...hist] })).toEqual([]);
  });
});
