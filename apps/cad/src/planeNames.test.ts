import { afterEach, describe, expect, it } from 'vitest';
import { groundPlaneId, planeName, planeRole, planeTag, setPlaneUp, viewPlaneIds } from './planeNames';
import { refRows } from './treeModel';
import { refLabel } from './featureCreators';
import { STD_FRAMES } from './catalog/placement';

afterEach(() => setPlaneUp('y'));

describe('standard planes follow the up axis', () => {
  it('Y-up offers front, top, right under their own names', () => {
    expect(viewPlaneIds()).toEqual(['front', 'top', 'right']);
    expect(['front', 'top', 'right'].map(planeName)).toEqual(['Front Plane', 'Top Plane', 'Right Plane']);
    expect(groundPlaneId()).toBe('top');
  });
  it('Z-up offers xz, front (XY), yz as Front, Top, Right', () => {
    setPlaneUp('z');
    expect(viewPlaneIds()).toEqual(['xz', 'front', 'yz']);
    expect(viewPlaneIds().map(planeName)).toEqual(['Front Plane', 'Top Plane', 'Right Plane']);
    expect(viewPlaneIds().map(planeTag)).toEqual(['XZ', 'XY', 'YZ']);
    expect(viewPlaneIds().map(planeRole)).toEqual(['front', 'top', 'right']);
    expect(groundPlaneId()).toBe('front');
    // a part that already has a sketch on the old top plane: still named for what it is
    expect(planeName('top')).toBe('Front Plane');
    expect(planeName('right')).toBe('Right Plane');
  });
  it('the tree rows and default sketch names use them', () => {
    setPlaneUp('z');
    const rows = refRows({} as never).filter((r) => r.choosable && r.tag);
    expect(rows.map((r) => [r.id, r.label, r.tag])).toEqual([['xz', 'Front Plane', 'XZ'], ['front', 'Top Plane', 'XY'], ['yz', 'Right Plane', 'YZ']]);
    expect(refLabel({} as never, { kind: 'std', id: 'xz' } as never)).toBe('Front');
  });
  it('the upright planes have y running up', () => {
    expect(STD_FRAMES.xz).toEqual({ x: [1, 0, 0], y: [0, 0, 1], n: [0, -1, 0] });
    expect(STD_FRAMES.yz).toEqual({ x: [0, 1, 0], y: [0, 0, 1], n: [1, 0, 0] });
  });
});
