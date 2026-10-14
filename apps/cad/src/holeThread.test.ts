import { afterEach, describe, expect, it } from 'vitest';
import {
  canThreadHole, capLength, defaultHoleThread, holeThreadEditOps, linkedThreads, tapHolePatch, threadCfgOf, threadMaxLength, type HoleThread,
} from './holeThread';
import { featureCommands, canThread, type Ctx } from './featureCommands';
import { groupChip, groupMisfits, holeWallFaces, isWallOfHole, sameSizeFaces, threadGroup, threadOpsForFaces, type EdgeLike, type ThreadRow } from './threadData';

afterEach(() => { try { localStorage.clear(); } catch { /* none */ } });

const row = (size: string, major: number, tapDrill: number, pitch = 1, standard = 'metric'): ThreadRow => ({
  size, standard, major, pitch, minorInternal: major - 1.0825 * pitch, minorExternal: major - 1.2269 * pitch, tapDrill, classInternal: '6H', classExternal: '6g',
});
const ROWS = [row('M4', 4, 3.3, 0.7), row('M5', 5, 4.2, 0.8), row('M6', 6, 5), row('M8', 8, 6.8, 1.25), row('M10', 10, 8.5, 1.5)];
const CFG: HoleThread = { standard: 'metric', size: 'M8', class: '6H', length: 'full', hand: 'right', modeled: false };

describe('tapped hole rules', () => {
  it('the hole becomes the tap drill: ISO size + tap fit for metric, a plain diameter for anything else', () => {
    expect(tapHolePatch(ROWS[3])).toEqual({ size: 'M8', fit: 'tap', diameter: null });
    expect(tapHolePatch(row('1/4-20', 6.35, 5.105, 1.27, 'UNC'))).toEqual({ diameter: 5.105, size: null, fit: null });
    expect(tapHolePatch(row('M8x1', 8, 7, 1, 'metric-fine'))).toEqual({ diameter: 7, size: null, fit: null });
    expect(tapHolePatch(row('M6', 6, 5.1))).toEqual({ diameter: 5.1, size: null, fit: null });   // a table that disagrees with the hole table
  });
  it('the thread starts at the hole size, or the size whose tap drill is nearest to a custom diameter', () => {
    expect(defaultHoleThread({ type: 'hole', kind: 'simple', size: 'M6', fit: 'normal' }, ROWS)!.cfg).toMatchObject({ standard: 'metric', size: 'M6', class: '6H', length: 'full', hand: 'right', modeled: false });
    expect(defaultHoleThread({ type: 'hole', kind: 'simple', diameter: 6.9 }, ROWS)!.cfg.size).toBe('M8');
    expect(defaultHoleThread({ type: 'hole', kind: 'simple', size: 'M6' }, [])).toBeNull();
  });
  it('the remembered "model the thread" choice is the default', () => {
    localStorage.setItem('ck.thread.prefs', JSON.stringify({ modeled: true }));
    expect(defaultHoleThread({ type: 'hole', kind: 'simple', size: 'M6' }, ROWS)!.cfg.modeled).toBe(true);
  });
  it('only a simple hole takes a thread; a blind hole caps the length at its depth', () => {
    expect(canThreadHole({ kind: 'simple' })).toBe(true);
    expect(canThreadHole({ kind: 'cbore' })).toBe(false);
    expect(threadMaxLength({ end: 'blind', depth: 14 }, 30)).toBe(14);
    expect(threadMaxLength({ end: 'through' }, 30)).toBe(30);
    expect(threadMaxLength({ end: 'through' }, null)).toBeNull();
    expect(capLength({ ...CFG, length: 20 }, 14).length).toBe(14);
    expect(capLength({ ...CFG, length: 10 }, 14).length).toBe(10);
    expect(capLength({ ...CFG, length: 'full' }, 14).length).toBe('full');
  });
  it('reads the settings of a linked thread', () => {
    expect(threadCfgOf({ type: 'thread', id: 'F9', face: 'H.S.h1', standard: 'UNC', size: '1/4-20', class: '2B', length: 9, hand: 'left', modeled: true }))
      .toEqual({ standard: 'UNC', size: '1/4-20', class: '2B', length: 9, hand: 'left', modeled: true });
  });
});

