// A hex bolt placed on a plate stays a body of its own: its head is made as a separate body and united into the shank by name, so it never fuses with the plate (issue 64).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentSession, callTool, createTools } from '../../agent-tools/src';
import { placeholderSnapshot } from '../../agent-tools/src/testing/placeholder-snapshot';

const tools = createTools();
let a: AgentSession;
beforeAll(async () => { a = await AgentSession.open({ wasmPath: process.env.CK_WASM, snapshotFn: placeholderSnapshot as never }); }, 60000);
afterAll(async () => { await a.close(); });
const call = async (name: string, args: unknown = {}) => {
  const r = await callTool(a, tools, name, args);
  const text = r.content.find((c) => c.type === 'text' && c.text.trim().startsWith('{')) as { text: string } | undefined;
  return text ? JSON.parse(text.text) : null;
};
interface Body { name: string; volume: number }
async function bodiesOf(code: string): Promise<{ run: any; bodies: Body[] }> {
  const run = await call('run_script', { code, mode: 'new' });
  return { run, bodies: run?.ok ? (await call('bodies')).bodies as Body[] : [] };
}

describe('screw(): a hex head stays out of the part it sits on', () => {
  const plate = `const p = part('Plate').sketch('front', (s) => s.rect(40, 30)).extrude(4, { newBody: 'Plate' });\n`;
  it('one hex bolt on a plate: two bodies, the bolt in one piece', async () => {
    const { run, bodies } = await bodiesOf(plate + `p.screw({ size: 'M5', length: 10, head: 'hex', origin: [0, 0, 4], axis: [0, 0, -1] });`);
    expect(run?.ok).toBe(true);
    expect(bodies.map((b) => b.name).sort()).toEqual(['Plate', 'Screw']);
    const bolt = bodies.find((b) => b.name === 'Screw')!;
    expect(bolt.volume).toBeGreaterThan(200);   // shank plus the hex head, both in the one body
  }, 120_000);
  it('two hex bolts each keep their own body and name', async () => {
    const { run, bodies } = await bodiesOf(plate + `p.screw({ size: 'M5', length: 10, head: 'hex', origin: [-10, 0, 4], axis: [0, 0, -1] });\np.screw({ size: 'M5', length: 10, head: 'hex', origin: [10, 0, 4], axis: [0, 0, -1] });`);
    expect(run?.ok).toBe(true);
    expect(bodies.map((b) => b.name).sort()).toEqual(['Plate', 'Screw', 'Screw 2']);
  }, 120_000);
});
