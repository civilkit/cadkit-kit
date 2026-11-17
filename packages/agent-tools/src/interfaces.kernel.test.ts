import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentSession, callTool, createTools } from './index';
import { placeholderSnapshot } from './testing/placeholder-snapshot';

const tools = createTools();
let a: AgentSession;
beforeAll(async () => { a = await AgentSession.open({ wasmPath: process.env.CK_WASM, snapshotFn: placeholderSnapshot as never }); }, 60000);
afterAll(async () => { await a.close(); });
const call = async (name: string, args: unknown = {}) => {
  const r = await callTool(a, tools, name, args);
  const t = r.content.find((c) => c.type === 'text' && c.text.trim().startsWith('{')) as { text: string } | undefined;
  return { r, json: t ? JSON.parse(t.text) : null };
};

describe('interfaces on the real kernel', () => {
  it('a plate with a row of holes and a bolt circle: unique holes, the patterns, the planes, exact numbers', async () => {
    const run = await call('run_script', { mode: 'new', code: `const p = part('Plate');
p.sketch('front', (s) => s.rect(80, 50)).extrude(10);
p.sketch('front', (s) => { for (const x of [-30, -20, -10]) s.circle(3, [x, -15]); s.circle(8, [25.125, 12]); }).cut(10);` });
    expect(run.json.errors).toEqual([]);
    const { json, r } = await call('interfaces', { kinds: ['holes', 'planes'] });
    expect(r.isError, JSON.stringify(json)).toBeFalsy();
    expect(json.holesTotal).toBe(4);
    const big = json.holes.find((h: any) => h.radius === 8);
    expect(big.point[0]).toBeCloseTo(25.125, 6); expect(big.point[1]).toBeCloseTo(12, 6); expect(big.axis).toEqual([0, 0, 1]);
    expect(big.point[0]).not.toBe(25.1);                                    // not rounded
    expect(big.length).toBeCloseTo(10, 6);
    const row = json.holePatterns.find((p: any) => p.type === 'linear');
    expect(row.count).toBe(3); expect(row.pitch).toBeCloseTo(10, 6);
    // the two big faces (top and bottom, minus the holes) and four sides: six unique planes
    expect(json.planesTotal).toBe(6);
    expect(json.planes[0].faceCount).toBe(1);
    expect(json.precision.axisAlignedDirections).toBe('exact');
  });

  it('two boxes side by side: the contact face (opposite normals on one plane), and a frame at the centre of mass of each', async () => {
    const run = await call('run_script', { mode: 'new', code: `const p = part('Pair');
p.sketch('front', (s) => s.rect(20, 20)).extrude(10);
const base = p.handle();
p.sketch('front', (s) => s.rect(10, 10, [15, 0])).extrude(10, { newBody: 'Peg' });
p.bodyName(base, 'Base');` });
    expect(run.json.errors).toEqual([]);
    expect(run.json.solids).toBe(2);
    const { json } = await call('interfaces', { kinds: ['contacts', 'frames'] });
    expect(json.contacts).toHaveLength(1);
    expect(json.contacts[0]).toMatchObject({ bodies: ['Base', 'Peg'], normal: [1, 0, 0] });
    expect(json.contacts[0].offset).toBeCloseTo(10, 9);
    expect(json.contacts[0].areaUpperBound).toBeCloseTo(100, 6);             // the smaller face: the Peg's 10 x 10
    const com = Object.fromEntries(json.frames.filter((f: any) => f.body).map((f: any) => [f.body, f.origin]));
    expect(com.Base[0]).toBeCloseTo(0, 6); expect(com.Peg[0]).toBeCloseTo(15, 6); expect(com.Peg[2]).toBeCloseTo(5, 6);
    expect((await call('interfaces', { kinds: ['frames'], component: 'Peg' })).json.frames.map((f: any) => f.id)).toEqual(['world', 'com:Peg']);
  });
});