describe('threads on the walls of a hole', () => {
  const walls = ['H.S.h1~0', 'H.S.h1~1', 'H.S.h1~2', 'H.S.h1~3'];
  const feats = [{ type: 'hole', id: 'H' }, { type: 'thread', id: 'T1', face: 'H.S.h1~0' }, { type: 'thread', id: 'T9', face: 'Q.S.h1' }, { type: 'thread', id: 'T2', face: 'H.S.h1~1' }];
  it('finds the threads of every position, not those of another hole', () => {
    expect(linkedThreads(feats, 'H').map((f) => f.id)).toEqual(['T1', 'T2']);
    expect(isWallOfHole('H.S.h1', 'H')).toBe(true);
    expect(isWallOfHole('H.S.h1~12', 'H')).toBe(true);
    expect(isWallOfHole('H.S.h10', 'H')).toBe(false);
    expect(isWallOfHole('HH.S.h1', 'H')).toBe(false);
  });
  it('Threaded on: one add per wall, one batch; the single-position name when no walls are known', () => {
    const ops = holeThreadEditOps('H', [], CFG, walls);
    expect(ops.map((o) => (o as unknown as { feature: { face: string } }).feature.face)).toEqual(walls);
    expect(ops.every((o) => o.op === 'add' && (o as unknown as { feature: { size: string; type: string } }).feature.type === 'thread')).toBe(true);
    expect(holeThreadEditOps('H', [], CFG)).toEqual([{ op: 'add', feature: { type: 'thread', face: 'H.S.h1', ...CFG } }]);
  });
  it('edited: replaces the ones that differ, adds the missing, keeps other fields, nothing when equal', () => {
    const have = [{ type: 'thread', id: 'T1', face: 'H.S.h1~0', ...CFG, start: 'top' }, { type: 'thread', id: 'T2', face: 'H.S.h1~1', ...CFG, size: 'M6' }];
    const ops = holeThreadEditOps('H', have, CFG, walls);
    expect(ops.map((o) => o.op)).toEqual(['replace', 'add', 'add']);   // T1 is already as asked: only T2 is replaced
    expect(ops[0]).toMatchObject({ op: 'replace', id: 'T2', feature: { size: 'M8', face: 'H.S.h1~1' } });
    const all = walls.map((face, i) => ({ type: 'thread', id: `T${i}`, face, ...CFG }));
    expect(holeThreadEditOps('H', all, CFG, walls)).toEqual([]);
    // an empty class is dropped from the feature
    expect((holeThreadEditOps('H', all, { ...CFG, class: undefined }, walls)[0] as { feature: Record<string, unknown> }).feature).not.toHaveProperty('class');
  });
  it('Threaded off removes every linked thread', () => {
    expect(holeThreadEditOps('H', linkedThreads(feats, 'H'), null, walls)).toEqual([{ op: 'remove', id: 'T1' }, { op: 'remove', id: 'T2' }]);
    expect(holeThreadEditOps('H', [], null, walls)).toEqual([]);
  });
});

function circle(c: number[], r: number): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; pts.push([c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r]); }
  return pts;
}
const ring = (face: string, other: string, c: number[], r: number): EdgeLike => ({ key: `${face}|${other}`, faces: [face, other], pts: circle(c, r) });
const wall = (face: string, x: number, r: number): EdgeLike[] => [ring(face, 'top', [x, 10, 0], r), ring(face, 'bot', [x, 0, 0], r)];

