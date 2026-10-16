import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentSession, callTool, createTools } from './index';
import { placeholderSnapshot } from './testing/placeholder-snapshot';

const tools = createTools();
let a: AgentSession;
beforeAll(async () => { a = await AgentSession.open({ wasmPath: process.env.CK_WASM, snapshotFn: placeholderSnapshot as never }); }, 60000);
afterAll(async () => { await a.close(); });
const call = async (name: string, args: unknown = {}) => {
  const r = await callTool(a, tools, name, args);
  const text = r.content.find((c) => c.type === 'text' && c.text.trim().startsWith('{')) as { text: string } | undefined;
  return { r, json: text ? JSON.parse(text.text) : null };
};

describe('run_script: warnings, read-backs and expectations', () => {
  it('returns warnings (ambiguous face, flipped cut) and runs awaited read-backs', async () => {
    const { json } = await call('run_script', { mode: 'new', code: `const p = part('W').sketch('front', (s) => s.rect(60, 40)).extrude(10)
  .sketch(face('>Z'), (s) => s.circle(12)).extrude(15)
  .hole(face('>Z'), [0, 0], { diameter: 6 })
  .sketch('front', (s) => s.circle(3, [25, 0])).cut(4);
const v = await p.volume();
if (!(v > 20000)) throw new Error('volume ' + v);
p.expectValid();` });
    expect(json.errors).toEqual([]);
    expect(json.ok).toBe(true);
    const msgs = json.warnings.map((w: { message: string }) => w.message);
    expect(msgs.some((m: string) => m.includes("face('>Z') resolved to"))).toBe(true);
    expect(msgs).toContain('cut direction flipped automatically');
  });
  it('a failed expectation is an error with its line and leaves the open document alone', async () => {
    const before = a.doc.features.length;
    const { json } = await call('run_script', { mode: 'new', code: `part('X').sketch('front', (s) => s.rect(10, 10)).extrude(10)
  .expectVolume(999, { tol: 1e-6 });` });
    expect(json.ok).toBe(false);
    expect(json.errors[0].line).toBe(2);
    expect(json.errors[0].message).toMatch(/expected volume 999/);
    expect(a.doc.features.length).toBe(before);
  });
});
