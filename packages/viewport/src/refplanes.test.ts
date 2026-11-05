import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { nearestSheet, RefPlanes, PLANE_PICK_TOL, type ScreenSheet } from './refplanes';

const labels = { front: 'Front', top: 'Top', right: 'Right' };
const sq = (x: number, y: number, w: number, h: number): Array<[number, number]> => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

describe('nearestSheet (the generous fallback behind the ray test)', () => {
  const sheets: ScreenSheet[] = [{ id: 'front', poly: sq(0, 0, 100, 100) }, { id: 'right', poly: sq(200, 0, 100, 100) }];
  it('a point inside a sheet picks it', () => {
    expect(nearestSheet(sheets, 50, 50, 0)).toBe('front');
    expect(nearestSheet(sheets, 250, 20, 0)).toBe('right');
  });
  it('a point outside picks the nearest outline within reach, and nothing beyond it', () => {
    expect(nearestSheet(sheets, 110, 50, PLANE_PICK_TOL.mouse)).toBeNull();   // 10 px out: beyond the mouse reach
    expect(nearestSheet(sheets, 106, 50, PLANE_PICK_TOL.mouse)).toBe('front');
    expect(nearestSheet(sheets, 112, 50, PLANE_PICK_TOL.mouse)).toBeNull();
    expect(nearestSheet(sheets, 190, 50, PLANE_PICK_TOL.touch)).toBe('right');   // a finger reaches further
    expect(nearestSheet(sheets, 150, 50, PLANE_PICK_TOL.touch)).toBeNull();
  });
  it('the nearer of two outlines wins', () => {
    expect(nearestSheet(sheets, 108, 50, 40)).toBe('front');
    expect(nearestSheet(sheets, 192, 50, 40)).toBe('right');
  });
  it('an edge-on sheet (zero area) is still tappable on its line', () => {
    const edgeOn: ScreenSheet[] = [{ id: 'top', poly: [[10, 50], [90, 50], [90, 50], [10, 50]] }];
    expect(nearestSheet(edgeOn, 50, 56, PLANE_PICK_TOL.mouse)).toBe('top');
    expect(nearestSheet(edgeOn, 50, 70, PLANE_PICK_TOL.mouse)).toBeNull();
    expect(nearestSheet(edgeOn, 50, 70, PLANE_PICK_TOL.touch)).toBe('top');
  });
  it('no sheets, no pick', () => { expect(nearestSheet([], 0, 0, 100)).toBeNull(); });
});

describe('RefPlanes in plane-picking mode', () => {
  const view = (rp: RefPlanes) => {
    const fills = (id: string) => { const g = rp.group.children.find((c) => c.children[0]?.userData.refPlane === id)!; return g.children[0] as THREE.Mesh; };
    return { fill: (id: string) => fills(id).material as THREE.MeshBasicMaterial, shown: (id: string) => fills(id).parent!.visible };
  };
  it('draws the three sheets with the axes, and the hovered one in orange and stronger', () => {
    const rp = new RefPlanes();
    rp.emphasis = true;
    rp.set(100, ['front', 'top', 'right'], 'top', labels);
    const v = view(rp);
    expect(rp.group.visible).toBe(true);
    expect(['front', 'top', 'right'].every(v.shown)).toBe(true);
    expect(v.fill('top').color.getHex()).toBe(0xe0801a);
    expect(v.fill('top').opacity).toBeGreaterThan(v.fill('front').opacity);
    expect(v.fill('front').opacity).toBeGreaterThan(0.07);   // stronger than the faint hint of an empty part
    expect(rp.group.children.some((c) => c.children.length >= 3 && c.children.every((x) => x instanceof THREE.Line))).toBe(true);   // the origin axes
  });
  it('without the mode the sheets stay faint', () => {
    const rp = new RefPlanes();
    rp.set(100, ['front', 'top', 'right'], null, labels);
    expect(view(rp).fill('front').opacity).toBe(0.07);
  });
  it('a ray hits the sheet it passes through, the nearest first', () => {
    const rp = new RefPlanes();
    rp.set(100, ['front', 'top', 'right'], null, labels);
    rp.group.updateMatrixWorld(true);
    const ray = (o: [number, number, number], d: [number, number, number]) => { const r = new THREE.Raycaster(); r.ray.set(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize()); return r; };
    expect(rp.pick(ray([10, 10, 30], [0, 0, -1]))).toBe('front');   // down onto the XY sheet
    expect(rp.pick(ray([10, 30, 10], [0, -1, 0]))).toBe('top');     // the XZ sheet is flat in Y
    expect(rp.pick(ray([30, 10, 10], [-1, 0, 0]))).toBe('right');
    expect(rp.pick(ray([500, 500, 30], [0, 0, -1]))).toBeNull();
  });
  it('projects the visible sheets to screen outlines for the fallback pick', () => {
    const rp = new RefPlanes();
    rp.set(100, ['front'], null, labels);
    const sheets = rp.screenSheets((p) => [p.x, p.y]);
    expect(sheets.map((s) => s.id)).toEqual(['front']);
    expect(sheets[0]!.poly.length).toBe(4);
    expect(rp.pickNear((p) => [p.x, p.y], 54, 0, 8)).toBe('front');   // 4 px outside the right edge of the 100 wide sheet
    expect(rp.pickNear((p) => [p.x, p.y], 90, 0, 8)).toBeNull();
  });
  it('hidden planes are not picked', () => {
    const rp = new RefPlanes();
    rp.set(100, [], null, labels);
    expect(rp.pickNear((p) => [p.x, p.y], 0, 0, 1000)).toBeNull();
  });
});
