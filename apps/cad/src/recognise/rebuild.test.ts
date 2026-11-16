import { describe, expect, it } from 'vitest';
import { rebuildDropping, type Attempt } from './rebuild';
import type { Analysis } from './analyse';

const analysis = (): Analysis => ({
  script: "const p = part('From STEP');\nstock;\nhole A;\nhole B;\nhole C;\n", lineIds: ['stock', 'stock', 'holes/0', 'holes/1', 'holes/2'].slice(1),
  found: { holes: 3 }, handled: ['holes/0', 'holes/1', 'holes/2'], skipped: [], stock: 'box', fileVolume: 100, version: 'x',
});
// the script above has 5 lines; ids for line 1 (const p) and 2 (stock): build them properly
const make = (): Analysis => ({ ...analysis(), lineIds: ['stock', 'stock', 'holes/0', 'holes/1', 'holes/2'] });

describe('rebuildDropping', () => {
  it('returns the first build when it works', async () => {
    const out = await rebuildDropping(make(), async () => ({ ok: true, volume: 99, valid: true }));
    expect(out.rebuilt).toEqual({ ok: true, volume: 99, valid: true });
    expect(out.analysis.skipped).toEqual([]);
  });
  it('drops the line the kernel rejects, says so, and builds the rest', async () => {
    const seen: string[] = [];
    const out = await rebuildDropping(make(), async (script): Promise<Attempt> => {
      seen.push(script);
      const at = script.split('\n').indexOf('hole B;');
      return at >= 0 ? { ok: false, line: at + 1, message: 'no edge matches' } : { ok: true, volume: 90, valid: true };
    });
    expect(out.rebuilt).toEqual({ ok: true, volume: 90, valid: true });
    expect(out.analysis.script).not.toContain('hole B');
    expect(out.analysis.script).toContain('hole C');
    expect(out.analysis.handled).toEqual(['holes/0', 'holes/2']);
    expect(out.analysis.skipped).toEqual([{ id: 'holes/1', why: 'no edge matches', code: 'kernel', family: 'holes' }]);
    expect(seen.length).toBe(2);
  });
  it('gives up when the stock itself is rejected', async () => {
    const out = await rebuildDropping(make(), async () => ({ ok: false, line: 2, message: 'bad stock' }));
    expect(out.rebuilt).toEqual({ ok: false, message: 'bad stock' });
  });
  it('gives up when the error names no line', async () => {
    const out = await rebuildDropping(make(), async () => ({ ok: false, message: 'kernel trap' }));
    expect(out.rebuilt).toEqual({ ok: false, message: 'kernel trap' });
  });
  it('has nothing to try without a script', async () => {
    const out = await rebuildDropping({ ...make(), script: null }, async () => { throw new Error('not called'); });
    expect(out.rebuilt).toBeNull();
  });
});
