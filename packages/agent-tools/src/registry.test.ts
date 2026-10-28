import { describe, expect, it } from 'vitest';
import { PartBuilder, SketchBuilder, makeApi } from '@kit/script';
import { defaultRegistry } from './registry';

// TypeScript `private` members are visible at run time; these are plumbing of the recorder, not script API.
const INTERNAL = new Set(['constructor', 'pt', 'ent', 'apt', 'arcIds', 'decorate', 'add', 'solid', 'holePoints', 'readStep', 'expectStep']);
const own = (c: { prototype: object }): string[] => Object.getOwnPropertyNames(c.prototype).filter((n) => !INTERNAL.has(n));

describe('registry covers the whole script API', () => {
  const reg = defaultRegistry();
  const has = (name: string) => reg.get(name) !== undefined;

  it('every method of the part chain has an entry (list_methods / docs)', () => {
    const missing = own(PartBuilder).filter((n) => n !== 'holes' && !has(n));
    expect(missing).toEqual([]);
    // the holes.* family hangs off a getter
    const holes = Object.keys(new PartBuilder('x').holes);
    expect(holes.length).toBeGreaterThan(2);
    expect(holes.filter((n) => !has(`holes.${n}`))).toEqual([]);
  });
  it('every sketch builder method has an entry (s.NAME)', () => {
    expect(own(SketchBuilder).filter((n) => !has(`s.${n}`))).toEqual([]);
  });
  it('every global function of the script scope has an entry', () => {
    const api = makeApi({ parts: [], vars: {}, varDefs: [] });
    expect(Object.keys(api).filter((n) => !has(n))).toEqual([]);
  });
  it('the methods GAPS.md found missing are documented', () => {
    for (const n of ['appearance', 'bodyName', 'group', 'handle', 'sweep', 'workplane', 'insertPart', 's.arc3', 's.rrect', 's.text', 'circularPattern']) expect(has(n), n).toBe(true);
    expect(reg.get('circularPattern')!.signature).toContain('PatternSeed');
    expect(reg.get('at')!.notes).toContain('sketch y (v) = normal x u');
  });
  it('names resolve with or without the part. / sketch. prefix and unknown names get suggestions', () => {
    expect(reg.get('part.extrude')?.name).toBe('extrude');
    expect(reg.get('sketch.rect')?.name).toBe('s.rect');
    expect(reg.get('appearence')).toBeUndefined();
    expect(reg.suggest!('appearence')).toContain('appearance');
  });
  it('the guide and llms.txt carry the facts an agent needs cold', () => {
    const g = reg.guide();
    for (const w of ['Millimetres', 'front', 'xdir', 'EVERY body', 'newBody', 'handle', 'appearance', 'bodyName', 'profileCrossesAxis', 'cutNoEffect']) expect(g, w).toContain(w);
    expect(reg.llmsTxt!()).toContain('## Method index');
  });
});
