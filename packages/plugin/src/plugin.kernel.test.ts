// The Case generator as an agent tool on a real kernel: the same enclosure as the Case wizard (guide numbers of case.kernel.test.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentSession, callTool, createTools } from '@kit/agent-tools';
import { placeholderSnapshot } from '../../agent-tools/src/testing/placeholder-snapshot';
import { builtinRegistry } from './index';
import { pluginTools } from '../../plugin-tools/src';

let a: AgentSession;
const tools = [...createTools(), ...pluginTools(builtinRegistry())];
beforeAll(async () => { a = await AgentSession.open({ wasmPath: process.env.CK_WASM, snapshotFn: placeholderSnapshot as never }); }, 60000);
afterAll(async () => { await a.close(); });
const call = async (name: string, args: unknown = {}) => {
  const r = await callTool(a, tools, name, args);
  const text = r.content.find((c) => c.type === 'text' && c.text.trim().startsWith('{')) as { text: string } | undefined;
  return { r, json: text ? JSON.parse(text.text) : null };
};

describe('plugin tools on the kernel', () => {
  it('plugin_list names the plugin, its generator and tool', async () => {
    const { json } = await call('plugin_list');
    expect(json.plugins[0]).toMatchObject({ id: 'civilkit.enclosures', builtin: true });
    expect(json.plugins[0].generators[0].tool).toBe('plugin_civilkit_enclosures_case');
  });

  it('the Case generator builds the wizard\'s guide case: two valid bodies, 28 882.24 mm3, one undo step', async () => {
    await a.setDocument((await import('@ck/part-model')).emptyPart('Plugin test') as never, 'open', false);
    const before = a.historyInfo().length;
    const { r, json } = await call('plugin_civilkit_enclosures_case', { lidHeight: 15, tongueHeight: 1.5 });
    expect(r.isError, JSON.stringify(json)).toBeFalsy();
    expect(json.ok).toBe(true);
    expect(json.plugin).toMatchObject({ plugin: 'civilkit.enclosures@0.1.0', generator: 'case' });
    expect(json.errors).toEqual([]);
    const b = (await call('bodies')).json;
    expect(b.bodies.map((x: { name: string }) => x.name).sort()).toEqual(['Base', 'Lid']);
    expect(Math.abs(json.volume - 28882.24)).toBeLessThan(0.5);
    expect(json.validity?.ok ?? json.valid).not.toBe(false);
    expect(a.historyInfo().length).toBe(before + 1);   // one undo step
    await a.undo();
    expect(a.doc.features).toHaveLength(0);
  }, 120000);

  it('a second run keeps the first (attach, replace none) and a bad parameter is refused before anything is built', async () => {
    await a.setDocument((await import('@ck/part-model')).emptyPart('Plugin test 2') as never, 'open', false);
    expect((await call('plugin_civilkit_enclosures_case', { name: 'x' })).r.isError).toBe(true);   // schema: additionalProperties false
    const bad = await call('plugin_civilkit_enclosures_case', { wall: 0.1 });
    expect(bad.r.isError).toBe(true);
    expect(a.doc.features).toHaveLength(0);
    const one = await call('plugin_civilkit_enclosures_case', { baseName: 'B1', lidName: 'L1', x: -100 });
    const two = await call('plugin_civilkit_enclosures_case', { baseName: 'B2', lidName: 'L2', x: 100 });
    expect(one.json.ok && two.json.ok, JSON.stringify([one.json.errors, two.json.errors])).toBe(true);
    const names = (await call('bodies')).json.bodies.map((x: { name: string }) => x.name).sort();
    expect(names).toEqual(['B1', 'B2', 'L1', 'L2']);
  }, 120000);

  const sweepNames = () => (a.doc.features as unknown as Array<{ type: string; name?: string }>).filter((f) => f.type === 'sweep').map((f) => f.name);
  it('the Spring generator: two plain springs get their own names, one undo step each, valid body', async () => {
    await a.setDocument((await import('@ck/part-model')).emptyPart('Plugin springs') as never, 'open', false);
    const before = a.historyInfo().length;
    const one = await call('plugin_civilkit_springs_spring', {});
    const two = await call('plugin_civilkit_springs_spring', { x: 30 });
    expect(one.json.ok && two.json.ok, JSON.stringify([one.json.errors, two.json.errors])).toBe(true);
    expect(sweepNames()).toEqual(['Spring', 'Spring 2']);
    expect(a.historyInfo().length).toBe(before + 2);
    expect(two.json.validity?.ok ?? two.json.valid).not.toBe(false);
  }, 240000);

  // the kernel is slow on sweeps once a document holds several (the wizard's own tests allow 180 s), so the other kinds get a fresh document and one run each
  it('an extension spring ignores parameters that belong to another kind', async () => {
    await a.setDocument((await import('@ck/part-model')).emptyPart('Plugin ext') as never, 'open', false);
    const r = await call('plugin_civilkit_springs_spring', { kind: 'extension', ends: 'ground', closedTurns: 3, length: 999 });
    expect(r.json.ok, JSON.stringify(r.json.errors ?? r.json)).toBe(true);
    expect(sweepNames()).toEqual(['Spring']);
  }, 240000);
});
