// A headless tool whose result is over the budget is summarised behind a handle instead of being cut (needs the kernel: CK_WASM).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentSession, ResultStore } from '@kit/agent-tools';
import { agentBackend } from './protocol';
import { withBridge } from './bridgeTools';
import { Bridge } from '@kit/agent-link';
import { benchScript } from '../bench/mcpBench';

let a: AgentSession;
beforeAll(async () => { a = await AgentSession.open({ wasmPath: process.env.CK_WASM }); await a.runScript(benchScript(60), 'new', { name: 'Big' }); }, 120000);
afterAll(async () => { await a.close(); delete process.env.CK_MCP_OUTPUT_BUDGET; });

describe('headless output budget', () => {
  it('tree over CK_MCP_OUTPUT_BUDGET comes back as a summary with a handle; fetch_result gives the rows; without a store the old cap applies', async () => {
    process.env.CK_MCP_OUTPUT_BUDGET = '2000';
    const store = new ResultStore();
    const backend = withBridge(agentBackend(a, undefined, { store }), new Bridge({ port: () => 1 }), { store });
    const r = await backend.call('tree', {});
    const text = (r.content.find((c) => c.type === 'text' && c.text.startsWith('{')) as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(2000);
    const j = JSON.parse(text);
    expect(j._budget).toMatchObject({ exceeded: true, maxChars: 2000 });
    expect(j.featureCount).toBe(120);
    const row = await backend.call('fetch_result', { handle: j._budget.handle, path: 'features.119' });
    expect(JSON.parse((row.content[0] as { text: string }).text).value).toMatchObject({ index: 119, type: 'extrude' });
    delete process.env.CK_MCP_OUTPUT_BUDGET;
    const old = await agentBackend(a).call('tree', {});
    expect(JSON.parse((old.content.find((c) => c.type === 'text' && c.text.startsWith('{')) as { text: string }).text)._budget).toBeUndefined();   // the 48000 cap: this fits
  });
});
