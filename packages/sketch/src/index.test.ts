import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  fromFeature, toFeature, movePoint, addConstraint, removeConstraint,
  type SketchDraft,
} from './index';

const BOLT = resolve(process.env.CK_REBUILD ?? resolve(__dirname, '../../../../kernel'), 'tools/cases/flangeBolt.ckpart');

function boltSketch(id: string): Record<string, unknown> {
  const doc = JSON.parse(readFileSync(BOLT, 'utf8')) as { features: Array<Record<string, unknown>> };
  const f = doc.features.find((x) => x.id === id);
  if (!f) throw new Error('no feature ' + id);
  return f;
}

const HEX = boltSketch('F3'); // hex head: lines + construction circle, pointOnCircle/pldist constraints
const SHANK = boltSketch('F1');
const THREAD_PROFILE = boltSketch('F12');

describe('sketch draft round trip', () => {
  it('fromFeature then toFeature gives back the bolt head sketch', () => {
    expect(toFeature(fromFeature(HEX))).toEqual(HEX);
  });

  it('round trips the simple shank sketch and the thread profile', () => {
    expect(toFeature(fromFeature(SHANK))).toEqual(SHANK);
    expect(toFeature(fromFeature(THREAD_PROFILE))).toEqual(THREAD_PROFILE);
  });

  it('preserves fields the typed model does not know (construction, extra constraints)', () => {
    const feature = {
      type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
      points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 5, y: 0 }],
      entities: [{ id: 'e1', type: 'circle', c: 'O', r: 5, construction: true }],
      constraints: [{ id: 'k1', type: 'pointOnCircle', refs: ['p1', 'e1'] }],
      seq: 9, visible: false,
    };
    expect(toFeature(fromFeature(feature))).toEqual(feature);
  });

  it('mutating a draft does not touch the source feature', () => {
    const src = structuredClone(HEX) as Record<string, unknown>;
    const draft = fromFeature(src);
    movePoint(draft, 'p1', 1, 2);
    draft.points.push({ id: 'zz', x: 0, y: 0 });
    expect(src).toEqual(HEX);
  });
});

describe('movePoint', () => {
  it('sets the point position and pins it with a temporary fix at that spot', () => {
    const draft = fromFeature(HEX);
    const next = movePoint(draft, 'p1', 3, 4);
    const p1 = next.points.find((p) => p.id === 'p1')!;
    expect(p1.x).toBe(3);
    expect(p1.y).toBe(4);
    expect(next.temp).toEqual([{ id: 'draft-fix-p1', type: 'fix', refs: ['p1'], value: [3, 4] }]);
  });

  it('toFeature drops the temporary fix; includeTemp keeps it', () => {
    const draft = movePoint(fromFeature(HEX), 'p1', 3, 4);
    const committed = toFeature(draft) as { constraints: Array<{ id: string }> };
    expect(committed.constraints.some((c) => c.id === 'draft-fix-p1')).toBe(false);
    const previewed = toFeature(draft, { includeTemp: true }) as { constraints: Array<{ id: string }> };
    expect(previewed.constraints.some((c) => c.id === 'draft-fix-p1')).toBe(true);
  });

  it('moving the same point twice replaces its fix instead of stacking', () => {
    let draft: SketchDraft = fromFeature(HEX);
    draft = movePoint(draft, 'p2', 1, 1);
    draft = movePoint(draft, 'p2', 2, 2);
    expect(draft.temp.filter((c) => c.refs?.includes('p2'))).toHaveLength(1);
    const p2 = draft.points.find((p) => p.id === 'p2')!;
    expect([p2.x, p2.y]).toEqual([2, 2]);
  });

  it('two points can be dragged at once, each with its own fix', () => {
    let draft: SketchDraft = fromFeature(HEX);
    draft = movePoint(draft, 'p1', 1, 1);
    draft = movePoint(draft, 'p3', 2, 2);
    expect(draft.temp).toHaveLength(2);
  });

  it('refuses to move a point that is not in the draft', () => {
    const draft = fromFeature(HEX);
    expect(() => movePoint(draft, 'nope', 0, 0)).toThrow(/nope/);
  });

  it('does not mutate the draft it is given', () => {
    const draft = fromFeature(HEX);
    const next = movePoint(draft, 'p1', 9, 9);
    expect(next).not.toBe(draft);
    const before = draft.points.find((p) => p.id === 'p1')!;
    expect(before.x).not.toBe(9);
  });
});

describe('constraints', () => {
  it('addConstraint appends and toFeature writes it', () => {
    const draft = fromFeature(SHANK);
    const next = addConstraint(draft, { id: 'kX', type: 'horizontal', refs: ['e1'] });
    const feature = toFeature(next) as { constraints: Array<{ id: string }> };
    expect(feature.constraints.at(-1)?.id).toBe('kX');
  });

  it('removeConstraint drops a real constraint', () => {
    const draft = fromFeature(HEX);
    const target = draft.constraints[0].id;
    const next = removeConstraint(draft, target);
    expect(next.constraints.some((c) => c.id === target)).toBe(false);
    const feature = toFeature(next) as { constraints: Array<{ id: string }> };
    expect(feature.constraints.some((c) => c.id === target)).toBe(false);
  });

  it('removeConstraint also clears a temporary fix', () => {
    const draft = movePoint(fromFeature(HEX), 'p1', 1, 1);
    const next = removeConstraint(draft, 'draft-fix-p1');
    expect(next.temp).toHaveLength(0);
  });

  it('the temporary fix serialises as a fix constraint with a point value', () => {
    const draft = movePoint(fromFeature(HEX), 'p1', 1, 1);
    const previewed = toFeature(draft, { includeTemp: true }) as { constraints: Array<{ id: string; type: string; value: number[] }> };
    const fixes = previewed.constraints.filter((c) => c.type === 'fix');
    expect(fixes).toEqual([{ id: 'draft-fix-p1', type: 'fix', refs: ['p1'], value: [1, 1] }]);
  });
});
