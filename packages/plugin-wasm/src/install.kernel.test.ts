// @vitest-environment node
// A packed woodwork plugin (zip from tools/plugin_wasm_pack.mjs) installed through the PluginManager and run as a generator on the kernel.
// Run:  CK_WASM=<gated wasm> CK_WOODWORK_ZIP=<packed zip> npx vitest run packages/plugin-wasm/src/install
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PluginManager, PluginRegistry, filesFromZip, memoryStore, contextOf } from '@kit/plugin';
import { AgentSession } from '../../agent-tools/src';
import { placeholderSnapshot } from '../../agent-tools/src/testing/placeholder-snapshot';
import { listBodies } from '../../agent-tools/src/bodies';
import { wasmGenerators } from './package';

const ZIP = process.env.CK_WOODWORK_ZIP;
const on = !!(process.env.CK_WASM && ZIP);
let session: AgentSession;
beforeAll(async () => { if (on) session = await AgentSession.open({ wasmPath: process.env.CK_WASM, snapshotFn: placeholderSnapshot as never }); }, 120_000);
afterAll(async () => { await session?.close(); });

describe.skipIf(!on)('wasm package install', () => {
  it('plans, installs, runs the cabinet generator and builds the bodies', async () => {
    const m = new PluginManager({ registry: new PluginRegistry(), store: memoryStore(), appVersion: '1.0.0', wasm: (p) => wasmGenerators(p) });
    const files = await filesFromZip(new Uint8Array(readFileSync(ZIP!)));
    expect(files).toBeInstanceOf(Map);
    const plan = await m.plan(files as Map<string, Uint8Array>);
    expect(plan.inspection.errors).toEqual([]);
    expect(plan.inspection.warnings.join(' ')).toContain('WebAssembly');
    await m.install(plan, { kind: 'zip', name: 'woodwork.zip' });
    const p = await m.registry.prepare('tomasdjo.woodwork', 'cabinet', { material: 'none', shelf_pins: true }, contextOf([]));
    expect(p.ok).toBe(true);
    const script = (p as { script: string }).script;
    const rep = await session.runScript(script, 'new');
    expect(rep.errors).toEqual([]);
    const names = (await listBodies(session)).map((b) => b.name);
    expect(names).toContain('Cabinet Side L');
    expect(names.length).toBe(6);
  }, 120_000);
  it('the corner cabinet runs too: an L of panels, both legs, standing up in a Y-up document', async () => {
    const m = new PluginManager({ registry: new PluginRegistry(), store: memoryStore(), appVersion: '1.0.0', wasm: (p) => wasmGenerators(p) });
    await m.install(await m.plan((await filesFromZip(new Uint8Array(readFileSync(ZIP!)))) as Map<string, Uint8Array>), { kind: 'zip', name: 'woodwork.zip' });
    const p = await m.registry.prepare('tomasdjo.woodwork', 'corner', { material: 'none' }, contextOf([], { up: 'y' }));
    expect(p.ok, p.ok ? '' : p.message).toBe(true);
    const rep = await session.runScript((p as { script: string }).script, 'new');
    expect(rep.errors).toEqual([]);
    const rows = await listBodies(session);
    expect(rows.length).toBeGreaterThan(6);
    const lo = [0, 1, 2].map((i) => Math.min(...rows.map((b) => b.bbox!.min[i]))), hi = [0, 1, 2].map((i) => Math.max(...rows.map((b) => b.bbox!.max[i])));
    expect(hi.map((v, i) => Math.round(v - lo[i]))).toEqual([900, 720, 900]);   // 900 along the back, 720 high (Y), 900 return
  }, 120_000);
  it('refuses a tampered package', async () => {
    const m = new PluginManager({ registry: new PluginRegistry(), store: memoryStore(), appVersion: '1.0.0', wasm: (p) => wasmGenerators(p) });
    const files = (await filesFromZip(new Uint8Array(readFileSync(ZIP!)))) as Map<string, Uint8Array>;
    const js = new TextDecoder().decode(files.get('component.js')!);
    files.set('component.js', new TextEncoder().encode(js + '\n// tampered'));
    const plan = await m.plan(files);
    expect(plan.inspection.ok).toBe(false);
    expect(plan.inspection.errors.join(' ')).toContain('does not match its sha256');
  });
});
