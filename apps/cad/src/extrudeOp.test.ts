import { describe, expect, it } from 'vitest';
import { defaultExtrudeOp, opChoices, planeTouchesBox, KERNEL_SUPPORTS_NEW_BODY } from './extrudeOp';

const box = { min: [0, 0, 0], max: [10, 10, 10] };
const frame = (z: number) => ({ o: [0, 0, z], z: [0, 0, 1] });

describe('planeTouchesBox', () => {
  it('true for a plane through or on the surface of the body, false for one in empty space', () => {
    expect(planeTouchesBox(frame(5), box)).toBe(true);
    expect(planeTouchesBox(frame(10), box)).toBe(true);
    expect(planeTouchesBox(frame(0), box)).toBe(true);
    expect(planeTouchesBox(frame(25), box)).toBe(false);
    expect(planeTouchesBox(frame(5), null)).toBe(false);
    expect(planeTouchesBox(null, box)).toBe(false);
  });
});

describe('default extrude operation', () => {
  it('a Cut command is the only way to get a cut by default', () => {
    expect(defaultExtrudeOp({ explicitCut: true, touchesBody: false })).toBe('cut');
    expect(defaultExtrudeOp({ touchesBody: true })).toBe('add');
    expect(defaultExtrudeOp({ touchesBody: false })).toBe('add');
  });
  it('a sketch away from every body makes a new body when the kernel can, else it adds', () => {
    expect(defaultExtrudeOp({ touchesBody: false, supportsNew: true })).toBe('new');
    expect(defaultExtrudeOp({ touchesBody: true, supportsNew: true })).toBe('add');
  });
  it('the kernel has no new-body extrude yet, so the card offers Add and Cut only', () => {
    expect(KERNEL_SUPPORTS_NEW_BODY).toBe(false);
    expect(opChoices()).toEqual(['add', 'cut']);
    expect(opChoices(true)).toEqual(['new', 'add', 'cut']);
  });
});
