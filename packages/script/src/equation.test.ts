import { describe, expect, it } from 'vitest';
import { evaluate } from './index';

describe('script equation curves (recording)', () => {
  it('records a spline entity that carries the formulas; the kernel makes the points', () => {
    const r = evaluate(`const v = variables({ R: 12 });
part('P').sketch('front', (s) => s.equation({ x: 'R*cos(t)', y: 'R*sin(t)', t: [0, 360], tol: 0.005, name: 'rim' })).extrude(3);`);
    expect(r.errors).toEqual([]);
    const sk = r.state.parts[0].steps[0].sk!;
    expect(sk.entities[0]).toEqual({ id: 'rim', type: 'spline', pts: [], equation: { x: 'R*cos(t)', y: 'R*sin(t)', t: [0, 360], tol: 0.005 } });
    expect(sk.pointList).toHaveLength(1);
    const r2 = evaluate(`const v = variables({ n: 2 }); part('P').sketch('front', (s) => s.equation({ x: 't', y: '0.1*t*t', t: [-10, expr('n*5')] }));`);
    expect(r2.errors).toEqual([]);
    expect((r2.state.parts[0].steps[0].sk!.entities[0] as { equation: { t: unknown[] } }).equation.t).toEqual([-10, '=n*5']);
  });
  it('rejects bad arguments with a readable message and the script line', () => {
    const bad = (src: string, re: RegExp) => { const r = evaluate(src); expect(r.errors[0]?.message).toMatch(re); expect(r.errors[0]?.line).toBe(1); };
    bad(`part('P').sketch('front', (s) => s.equation({ x: '', y: 't', t: [0, 1] }));`, /x and y are formulas/);
    bad(`part('P').sketch('front', (s) => s.equation({ x: 't', y: 't', t: [0] }));`, /t is \[start, end\]/);
    bad(`part('P').sketch('front', (s) => s.equation({ x: 't', y: 't', t: [0, 1], tol: 0 }));`, /tol/);
  });
});
