import { describe, expect, it } from 'vitest';
import { Interpreter } from './interpreter';

const scratch = { async build() { return []; } };
/** the plane `sketch.create` gives, read back from the script the interpreter writes (Z-up frame: the numbers are the plugin's own) */
const planeOf = (args: Record<string, unknown>): { origin: number[]; normal: number[]; xdir: number[] } => {
  const I = new Interpreter(scratch);
  I.runSync('sketch.create', { name: 'S', ...args });
  I.runSync('sketch.line', { points: [[0, 0], [1, 0], [1, 1]], closed: true });
  I.runSync('sketch.finish', {});
  I.runSync('solid.extrude', { distance: 2, name: 'E' });
  const m = /at\(\{ origin: \[([^\]]*)\], normal: \[([^\]]*)\], xdir: \[([^\]]*)\] \}\)/.exec(I.script());
  if (!m) throw new Error(I.script());
  const v = (s: string) => s.split(',').map(Number);
  return { origin: v(m[1]), normal: v(m[2]), xdir: v(m[3]) };
};

describe('sketch.create planes, as SolidCraft reads them', () => {
  it('names the origin planes with SolidCraft\'s axes (XY: x +X, normal +Z; XZ: x +X, y -Z, normal +Y; YZ: x +Y, normal +X), in any case, and Top/Front/Right too', () => {
    expect(planeOf({ plane: 'XY' })).toEqual({ origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] });
    expect(planeOf({ plane: 'xz' })).toEqual({ origin: [0, 0, 0], normal: [0, 1, 0], xdir: [1, 0, 0] });
    expect(planeOf({ plane: 'YZ' })).toEqual({ origin: [0, 0, 0], normal: [1, 0, 0], xdir: [0, 1, 0] });
    expect(planeOf({ plane: 'Top' })).toEqual(planeOf({ plane: 'XY' }));
    expect(planeOf({ plane: 'Front' })).toEqual(planeOf({ plane: 'XZ' }));
    expect(planeOf({ plane: 'Right' })).toEqual(planeOf({ plane: 'YZ' }));
    expect(planeOf({})).toEqual(planeOf({ plane: 'XY' }));
  });
  it('offset moves the plane along its normal, an expression too', () => {
    expect(planeOf({ plane: 'XY', offset: 2 }).origin).toEqual([0, 0, 2]);
    expect(planeOf({ plane: 'XZ', offset: -3 }).origin).toEqual([0, -3, 0]);
    expect(planeOf({ plane: 'YZ', offset: '2 * 4' }).origin).toEqual([8, 0, 0]);
  });
  it('flip turns the plane over: true keeps y up where it can, "x" and "y" name the axis; the offset still goes along the unflipped normal', () => {
    expect(planeOf({ plane: 'XY', flip: true }).normal).toEqual([0, 0, -1]);   // y is horizontal: a turn about x
    expect(planeOf({ plane: 'XZ', flip: true }).normal).toEqual([0, -1, 0]);   // y is -Z (down): about x
    expect(planeOf({ plane: 'YZ', flip: true })).toMatchObject({ normal: [-1, 0, 0], xdir: [0, -1, 0] });   // y is +Z (up): about y, x reversed
    expect(planeOf({ plane: 'XY', flip: 'y' })).toMatchObject({ normal: [0, 0, -1], xdir: [-1, 0, 0] });
    expect(planeOf({ plane: 'XY', flip: 'x', offset: 5 })).toMatchObject({ origin: [0, 0, 5], normal: [0, 0, -1], xdir: [1, 0, 0] });
    expect(() => planeOf({ plane: 'XY', flip: 'z' })).toThrow(/flip/);
  });
  it('an explicit plane: origin (default 0), x_dir and y_dir (made orthonormal), or a normal (x = Z cross n, +X for a horizontal plane)', () => {
    expect(planeOf({ plane: { origin: [1, 2, 3], x_dir: [0, 2, 0], y_dir: [0, 0, 5] } })).toEqual({ origin: [1, 2, 3], normal: [1, 0, 0], xdir: [0, 1, 0] });
    expect(planeOf({ plane: { x_dir: [1, 0, 0], y_dir: [1, 1, 0] } })).toEqual({ origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] });
    expect(planeOf({ plane: { origin: [0, 0, 4], normal: [0, 0, 1] } })).toEqual({ origin: [0, 0, 4], normal: [0, 0, 1], xdir: [1, 0, 0] });
    expect(planeOf({ plane: { normal: [1, 0, 0] } })).toMatchObject({ normal: [1, 0, 0], xdir: [0, 1, 0] });
    expect(planeOf({ plane: { origin: [0, 0, 0], x_dir: [1, 0, 0], y_dir: [0, 1, 0] }, offset: 1 }).origin).toEqual([0, 0, 1]);
    expect(() => planeOf({ plane: { x_dir: [1, 0, 0], y_dir: [2, 0, 0] } })).toThrow(/degenerate/);
    expect(() => planeOf({ plane: { origin: [0, 0, 0] } })).toThrow(/x_dir and y_dir, or normal/);
  });
  it('refuses a construction plane or a face with a clear message (the document has neither here)', () => {
    expect(() => planeOf({ plane: 'Mid plane' })).toThrow(/construction plane/);
    expect(() => planeOf({ plane: { face: [0, 0, 5] } })).toThrow(/face/);
  });
  it('in a Y-up document the plane turns with the frame: the XZ normal (plugin +Y) is document -Z', () => {
    const I = new Interpreter(scratch);
    I.runSync('sketch.create', { name: 'S', plane: 'XZ', offset: 3 });
    I.runSync('sketch.line', { points: [[0, 0], [4, 0], [4, 4]], closed: true });
    I.runSync('sketch.finish', {});
    I.runSync('solid.extrude', { distance: 2, name: 'E', body_name: 'B' });
    expect(I.script({ up: 'y' })).toContain('normal: [0,0,-1]');
  });
});

