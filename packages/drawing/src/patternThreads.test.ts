import { describe, expect, it } from 'vitest';
import { carriesThreads, carryPatch, countedLabel, followedFaces, hostOf, instanceCount, patternedBy, seedCount, seedInfos, seedLabel, threadParents, threadsOf } from './patternThreads';
import { holeInfos } from './drawing/kernel';

type Wire = Record<string, unknown>;
const feats = (): Wire[] => [
  { type: 'extrude', id: 'F2' },
  { type: 'sketch', id: 'F3' },
  { type: 'hole', id: 'F4', sketch: 'F3', size: 'M5' },
  { type: 'thread', id: 'F5', face: 'F4.S.h1', standard: 'metric', size: 'M5' },
  { type: 'cpattern', id: 'F7', seeds: ['F4'], count: 4 },
];
const name = (t: string) => ({ hole: 'Hole', thread: 'Thread', extrude: 'Extrude' } as Record<string, string>)[t] ?? t;

describe('pattern threads: rules', () => {
  it('hostOf reads the feature of a face, or the pattern of an instance face', () => {
    expect(hostOf('F4.S.h1')).toBe('F4');
    expect(hostOf('F4.S.h1~2')).toBe('F4');
    expect(hostOf('F4.S.h1@F7.3')).toBe('F7');
    expect(hostOf('F4.S.h1@F7.3@F8.2')).toBe('F8');
    expect(hostOf(undefined)).toBe('');
  });
  it('threadsOf lists the live threads on a feature', () => {
    const f = [...feats(), { type: 'thread', id: 'F6', face: 'F4.S.h1', suppressed: true }];
    expect(threadsOf(f, 'F4').map((t) => t.id)).toEqual(['F5']);
  });
  it('the seed label shows the hole with its thread, and the thread goes away with Carry threads off', () => {
    const p = feats()[4];
    expect(seedLabel(seedInfos(feats(), p)[0], name)).toBe('Hole F4 + Thread F5');
    const off = { ...p, ...carryPatch(false) };
    expect(carriesThreads(off)).toBe(false);
    expect(seedLabel(seedInfos(feats(), off)[0], name)).toBe('Hole F4');
    expect(carryPatch(true)).toEqual({ carryThreads: null });
  });
  it('a thread listed as a seed is its own seed', () => {
    const p = { ...feats()[4], seeds: ['F4', 'F5'] };
    const infos = seedInfos(feats(), p);
    expect(infos.map((i) => i.isThread)).toEqual([false, true]);
    expect(seedLabel(infos[1], name)).toBe('Thread F5');
  });
  it('patternedBy marks the seed and its thread', () => {
    expect(patternedBy(feats())).toEqual({ F4: ['F7'], F5: ['F7'] });
    expect(patternedBy([...feats().slice(0, 4), { ...feats()[4], carryThreads: false }])).toEqual({ F4: ['F7'] });
    expect(patternedBy([...feats().slice(0, 4), { ...feats()[4], suppressed: true }])).toEqual({});
  });
  it('a thread sits under its hole when only the hole sketch and sibling threads come between', () => {
    expect(threadParents(feats())).toEqual({ F5: 'F4' });
    const far = [...feats().slice(0, 4), { type: 'extrude', id: 'F6' }, { type: 'thread', id: 'F8', face: 'F4.S.h1' }];
    expect(threadParents(far)).toEqual({ F5: 'F4' });   // F8 comes after another feature: stays at the top level
    const two = [...feats().slice(0, 4), { type: 'thread', id: 'F6', face: 'F4.S.h1~2' }, { type: 'thread', id: 'F8', face: 'F4.S.h1~3' }];
    expect(threadParents(two)).toEqual({ F5: 'F4', F6: 'F4', F8: 'F4' });
  });
  it('copies are found by face, counted with their source', () => {
    const entries = [{ id: 'F5', face: 'F4.S.h1' }, { id: 'F5@F7.1', face: 'F4.S.h1@F7.1', instanceOf: 'F5' }, { id: 'F5@F7.2', face: 'F4.S.h1@F7.2', instanceOf: 'F5' }];
    expect(followedFaces(['F4.S.h1', 'F4.S.h1@F7.2'], entries)).toEqual({ 'F4.S.h1@F7.2': 'F5' });
    expect(instanceCount(entries, 'F5')).toBe(3);
    expect(countedLabel(3, 'M5')).toBe('3x M5');
    expect(countedLabel(1, 'M5')).toBe('M5');
  });
  it('seedCount multiplies patterns and mirrors', () => {
    expect(seedCount(feats(), 'F4')).toBe(4);
    expect(seedCount([...feats(), { type: 'mirror', id: 'F9', seeds: ['F4'] }], 'F4')).toBe(8);
    expect(seedCount(feats(), 'F2')).toBe(1);
    expect(seedCount([{ type: 'lpattern', id: 'F7', seeds: ['F4'], count: 'n' }], 'F4')).toBe(1);
  });
  it('the drawing callout of a patterned threaded hole reads 4x M5', () => {
    const h = holeInfos([...feats().slice(0, 2), { type: 'hole', id: 'F4', size: 'M5', kind: 'simple', end: 'through' }, feats()[3], feats()[4]] as never);
    expect(h.map((x) => x.text)).toEqual(['4x M5 THRU']);
    const plain = holeInfos([{ type: 'hole', id: 'F4', size: 'M5', kind: 'simple', end: 'through' }, feats()[4]] as never);
    expect(plain.map((x) => x.text)).toEqual(['M5 CLR THRU']);   // no thread: unchanged
  });
});
