import { describe, expect, it } from 'vitest';
import { firstIssue, frameAt, frameCount, frameTime, newStudyId, poseRequestAt, readStudies, solvedFrom, studyFrames, studyTime, valueAt, withKey, withoutKey, withoutStudy, withStudy, type Study } from './studies';
import type { Frame } from './model';

const study = (over: Partial<Study> = {}): Study => ({ id: 's1', name: 'Open', duration: 4, loop: 'once', clearance: 0, tracks: [{ driver: 'F3', keys: [{ t: 0, v: 0 }, { t: 2, v: 80, ease: 'inOut' }, { t: 4, v: 0 }] }], ...over });

describe('keyframe values', () => {
  it('holds before the first key and after the last, is linear by default and smooth with inOut', () => {
    const tr = { driver: 'F3', keys: [{ t: 1, v: 10 }, { t: 3, v: 30 }, { t: 5, v: 70, ease: 'inOut' as const }] };
    expect(valueAt(tr, 0)).toBe(10);
    expect(valueAt(tr, 6)).toBe(70);
    expect(valueAt(tr, 2)).toBe(20); // linear to the second key
    expect(valueAt(tr, 3)).toBe(30);
    expect(valueAt(tr, 4)).toBe(50); // inOut: the middle of the move is the middle value
    expect(valueAt(tr, 3.5)).toBeCloseTo(30 + 40 * (0.25 * 0.25 * (3 - 0.5)), 12); // smoothstep(0.25)
    expect(valueAt({ driver: 'x', keys: [] }, 1)).toBeNull();
  });
  it('asks the kernel for every driver with keys', () => {
    expect(poseRequestAt(study(), 2)).toEqual({ F3: 80 });
    expect(poseRequestAt(study({ tracks: [{ driver: 'F3', keys: [] }] }), 2)).toEqual({});
  });
});

describe('the play clock', () => {
  it('stops once, starts over when looping, goes back and forth when ping-pong', () => {
    expect(studyTime(5, 4, 'once')).toBe(4);
    expect(studyTime(5, 4, 'loop')).toBe(1);
    expect(studyTime(1, 4, 'pingpong')).toBe(1);
    expect(studyTime(5, 4, 'pingpong')).toBe(3);
    expect(studyTime(8, 4, 'pingpong')).toBe(0);
    expect(studyTime(-1, 4, 'loop')).toBe(0);
  });
  it('frames: 30 a second, never more than the cap, frame 0 at t=0 and the last at the end', () => {
    expect(frameCount(4)).toBe(121);
    expect(frameCount(100)).toBe(600);
    expect(frameTime(0, 121, 4)).toBe(0);
    expect(frameTime(120, 121, 4)).toBe(4);
    expect(frameAt(2, 121, 4)).toBe(60);
    expect(frameAt(99, 121, 4)).toBe(120);
    const f = studyFrames(study());
    expect(f).toHaveLength(121);
    expect(f[0]).toEqual({ F3: 0 });
    expect(f[60]).toEqual({ F3: 80 });
    expect(f[120]).toEqual({ F3: 0 });
  });
});

describe('the studies in doc.motion', () => {
  it('reads defensively and leaves the bridge\'s logged studies alone', () => {
    const raw = { studies: [{ id: 's1', name: 'A', duration: 2, loop: 'pingpong', tracks: [{ driver: 'F3', keys: [{ t: 2, v: 5 }, { t: 0, v: 1 }, { t: 'x', v: 1 }] }] }, { id: 'log', joints: [1, 2] }, null] };
    const s = readStudies(raw);
    expect(s).toHaveLength(1);
    expect(s[0].tracks[0].keys).toEqual([{ t: 0, v: 1 }, { t: 2, v: 5 }]);
    expect(s[0].loop).toBe('pingpong');
    expect(readStudies(null)).toEqual([]);
    // writing back keeps the foreign entry
    const next = withStudy(raw, { ...s[0], name: 'B' }) as Array<{ id: string; name?: string }>;
    expect(next.map((x) => x?.id)).toEqual(['s1', 'log', undefined]);
    expect(next[0].name).toBe('B');
    expect((withoutStudy(raw, 's1') as unknown[]).length).toBe(2);
    expect(newStudyId([{ id: 's1' }, { id: 's2' }])).toBe('s3');
  });
  it('adds and removes keys', () => {
    let s = withKey(study({ tracks: [] }), 'F3', 1, 10);
    s = withKey(s, 'F3', 3, 50, 'linear');
    expect(s.tracks[0].keys).toEqual([{ t: 1, v: 10, ease: 'inOut' }, { t: 3, v: 50, ease: 'linear' }]);
    s = withKey(s, 'F3', 1.01, 20);
    expect(s.tracks[0].keys.map((k) => k.v)).toEqual([20, 50]);
    s = withoutKey(withoutKey(s, 'F3', 0), 'F3', 0);
    expect(s.tracks).toEqual([]);
  });
});

describe('a solved study', () => {
  const f = (ox: number): Frame => ({ o: [ox, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
  it('reports the first contact, with the time, and a pose the mates cannot reach', () => {
    const asm = [{ id: 'F1', place: f(0) }, { id: 'F2', place: f(0) }];
    const ok = (ox: number, extra = {}) => ({ ok: true, places: [{ id: 'F1', place: f(0) }, { id: 'F2', place: f(ox) }], ...extra });
    const poses = [ok(0), ok(1), ok(2, { contact: { a: 'F1', b: 'F2', kind: 'contact', distance: 0, at: [0, 0, 0] } }), { ok: false, places: [], error: 'mateConflict' }];
    const s = solvedFrom(asm, poses);
    expect(s.deltas[0].size).toBe(0);
    expect(s.deltas[1].get('F2')!.t[0]).toBe(1);
    expect(firstIssue(s, 3)).toEqual({ kind: 'contact', time: 2, a: 'F1', b: 'F2', distance: 0 });
    expect(firstIssue(solvedFrom(asm, [ok(0), ok(1)]), 1)).toBeNull();
    expect(firstIssue(solvedFrom(asm, [ok(0), { ok: false, places: [], error: 'mateConflict' }]), 1)).toEqual({ kind: 'solver', time: 1, error: 'mateConflict' });
  });
});
