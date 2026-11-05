import { describe, expect, it, vi } from 'vitest';
import { holdRepeat, isRolled, poseAngle, rollPose, sanitizeStep, snapPose, targetKind, turnPose, viewTargets, type ViewPose, type ViewTurn } from './viewnav';
import { cubeFaceLabels, type V3 } from './camerarig';

const axisAligned = (p: ViewPose) => [...p.dir, ...p.up].every((c) => c === 0 || c === 1 || c === -1);
const FACES: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

describe('view cube targets', () => {
  it('are the 6 faces, 12 edges and 8 corners, each once', () => {
    const t = viewTargets();
    expect(t).toHaveLength(26);
    expect(new Set(t.map((x) => x.dir.join())).size).toBe(26);
    expect(t.filter((x) => x.kind === 'face')).toHaveLength(6);
    expect(t.filter((x) => x.kind === 'edge')).toHaveLength(12);
    expect(t.filter((x) => x.kind === 'corner')).toHaveLength(8);
    expect(targetKind([1, 0, -1])).toBe('edge');
  });
  it('a face looks along its axis with the world up axis up; an edge is 45 degrees off a face, a corner is the same from all three', () => {
    expect(snapPose([0, 0, 1], 'y')).toEqual({ dir: [0, 0, 1], up: [0, 1, 0] });
    const edge = snapPose([1, 0, 1], 'y');
    expect(edge.dir[0]).toBeCloseTo(Math.SQRT1_2); expect(edge.dir[2]).toBeCloseTo(Math.SQRT1_2); expect(edge.up).toEqual([0, 1, 0]);
    expect(poseAngle(edge, snapPose([0, 0, 1], 'y'))).toBeCloseTo(45);
    const corner = snapPose([1, 1, 1], 'y');
    expect(Math.hypot(...corner.dir)).toBeCloseTo(1);
    expect(corner.dir[0]).toBeCloseTo(corner.dir[1]); expect(corner.dir[1]).toBeCloseTo(corner.dir[2]);
  });
  it('Top and Bottom keep the front at the screen bottom and top, for both up axes', () => {
    expect(snapPose([0, 1, 0], 'y')).toEqual({ dir: [0, 1, 0], up: [0, 0, -1] });
    expect(snapPose([0, -1, 0], 'y')).toEqual({ dir: [0, -1, 0], up: [0, 0, 1] });
    expect(snapPose([0, 0, 1], 'z')).toEqual({ dir: [0, 0, 1], up: [0, 1, 0] });
  });
  it('the face labels follow BoxGeometry order', () => {
    expect(cubeFaceLabels('y')[4]).toBe('FRONT');
    expect(cubeFaceLabels('z')[3]).toBe('FRONT');
  });
});

describe('arrow steps', () => {
  it('from Front, right shows the left side, left the right side, up the bottom and down the top', () => {
    const front = snapPose([0, 0, 1], 'y');
    expect(turnPose(front, 'right', 90, 'y').dir).toEqual([-1, 0, 0]);
    expect(turnPose(front, 'left', 90, 'y').dir).toEqual([1, 0, 0]);
    expect(turnPose(front, 'up', 90, 'y')).toEqual({ dir: [0, -1, 0], up: [0, 0, 1] });
    expect(turnPose(front, 'down', 90, 'y')).toEqual({ dir: [0, 1, 0], up: [0, 0, -1] });
  });
  it('the same holds with Z up', () => {
    const front = snapPose([0, -1, 0], 'z');
    expect(turnPose(front, 'left', 90, 'z').dir).toEqual([1, 0, 0]);
    expect(turnPose(front, 'down', 90, 'z')).toEqual({ dir: [0, 0, 1], up: [0, 1, 0] });
  });
  for (const up of ['y', 'z'] as const) {
    it(`four 90 degree steps in any direction come back exactly, from every face (${up} up), and each stop is orthogonal`, () => {
      for (const f of FACES) for (const turn of ['up', 'down', 'left', 'right'] as ViewTurn[]) {
        const start = snapPose(f, up);
        let p = start;
        for (let k = 0; k < 4; k++) { p = turnPose(p, turn, 90, up); expect(axisAligned(p)).toBe(true); }
        expect(p).toEqual(start);
      }
    });
  }
  it('mixed steps stay orthogonal and perpendicular', () => {
    let p = snapPose([0, 0, 1], 'y');
    const seq: ViewTurn[] = ['up', 'left', 'left', 'down', 'right', 'up', 'up', 'left'];
    for (const t of seq) { p = turnPose(p, t, 90, 'y'); expect(axisAligned(p)).toBe(true); expect(p.dir[0] * p.up[0] + p.dir[1] * p.up[1] + p.dir[2] * p.up[2]).toBe(0); }
  });
  it('from an iso view left and right keep the elevation and turn to the next corner', () => {
    const iso = snapPose([1, 1, 1], 'y');
    const l = turnPose(iso, 'left', 90, 'y');
    expect(l.dir[1]).toBeCloseTo(iso.dir[1]);
    expect(l.dir[0]).toBeCloseTo(iso.dir[0]); expect(l.dir[2]).toBeCloseTo(-iso.dir[2]);
    expect(l.up[1]).toBeGreaterThan(0);
    expect(isRolled(l, 'y')).toBe(false);
  });
  it('from an iso view up and down stop on the pole view instead of going over the top', () => {
    const iso = snapPose([1, 1, 1], 'y');
    const top = turnPose(iso, 'down', 90, 'y');
    expect(top.dir[1]).toBeCloseTo(1);
    expect(top.dir[0]).toBeCloseTo(0); expect(top.dir[2]).toBeCloseTo(0);
    const below = turnPose(iso, 'up', 90, 'y');
    expect(below.dir[1]).toBeLessThan(0);
    expect(below.up[1]).toBeGreaterThan(0);   // not upside down
  });
  it('smaller steps add up', () => {
    let p = snapPose([0, 0, 1], 'y');
    for (let k = 0; k < 8; k++) p = turnPose(p, 'left', 45, 'y');
    expect(poseAngle(p, snapPose([0, 0, 1], 'y'))).toBeCloseTo(0, 5);
    let q = snapPose([0, 0, 1], 'y');
    for (let k = 0; k < 3; k++) q = turnPose(q, 'down', 30, 'y');
    expect(q.dir[1]).toBeCloseTo(1);
    expect(sanitizeStep(30)).toBe(30); expect(sanitizeStep(7)).toBe(90); expect(sanitizeStep(undefined)).toBe(90);
  });
});

