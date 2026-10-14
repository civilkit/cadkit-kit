import { describe, expect, it, vi } from 'vitest';
import type { SelectionMode } from '@kit/store';
import '../i18n';
import { selectCommands, whyNot, type SelectActions } from './selectCommands';
import { SelModel } from './model';
import { boxData, roundedData } from './fixtures';

function setup(sel: string[], mode: SelectionMode, data = boxData()) {
  const state = { sel, mode, box: false };
  const apply = vi.fn((r: { names: string[]; mode: SelectionMode }) => { state.sel = r.names; state.mode = r.mode; });
  const notify = vi.fn();
  const a: SelectActions = {
    model: () => new SelModel(data), selection: () => state.sel, mode: () => state.mode, hasDocument: () => true, apply, clear: () => { state.sel = []; },
    setMode: (m) => { state.mode = m; }, box: { isOn: () => state.box, toggle: () => { state.box = !state.box; } }, notify,
  };
  const cmds = selectCommands(a);
  return { cmd: (id: string) => cmds.find((c) => c.id === id)!, state, apply, notify };
}

describe('select commands', () => {
  it('Body mode has key B and shows pressed in body mode; Box select has X', () => {
    const s = setup([], 'face');
    expect(s.cmd('sel-body').keys).toBe('B');
    expect(s.cmd('sel-body').pressed!()).toBe(false);
    s.cmd('sel-body').run();
    expect(s.state.mode).toBe('body');
    expect(s.cmd('sel-body').pressed!()).toBe(true);
    expect(s.cmd('select-box').keys).toBe('X');
    s.cmd('select-box').run();
    expect(s.cmd('select-box').pressed!()).toBe(true);
  });
  it('the select-more commands need a face or edge selection', () => {
    expect(setup([], 'face').cmd('select-similar').enabled!()).toBe(false);
    expect(setup(['B+z'], 'vertex').cmd('select-similar').enabled!()).toBe(false);
    expect(setup(['B+z'], 'face').cmd('select-similar').enabled!()).toBe(true);
    expect(whyNot('select-tangent', 'face', [])).toMatch(/first/);
    expect(whyNot('select-tangent', 'body', ['@body:x'])).toMatch(/faces and edges/);
  });
  it('Select similar applies the result and says how many were added', () => {
    const s = setup(['Bx00|0'], 'edge');
    s.cmd('select-similar').run();
    expect(s.state.sel).toHaveLength(4);
    expect(s.notify).toHaveBeenCalledWith('3 added to the selection');
  });
  it('Select tangent on a rounded edge chain', () => {
    const s = setup(['TF|b#2'], 'edge', roundedData());
    s.cmd('select-tangent').run();
    expect(s.state.sel.sort()).toEqual(['RF|b#3', 'TF|b#2', 'WF|b#4']);
  });
  it('Select loop on a face moves to Edge mode', () => {
    const s = setup(['B+z'], 'face');
    s.cmd('select-loop').run();
    expect(s.state.mode).toBe('edge');
    expect(s.state.sel).toHaveLength(4);
  });
  it('Invert and Deselect all', () => {
    const s = setup(['B+z'], 'face');
    s.cmd('select-invert').run();
    expect(s.state.sel).toHaveLength(5);
    s.cmd('select-none').run();
    expect(s.state.sel).toEqual([]);
    expect(s.cmd('select-none').enabled!()).toBe(false);
  });
  it('a tangent search that finds nothing new still reports, a missing selection warns', () => {
    const s = setup([], 'face');
    s.cmd('select-parallel').run();
    expect(s.notify).toHaveBeenCalledWith('Nothing more to select', 'warn');
  });
});
