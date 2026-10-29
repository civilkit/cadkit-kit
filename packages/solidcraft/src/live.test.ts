// Parameters of a converted file arrive as the part's variables, and a field written over them stays an expression. Synthetic documents only.
import { describe, expect, it } from 'vitest';
import { importSolidcraftDocument } from './import';
import { kernelExpr, namesIn, usableName } from './expr';

type Rec = Record<string, any>;
const sketch = (id: number, constraints: Rec[] = []) => ({
  id, name: `S${id}`, type: 'sketch', suppressed: false, plane: { type: 'origin', name: 'XY' },
  sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'p1', pos: [0, 0] }, { id: 'p2', pos: [10, 0] }, { id: 'p3', pos: [10, 10] }, { id: 'p4', pos: [0, 10] }],
    curves: [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'l2', type: 'line', a: 2, b: 3 }, { id: 'l3', type: 'line', a: 3, b: 4 }, { id: 'l4', type: 'line', a: 4, b: 1 }],
    constraints: [{ id: 'k1', type: 'coincident', p: 0, q: 1 }, ...constraints] },
});
const extrude = (id: number, sk: number, distance: unknown, over: Rec = {}) => ({ id, name: `E${id}`, type: 'extrude', suppressed: false, sketch: sk, profiles: { type: 'all' }, operation: 'new_body', extent: { convention: 'total_distance', direction: 'positive', distance }, ...over });
const run = async (params: Rec[], features: unknown[]) => {
  const r = await importSolidcraftDocument({ format: 'solidcraft/33', units: 'mm', params, features }, 'p');
  return { r, f: (r.part?.features ?? []) as Rec[], part: r.part as Rec };
};

describe('expression text for the part', () => {
  const names = new Set(['w', 't']);
  it('writes units out as numbers, keeps names, and refuses what the part cannot hold', () => {
    expect(kernelExpr('w / 2 - t', names)).toBe('w/2-t');
    expect(kernelExpr('t + 14 mm', names)).toBe('t+14');
    expect(kernelExpr('2 cm + w', names)).toBe('20+w');
    expect(kernelExpr('=sqrt(w ^ 2 + t ^ 2)', names)).toBe('sqrt(w^2+t^2)');
    expect(kernelExpr('2 * pi', names)).toBe('2*pi');
    expect(kernelExpr('max(w, t)', names)).toBe('max(w,t)');
    expect(kernelExpr('min(w, 2 cm, sqrt(t)) + round(t / 3)', names)).toBe('min(w,20,sqrt(t))+round(t/3)');
    expect(kernelExpr('atan2(w, t) + hypot(3, 4) + pow(2, t) + mod(w, 7) + floor(w) + ceil(w) + trunc(w) + exp(t) + ln(w) + log10(w) + asin(0.5) + acos(0.5) + atan(1)', names)).toBe('atan2(w,t)+hypot(3,4)+pow(2,t)+mod(w,7)+floor(w)+ceil(w)+trunc(w)+exp(t)+ln(w)+log10(w)+asin(0.5)+acos(0.5)+atan(1)');
    expect(kernelExpr('sqrt(w, t)', names)).toBeNull();   // a comma outside the calls that take several arguments
    expect(kernelExpr('(w, t)', names)).toBeNull();
    expect(kernelExpr('log(w)', names)).toBeNull();   // not in the part's grammar
    expect(kernelExpr('sign(w)', names)).toBeNull();
    expect(kernelExpr('max(w, 1', names)).toBe('max(w,1');   // unbalanced text is the evaluator's to refuse, not this function's
    expect(kernelExpr('w + other', names)).toBeNull();
    expect(kernelExpr(5, names)).toBe('5');
  });
  it('lists the names an expression uses and the names the part can take', () => {
    expect(namesIn('w * sqrt(t) + pi')).toEqual(['w', 't']);
    expect(usableName('width_2')).toBe(true);
    for (const bad of ['in', 'MM', 'Sin', 'pi', '2x', 'a b', 'ünï']) expect(usableName(bad), bad).toBe(false);
  });
});

