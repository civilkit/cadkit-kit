import { describe, expect, it } from 'vitest';
import { defaultExtrudeOp, nextBodyName, opChoiceOf, opChoices, opPatch, planeTouchesBox, cutFromPatch, targetBodiesOf, targetBodyOf, targetPatch, KERNEL_SUPPORTS_NEW_BODY } from './extrudeOp';

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
  it('the kernel has a new-body extrude (ADR 0004), so the card offers New body, Add and Cut', () => {
    expect(KERNEL_SUPPORTS_NEW_BODY).toBe(true);
    expect(opChoices()).toEqual(['new', 'add', 'cut']);
    expect(opChoices(false)).toEqual(['add', 'cut']);
  });
  it('the control shows newBody (and the aliases the kernel reads) as New body, and everything else but cut as Add', () => {
    expect(['newBody', 'new', 'separate', 'cut', 'add', undefined].map(opChoiceOf)).toEqual(['new', 'new', 'new', 'cut', 'add', 'add']);
  });
  it('a new body gets a free name of its own; a name it has is kept; Add and Cut carry no body name', () => {
    expect(nextBodyName(new Set())).toBe('Body 1');
    expect(nextBodyName(new Set(['Body 1', 'Body 3']))).toBe('Body 2');
    expect(opPatch('new', {}, new Set(['Body 1']))).toEqual({ op: 'newBody', flip: null, target: null, body: 'Body 2' });
    expect(opPatch('new', { body: 'Case' }, new Set(['Case']))).toEqual({ op: 'newBody', flip: null, target: null, body: 'Case' });
    expect(opPatch('add', { body: 'Case' }, new Set())).toEqual({ op: 'add', flip: null, body: null });
    expect(opPatch('cut', { body: 'Case' }, new Set())).toEqual({ op: 'cut', body: null });
  });
});

describe('target body', () => {
  it('reads and writes {body: name}; no name is Automatic and removes the field', () => {
    expect(targetBodyOf({})).toBe('');
    expect(targetBodyOf({ target: null })).toBe('');
    expect(targetBodyOf({ target: { body: 'Case' } })).toBe('Case');
    expect(targetPatch('Case')).toEqual({ target: { body: 'Case' } });
    expect(targetPatch('')).toEqual({ target: null });
  });
  it('Cut from: a list of bodies; none is every body the cut reaches', () => {
    expect(cutFromPatch(['Cup', 'Lid'])).toEqual({ target: [{ body: 'Cup' }, { body: 'Lid' }] });
    expect(cutFromPatch([])).toEqual({ target: null });
    expect(targetBodiesOf({ target: [{ body: 'Cup' }, { body: 'Lid' }] })).toEqual(['Cup', 'Lid']);
    expect(targetBodiesOf({ target: { body: 'Cup' } })).toEqual(['Cup']);
    expect(targetBodiesOf({ target: [{ face: 'F2.C1' }] })).toEqual([]);
    expect(targetBodyOf({ target: [{ body: 'Cup' }, { body: 'Lid' }] })).toBe('');
  });
  it('switching a cut of several bodies to an Add drops the list; one body carries over', () => {
    expect(opPatch('add', { target: [{ body: 'A' }, { body: 'B' }] }, new Set())).toEqual({ op: 'add', flip: null, body: null, target: null });
    expect(opPatch('add', { target: [{ body: 'A' }] }, new Set())).toEqual({ op: 'add', flip: null, body: null });
  });
});
