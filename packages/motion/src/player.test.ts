import { describe, expect, it } from 'vitest';
import { createPlayer } from './player';

function rig(loop: 'once' | 'loop' | 'pingpong', duration = 4, frames = 5) {
  let now = 0;
  let pending: (() => void) | null = null;
  const shown: Array<[number, number]> = [];
  let ended = 0;
  const p = createPlayer({ frames, duration, loop, show: (i, t) => shown.push([i, t]), onEnd: () => { ended++; }, schedule: (cb) => { pending = cb; return () => { pending = null; }; }, now: () => now });
  const advance = (ms: number) => { now += ms; const cb = pending; pending = null; cb?.(); };
  return { p, advance, shown, ended: () => ended, scheduled: () => pending !== null };
}

describe('player', () => {
  it('plays a study once at real speed and stops at the end', () => {
    const r = rig('once');
    r.p.play();
    r.advance(1000);
    expect(r.shown.at(-1)).toEqual([1, 1]);
    r.advance(1000);
    expect(r.shown.at(-1)).toEqual([2, 2]);
    r.advance(5000);
    expect(r.shown.at(-1)).toEqual([4, 4]);
    expect(r.p.playing).toBe(false);
    expect(r.ended()).toBe(1);
    expect(r.scheduled()).toBe(false);
  });
  it('loops and goes back and forth', () => {
    const l = rig('loop');
    l.p.play(); l.advance(5000);
    expect(l.shown.at(-1)).toEqual([1, 1]);
    expect(l.p.playing).toBe(true);
    const pp = rig('pingpong');
    pp.p.play(); pp.advance(5000);
    expect(pp.shown.at(-1)).toEqual([3, 3]);
    pp.advance(3000); // 8 s: back at the start
    expect(pp.shown.at(-1)).toEqual([0, 0]);
  });
  it('pauses, seeks, resumes from there and runs at the chosen speed', () => {
    const r = rig('once');
    r.p.play(); r.advance(500);
    r.p.pause();
    expect(r.scheduled()).toBe(false);
    r.p.seek(3);
    expect(r.shown.at(-1)).toEqual([3, 3]);
    r.p.setSpeed(2);
    r.p.play(); r.advance(250); // 0.5 s of study at double speed
    expect(r.shown.at(-1)![1]).toBeCloseTo(3.5, 9);
    r.p.seek(99);
    expect(r.p.time).toBe(4);
  });
  it('playing a finished once-study starts it again', () => {
    const r = rig('once');
    r.p.play(); r.advance(9000);
    expect(r.p.playing).toBe(false);
    r.p.play(); r.advance(1000);
    expect(r.shown.at(-1)).toEqual([1, 1]);
  });

  it('also says where it is between two frames', () => {
    const seen: number[] = [];
    let now = 0, pending: (() => void) | null = null;
    const p = createPlayer({ frames: 5, duration: 4, loop: 'once', show: (_i, _t, pos) => seen.push(pos), schedule: (cb) => { pending = cb; return () => {}; }, now: () => now });
    p.play(); now += 1500; (pending as unknown as () => void)();
    expect(seen.at(-1)).toBeCloseTo(1.5, 9); // 1.5 s of 4 s over 5 frames
  });
});
