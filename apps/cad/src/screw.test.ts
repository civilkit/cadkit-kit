import { describe, expect, it } from 'vitest';
import { DEFAULT_SCREW, defaultDrive, screwIssue, screwOpts, screwOps, type ScrewParams } from './screw';

const P = (o: Partial<ScrewParams> = {}): ScrewParams => ({ ...DEFAULT_SCREW, ...o });

describe('screw wizard rules', () => {
  it('the default record is valid and makes ops', () => {
    expect(screwIssue(P())).toBeNull();
    const ops = screwOps({ features: [] }, P());
    expect(ops.length).toBeGreaterThan(3);
  });
  it('the usual drive of each head', () => {
    expect(defaultDrive('pan')).toBe('cross');
    expect(defaultDrive('button')).toBe('hex');
    expect(defaultDrive('hex')).toBe('none');
  });
  it('maps the axis choice to a vector and keeps thread off unless asked', () => {
    expect(screwOpts(P({ axis: 'px' })).axis).toEqual([1, 0, 0]);
    expect(screwOpts(P())).not.toHaveProperty('thread');
    expect(screwOpts(P({ thread: true }))).toMatchObject({ thread: true });
  });
  it('reports a bad length, a hex head with a drive and a short countersunk screw without the kernel', () => {
    expect(screwIssue(P({ length: 0 }))?.code).toBe('length');
    expect(screwIssue(P({ head: 'hex', drive: 'torx' }))?.code).toBe('hexDrive');
    expect(screwIssue(P({ head: 'countersunk', drive: 'hex', length: 1 }))?.code).toBe('countersunk');
    expect(screwIssue(P({ size: 'M9' }))?.code).toBe('size');
  });
  it('numbers the new features from the next free id', () => {
    const ops = screwOps({ features: [{ id: 'F1' }, { id: 'F7' }] }, P()) as unknown as Array<{ feature: { id: string } }>;
    expect(ops[0].feature.id).toBe('F8');
  });
});
