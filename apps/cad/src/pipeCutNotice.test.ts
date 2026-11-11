import { describe, expect, it } from 'vitest';
import { pipeCutNotice } from './featureCreators';

const d = (o: Partial<{ added: string[]; removed: string[]; sb: number; sa: number; vb: number | null; va: number | null }>) => ({
  faces: { added: o.added ?? [], removed: o.removed ?? [] }, solids: { before: o.sb ?? 1, after: o.sa ?? 1 }, volume: { before: o.vb ?? 100, after: o.va ?? 100 },
});

describe('pipeCutNotice', () => {
  it('says so when the solid became a surface body', () => { expect(pipeCutNotice(d({ sa: 0, va: null, removed: ['F2.C0'] }))).toBe('surface'); });
  it('says so when no face and no volume changed', () => { expect(pipeCutNotice(d({}))).toBe('nothing'); });
  it('stays quiet when faces changed and the solid stays', () => { expect(pipeCutNotice(d({ added: ['F3.C0'], va: 90 }))).toBeNull(); });
  it('stays quiet without a diff', () => { expect(pipeCutNotice(undefined)).toBeNull(); });
});