describe('roll', () => {
  it('four quarter turns come back exactly and each is orthogonal', () => {
    for (const f of FACES) for (const dir of ['cw', 'ccw'] as const) {
      const start = snapPose(f, 'y');
      let p = start;
      for (let k = 0; k < 4; k++) { p = rollPose(p, dir, 90); expect(axisAligned(p)).toBe(true); expect(p.dir).toEqual(start.dir); }
      expect(p).toEqual(start);
    }
  });
  it('clockwise turns the screen content clockwise: the model top ends up on the right', () => {
    const p = rollPose(snapPose([0, 0, 1], 'y'), 'cw', 90);
    expect(p.dir).toEqual([0, 0, 1]);
    expect(p.up).toEqual([-1, 0, 0]);   // the camera's up now points at the model's left, so what was at the top is at the right
  });
  it('clockwise and counter-clockwise undo each other', () => {
    const start = turnPose(snapPose([0, 0, 1], 'y'), 'left', 90, 'y');
    expect(rollPose(rollPose(start, 'cw', 90), 'ccw', 90)).toEqual(start);
  });
  it('a rolled view turns about its own screen axes, and rolling by hand is seen as a roll', () => {
    const rolled = rollPose(snapPose([0, 0, 1], 'y'), 'cw', 90);
    expect(isRolled(rolled, 'y')).toBe(true);
    const t = turnPose(rolled, 'left', 90, 'y');   // the model's top is on the right of the screen, so its right side comes round: the Top view
    expect(axisAligned(t)).toBe(true);
    expect(t.dir).toEqual([0, 1, 0]);
  });
});

describe('hold to repeat', () => {
  it('fires on press, then after the delay, then on every interval until release', () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const r = holdRepeat(fire, { delay: 400, interval: 300 });
    r.down();
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(399); expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1); expect(fire).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(300); expect(fire).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(600); expect(fire).toHaveBeenCalledTimes(5);
    r.up();
    vi.advanceTimersByTime(5000); expect(fire).toHaveBeenCalledTimes(5);
    expect(r.active).toBe(false);
    vi.useRealTimers();
  });
  it('a timer that ran late (a busy page) waits for the queued release first, so a late tap is one step', () => {
    let now = 0;
    const queue: Array<{ at: number; fn: () => void }> = [];
    const timers = { set: (fn: () => void, ms: number) => { queue.push({ at: now + ms, fn }); return queue.length; }, clear: () => {}, now: () => now };
    const fire = vi.fn();
    const r = holdRepeat(fire, { delay: 400, interval: 300, timers });
    r.down();
    now = 900;   // the page was busy for 900 ms: the delay timer is due long ago and the pointer-up is still waiting
    queue.shift()!.fn();
    expect(fire).toHaveBeenCalledTimes(1);
    r.up();      // the queued release runs now
    queue.shift()?.fn();
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it('a tap is one step; a second press while held does not double it', () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const r = holdRepeat(fire);
    r.down(); r.down(); r.up();
    vi.advanceTimersByTime(5000);
    expect(fire).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