describe('variables and live fields', () => {
  const params = [{ name: 'width', expr: '40 mm' }, { name: 'thickness', expr: 'width / 5' }, { name: 'tall', expr: 'max(width, 3)' }];
  it('the parameter table becomes the part\'s variables, a grammar-held expression kept as written for the part', async () => {
    const { part } = await run(params, [sketch(1), extrude(2, 1, '5')]);
    expect(part.variables).toEqual([{ name: 'width', expr: '40' }, { name: 'thickness', expr: 'width/5' }, { name: 'tall', expr: 'max(width,3)' }]);
  });
  it('a depth that is a plain name or a simple expression stays an expression; a plain number stays a number', async () => {
    const a = await run(params, [sketch(1), extrude(2, 1, 'thickness')]);
    expect(a.f.find((x) => x.type === 'extrude')).toMatchObject({ depth: '=thickness' });
    const b = await run(params, [sketch(1), extrude(2, 1, 'width / 2 - thickness + 3 mm')]);
    expect(b.f.find((x) => x.type === 'extrude')).toMatchObject({ depth: '=width/2-thickness+3' });
    const c = await run(params, [sketch(1), extrude(2, 1, '12 mm')]);
    expect(c.f.find((x) => x.type === 'extrude')!.depth).toBe(12);
  });
  it('functions the part has stay live, however many arguments they take', async () => {
    const { f, part } = await run([...params, { name: 'big', expr: 'max(width, 3) / 4' }], [sketch(1), extrude(2, 1, 'min(max(width, 3) / 4, thickness + 20)')]);
    expect(f.find((x) => x.type === 'extrude')!.depth).toBe('=min(max(width,3)/4,thickness+20)');
    expect(part.variables.find((v: Rec) => v.name === 'big').expr).toBe('max(width,3)/4');
  });
  it('what the grammar cannot hold stays a number and the row says so', async () => {
    const { f, r } = await run([{ name: 'sin', expr: '3' }, ...params], [sketch(1), extrude(2, 1, 'sin + width / 4')]);
    expect(f.find((x) => x.type === 'extrude')!.depth).toBe(13);
    expect(r.rows[1].notes?.[0]).toMatch(/extrude distance.*kept as the number 13/);
    expect(r.rows[1].status).toBe('converted');
  });
  it('a parameter whose name the part cannot take is not a variable, and fields using it are numbers with a note', async () => {
    const { part, r } = await run([{ name: 'in', expr: '6' }, { name: 'ok', expr: '2' }], [sketch(1), extrude(2, 1, 'in + ok')]);
    expect(part.variables).toEqual([{ name: 'ok', expr: '2' }]);
    expect(part.features.find((x: Rec) => x.type === 'extrude').depth).toBe(8);
    expect(r.rows[1].notes?.length).toBe(1);
  });
  it('a dimension that names a parameter holding its value is driven by it; one that does not match is left alone', async () => {
    const dims = [{ id: 'k2', type: 'length', l: 0, value: 40, param: 'width' }, { id: 'k3', type: 'length', l: 1, value: 7, param: 'width' }];
    const { f } = await run(params, [sketch(1, dims), extrude(2, 1, '5')]);
    const [a, b] = f.find((x) => x.type === 'sketch')!.constraints.filter((c: Rec) => c.type === 'distance');
    expect(a).toMatchObject({ value: 40, expr: '=width' });
    expect(b.expr).toBeUndefined();
  });
  it('fillet radius, hole size and the others take expressions too', async () => {
    const box = { id: 1, name: 'Plate', type: 'box', suppressed: false, corner: [0, 0, 0], length: 40, width: 40, height: 20, operation: 'new_body' };
    const hole = { id: 2, name: 'H', type: 'hole', suppressed: false, diameter: 'thickness', depth: 'thickness * 2', direction: [0, 0, -1], hole: { type: 'simple' }, position: [10, 10, 20] };
    const { f } = await run(params, [box, hole]);
    expect(f.find((x) => x.type === 'hole')).toMatchObject({ diameter: '=thickness', depth: '=thickness*2', end: 'blind' });
  });
  it('a file without parameters has no variables', async () => {
    const { part } = await run([], [sketch(1), extrude(2, 1, '5')]);
    expect(part.variables).toBeUndefined();
  });
});
