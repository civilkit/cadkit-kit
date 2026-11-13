import { describe, it, expect } from 'vitest';
import { PenGuard, TouchGuard } from './touchguard';

const touch = (pointerId: number, isPrimary = false) => ({ pointerType: 'touch', pointerId, isPrimary });

describe('TouchGuard', () => {
  it('one finger is not multi-touch', () => {
    const g = new TouchGuard();
    expect(g.down(touch(1, true))).toBe(false);
    expect(g.multi).toBe(false);
  });
  it('the second finger starts multi-touch once, and it lasts until the last finger is up', () => {
    const g = new TouchGuard();
    g.down(touch(1, true));
    expect(g.down(touch(2))).toBe(true);
    expect(g.multi).toBe(true);
    expect(g.down(touch(3))).toBe(false);   // already multi: nothing more to cancel
    g.end({ pointerType: 'touch', pointerId: 1 });
    g.end({ pointerType: 'touch', pointerId: 2 });
    expect(g.multi).toBe(true);
    g.end({ pointerType: 'touch', pointerId: 3 });
    expect(g.multi).toBe(false);
  });
  it('a cancelled pointer ends like a lifted one', () => {
    const g = new TouchGuard();
    g.down(touch(1, true)); g.down(touch(2));
    g.end({ pointerType: 'touch', pointerId: 2 });
    g.end({ pointerType: 'touch', pointerId: 1 });
    expect(g.multi).toBe(false);
  });
  it('mouse and pen never count', () => {
    const g = new TouchGuard();
    expect(g.down({ pointerType: 'mouse', pointerId: 1, isPrimary: true })).toBe(false);
    expect(g.down({ pointerType: 'pen', pointerId: 2, isPrimary: false })).toBe(false);
    expect(g.down({ pointerType: 'mouse', pointerId: 3, isPrimary: false })).toBe(false);
    expect(g.multi).toBe(false);
  });
  it('a touch that was lost (no up event ever came) cannot leave it stuck: the next first finger resets it', () => {
    const g = new TouchGuard();
    g.down(touch(1, true)); g.down(touch(2));
    expect(g.multi).toBe(true);
    expect(g.down(touch(7, true))).toBe(false);
    expect(g.multi).toBe(false);
  });
});

describe('PenGuard: a palm beside the pen', () => {
  const ev = (type: string, pointerType: string, pointerId: number) => ({ type, pointerType, pointerId });
  it('drops a touch that lands while the pen is down, and everything that touch does after', () => {
    const g = new PenGuard();
    expect(g.drop(ev('pointerdown', 'pen', 1), true)).toBe(false);
    expect(g.penDown).toBe(true);
    expect(g.drop(ev('pointerdown', 'touch', 7), true)).toBe(true);
    expect(g.drop(ev('pointermove', 'touch', 7), true)).toBe(true);
    expect(g.drop(ev('pointerup', 'touch', 7), true)).toBe(true);
    expect(g.drop(ev('pointermove', 'touch', 7), true)).toBe(false);   // forgotten after its end
  });
  it('lets a finger work when the pen is not touching (hover alone is no contact)', () => {
    const g = new PenGuard();
    expect(g.drop(ev('pointermove', 'pen', 1), true)).toBe(false);
    expect(g.penDown).toBe(false);
    expect(g.drop(ev('pointerdown', 'touch', 7), true)).toBe(false);
  });
  it('a finger that was already down when the pen arrived keeps working; after the pen lifts a new touch is a finger again', () => {
    const g = new PenGuard();
    expect(g.drop(ev('pointerdown', 'touch', 3), true)).toBe(false);
    g.drop(ev('pointerdown', 'pen', 1), true);
    expect(g.drop(ev('pointermove', 'touch', 3), true)).toBe(false);
    g.drop(ev('pointerup', 'pen', 1), true);
    expect(g.penDown).toBe(false);
    expect(g.drop(ev('pointerdown', 'touch', 9), true)).toBe(false);
  });
  it('a cancelled pen releases the guard; a press off the canvas is not a pen contact', () => {
    const g = new PenGuard();
    g.drop(ev('pointerdown', 'pen', 1), false);
    expect(g.penDown).toBe(false);
    g.drop(ev('pointerdown', 'pen', 1), true);
    g.drop(ev('pointercancel', 'pen', 1), true);
    expect(g.penDown).toBe(false);
  });
  it('a mouse is never touched', () => {
    const g = new PenGuard();
    g.drop(ev('pointerdown', 'pen', 1), true);
    expect(g.drop(ev('pointerdown', 'mouse', 1), true)).toBe(false);
  });
});