describe('several faces', () => {
  const edges = [...wall('H.S.h1~0', 0, 2.5), ...wall('H.S.h1~1', 10, 2.5), ...wall('H.S.h1~2', 20, 2.5), ...wall('H.S.h1~3', 30, 3), ...wall('S.S.c1', 40, 2.5)];
  it('Select same size: the faces of one diameter and kind, the picked one first', () => {
    expect(sameSizeFaces('H.S.h1~1', edges)).toEqual(['H.S.h1~1', 'H.S.h1~0', 'H.S.h1~2']);   // not the Ø 6 hole, not the shaft of the same diameter
    expect(sameSizeFaces('S.S.c1', edges)).toEqual(['S.S.c1']);
    expect(sameSizeFaces('top', edges)).toEqual([]);
  });
  it('the walls of a hole in position order', () => {
    expect(holeWallFaces('H', edges)).toEqual(['H.S.h1~0', 'H.S.h1~1', 'H.S.h1~2', 'H.S.h1~3']);
    expect(holeWallFaces('Q', edges)).toEqual([]);
  });
  it('the chip text: holes, shafts, mixed, with a diameter or a range', () => {
    const c = (face: string, r: number, internal?: boolean) => ({ face, cyl: { radius: r, axisPoint: [], axisDir: [], internal } });
    expect(groupChip([c('a', 2.5, true), c('b', 2.5, true), c('c', 2.5, true), c('d', 2.5, true)])).toEqual({ key: 'holes', n: 4, d: '5' });
    expect(groupChip([c('a', 5, false), c('b', 5, false)])).toEqual({ key: 'shafts', n: 2, d: '10' });
    expect(groupChip([c('a', 2, true), c('b', 3, false)])).toEqual({ key: 'faces', n: 2, d: '4 - 6' });
  });
  it('one thread per face, sharing settings, the size nearest to the first face', () => {
    const cyls = ['H.S.h1~0', 'H.S.h1~1'].map((f) => ({ face: f, cyl: { radius: 3.4, axisPoint: [], axisDir: [], internal: true } }));
    const ops = threadOpsForFaces(cyls, ROWS)!;
    expect(ops).toHaveLength(2);
    expect(ops.map((o) => (o as unknown as { feature: Record<string, unknown> }).feature)).toEqual([
      { type: 'thread', face: 'H.S.h1~0', standard: 'metric', size: 'M8', class: '6H', length: 'full', hand: 'right', modeled: false },
      { type: 'thread', face: 'H.S.h1~1', standard: 'metric', size: 'M8', class: '6H', length: 'full', hand: 'right', modeled: false },
    ]);
    expect(threadOpsForFaces([], ROWS)).toBeNull();
  });
  it('a group is the run of neighbouring threads with the same settings', () => {
    const t = (id: string, size = 'M8') => ({ type: 'thread', id, face: `${id}.S.h1`, standard: 'metric', size, length: 'full' });
    const f = [{ type: 'extrude', id: 'E' }, t('A'), t('B'), t('C'), t('D', 'M6'), t('E2')];
    expect(threadGroup(f, 'B')).toEqual(['A', 'B', 'C']);
    expect(threadGroup(f, 'D')).toEqual(['D']);
    expect(threadGroup(f, 'E')).toEqual(['E']);
    expect(threadGroup(f, 'nope')).toEqual(['nope']);
  });
  it('misfits are the faces whose thread carries the kernel mismatch warning', () => {
    const w = { B: { code: 'threadDiameterMismatch', hint: 'x' }, C: { code: 'other', hint: 'y' } };
    expect(groupMisfits([{ face: 'fa', id: 'A' }, { face: 'fb', id: 'B' }, { face: 'fc', id: 'C' }], w)).toEqual(['fb']);
  });
  it('Shift+T takes several cylinder faces; "Select same size" selects all of the diameter, the command needs a cylinder', () => {
    const picked: string[][] = [];
    const asked: string[][] = [];
    let selection = ['H.S.h1~1'];
    const ctx = (): Ctx => ({ doc: { features: [{ type: 'extrude' }] } as never, selection, mode: 'face', box: { min: [0, 0, 0], max: [40, 10, 40] }, edges: edges as never });
    const cmds = featureCommands({ context: ctx, create() {}, holeOnFace() {}, holeFlip: () => false, notify() {}, addThread: (f) => { asked.push(f); }, select: (n) => { picked.push(n); } });
    const same = cmds.find((c) => c.id === 'select-same-size')!;
    const add = cmds.find((c) => c.id === 'add-thread')!;
    expect(same.enabled!()).toBe(true);
    same.run();
    expect(picked).toEqual([['H.S.h1~1', 'H.S.h1~0', 'H.S.h1~2']]);
    selection = picked[0];
    expect(canThread(ctx())).toBe(true);
    add.run();
    expect(asked).toEqual([['H.S.h1~1', 'H.S.h1~0', 'H.S.h1~2']]);
    selection = ['H.S.h1~1', 'top'];   // a flat face in the mix: no thread, nothing to grow
    expect(add.enabled!()).toBe(false);
    expect(same.enabled!()).toBe(false);
  });
});
