import { describe, expect, it } from 'vitest';
import { callTool, createTools, validate } from './index';

const tools = createTools();
const byName = (n: string) => tools.find((t) => t.name === n)!;
const bad = (name: string, input: unknown) => validate(byName(name).inputSchema, input);

describe('the readback tools are in the tool list', () => {
  it('measure, clearance, interference, thickness, draft and dfm sit beside bodies, read-only, with schemas that say what they take', () => {
    for (const n of ['measure', 'clearance', 'interference', 'thickness', 'draft', 'dfm', 'bodies']) {
      const t = byName(n);
      expect(t, n).toBeDefined();
      expect(t.inputSchema.additionalProperties, n).toBe(false);
    }
    expect(byName('measure').inputSchema.required).toEqual(['a', 'b']);
    expect(byName('dfm').inputSchema.required).toEqual(['process']);
    expect(byName('dfm').inputSchema.properties!.process.enum).toEqual(['injection', 'cnc', 'printing']);
  });
});

describe('input validation', () => {
  it('measure takes bodies, names and points, and needs both', () => {
    expect(bad('measure', { a: 'Base', b: 2 })).toEqual([]);
    expect(bad('measure', { a: [0, 0, 0], b: 'F2.C1' })).toEqual([]);
    expect(bad('measure', { a: ['F2.C1', 'F2.C2'], b: 'Lid' })).toEqual([]);
    expect(bad('measure', { a: 'Base' })).toEqual(['$.b: is required']);
    expect(bad('measure', { a: 'Base', b: { face: 'F1' } })[0]).toMatch(/matches none of the allowed shapes/);
    expect(bad('measure', { a: 0, b: 1 })[0]).toMatch(/matches none/);
    expect(bad('measure', { a: 'x', b: 'y', sample: 3 })[0]).toMatch(/did you mean samples\?/);
  });
  it('clearance, thickness, draft and dfm check their numbers and enums', () => {
    expect(bad('clearance', { required: -1 })[0]).toMatch(/>= 0/);
    expect(bad('clearance', { a: 1, b: 2, required: 0.2, within: 2, limit: 5 })).toEqual([]);
    expect(bad('thickness', { method: 'laser' })[0]).toMatch(/must be one of "ray", "sphere"/);
    expect(bad('thickness', { top: 0 })[0]).toMatch(/>= 1/);
    expect(bad('draft', { pull: '+Z', min: 2 })).toEqual([]);
    expect(bad('draft', { pull: [0, 0, 1] })).toEqual([]);
    expect(bad('draft', { pull: '+W' })[0]).toMatch(/matches none/);
    expect(bad('draft', { min: 120 })[0]).toMatch(/<= 90/);
    expect(bad('dfm', { process: 'welding' })[0]).toMatch(/one of "injection", "cnc", "printing"/);
    expect(bad('dfm', { process: 'injection', params: { draft: { minAngle: 2 } }, rules: ['draft'] })).toEqual([]);
  });
  it('callTool refuses bad input with the validation problems and does not touch the session', async () => {
    const r = await callTool(null as never, tools, 'measure', { a: 'Base' });
    expect(r.isError).toBe(true);
    expect(JSON.parse((r.content[0] as { text: string }).text).error).toMatchObject({ code: 'bad_input', message: '$.b: is required' });
  });
});
