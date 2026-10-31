import { describe, it, expect } from 'vitest';
import { TouchGuard } from './touchguard';

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