describe('the sketch the user has open', () => {
  const square = [{ type: 'line' as const, a: [0, 0] as [number, number], b: [10, 0] as [number, number] }, { type: 'line' as const, a: [10, 0] as [number, number], b: [10, 10] as [number, number] }, { type: 'line' as const, a: [10, 10] as [number, number], b: [0, 10] as [number, number] }, { type: 'line' as const, a: [0, 10] as [number, number], b: [0, 0] as [number, number] }];
  it('sketch.inspect with no arguments answers with it, as a closed profile', () => {
    const I = new Interpreter(scratch, { openSketch: { name: 'Sketch 1', curves: square } });
    const r = I.runSync('sketch.inspect', {}) as { name: string; curves: unknown[]; profiles?: Array<{ area_mm2: number }> };
    expect(r.name).toBe('Sketch 1');
    expect(r.curves).toHaveLength(4);
    expect(r.profiles?.[0].area_mm2).toBeCloseTo(100, 6);
  });
  it('sketch.inspect finds it by the id selection.get hands out (0) and by its name, next to one the run made', () => {
    const I = new Interpreter(scratch, { openSketch: { name: 'Sketch 1', curves: square } });
    expect((I.runSync('sketch.inspect', { sketch: 0 }) as { name: string }).name).toBe('Sketch 1');
    expect((I.runSync('sketch.inspect', { sketch: '0' }) as { name: string }).name).toBe('Sketch 1');
    expect((I.runSync('sketch.inspect', { sketch: 'Sketch 1' }) as { curves: unknown[] }).curves).toHaveLength(4);
    expect(() => I.runSync('sketch.inspect', { sketch: 'nope' })).toThrow(/no sketch/);
  });
  it('sketch.line draws into it, and only what the run added comes back', () => {
    const I = new Interpreter(scratch, { openSketch: { name: 'Sketch 1', curves: square } });
    I.runSync('sketch.line', { points: [[2, 2], [4, 2], [4, 4]], closed: true });
    const adds = I.hostAdds();
    expect(adds).toHaveLength(3);
    expect(adds[0]).toEqual({ type: 'line', a: [2, 2], b: [4, 2] });
  });
  it('without an open sketch the same call still says no sketch is open', () => {
    const I = new Interpreter(scratch);
    expect(() => I.runSync('sketch.inspect', {})).toThrow(/no sketch is open/);
    expect(() => I.runSync('sketch.line', { points: [[0, 0], [1, 1]] })).toThrow(/no sketch is open/);
  });
  it('reads a rounded outline (lines and arcs) as one closed profile, with the arcs counted in the area', () => {
    // a 10 x 10 square with the right side bulging out through (15, 5): area 100 + a circular segment
    const curves = [
      { type: 'line' as const, a: [0, 0] as [number, number], b: [10, 0] as [number, number] },
      { type: 'arc' as const, a: [10, 0] as [number, number], b: [10, 10] as [number, number], through: [15, 5] as [number, number] },
      { type: 'line' as const, a: [10, 10] as [number, number], b: [0, 10] as [number, number] },
      { type: 'line' as const, a: [0, 10] as [number, number], b: [0, 0] as [number, number] },
    ];
    const I = new Interpreter(scratch, { openSketch: { name: 'S', curves } });
    const r = I.runSync('sketch.inspect', {}) as { curves: Array<{ type: string }>; profiles?: Array<{ area_mm2: number }> };
    expect(r.curves.map((c) => c.type)).toEqual(['line', 'arc', 'line', 'line']);
    expect(r.profiles).toHaveLength(1);
    expect(r.profiles![0].area_mm2).toBeGreaterThan(100);
  });
  it('a circle is its own profile; an open outline has none', () => {
    const I = new Interpreter(scratch, { openSketch: { name: 'S', curves: [{ type: 'circle', c: [0, 0], r: 5 }, { type: 'line', a: [20, 0], b: [30, 0] }, { type: 'line', a: [30, 0], b: [30, 10] }] } });
    const r = I.runSync('sketch.inspect', {}) as { profiles?: Array<{ area_mm2: number }> };
    expect(r.profiles).toHaveLength(1);
    expect(r.profiles![0].area_mm2).toBeCloseTo(Math.PI * 25, 4);
  });
  it('arcs and circles a plugin draws come back as arcs and circles', () => {
    const I = new Interpreter(scratch, { openSketch: { name: 'S', curves: [] } });
    I.runSync('sketch.arc.three_point', { start: [0, 0], end: [4, 0], through: [2, 2] });
    I.runSync('sketch.circle.center', { center: [10, 10], radius: 3 });
    const adds = I.hostAdds();
    expect(adds.map((a) => a.type)).toEqual(['arc', 'circle']);
    expect(adds[1]).toMatchObject({ type: 'circle', c: [10, 10], r: 3 });
  });
  it('selection.get names the curves and points picked in the sketch, with the ids sketch.inspect uses', () => {
    const I = new Interpreter(scratch, { openSketch: { name: 'S', curves: square, picked: { curves: [1, 2], points: [[10, 10]] } } });
    const insp = I.runSync('sketch.inspect', {}) as { id: number; curves: Array<{ id: string }>; points: Array<{ id: string; at: number[] }> };
    const sel = I.runSync('selection.get', { detail: true }) as { items: Array<Record<string, unknown>> };
    const curveItems = sel.items.filter((i) => i.type === 'sketch_curve');
    expect(curveItems.map((i) => i.id)).toEqual([insp.curves[1].id, insp.curves[2].id]);
    expect(curveItems.every((i) => i.sketch === insp.id)).toBe(true);
    const pt = sel.items.find((i) => i.type === 'point') as { id: string; sketch: number };
    expect(insp.points.find((p) => p.id === pt.id)?.at).toEqual([10, 10]);
    expect(pt.sketch).toBe(insp.id);
  });
  it('with nothing picked in the sketch selection.get has no sketch items', () => {
    const I = new Interpreter(scratch, { openSketch: { name: 'S', curves: square } });
    expect((I.runSync('selection.get', {}) as { items: unknown[] }).items).toEqual([]);
  });
});
