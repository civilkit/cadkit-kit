// @vitest-environment node
// SolidInserts (a third-party release zip): the picked-edge value the app sends must be one the plugin can read. The plugin wants
// `mid` on every edge (the app used to send only `point`): "Invalid edges list: missing field `mid`".
// Run:  CK_INSERTS_ZIP=<solidinserts-1.2.0.zip> npx vitest run packages/plugin-wasm/src/inserts
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { filesFromZip, inspectPackage } from '@kit/plugin';
import { runPlugin, type Loaded } from './host';
import { convertRelease } from './convert';
import { Interpreter, type Scratch } from './interpreter';
import { dataUrlLoader } from './package';

const ZIP = process.env.CK_INSERTS_ZIP;
const on = !!(ZIP && existsSync(ZIP));
let plugin: Loaded, allowed = new Set<string>();
beforeAll(async () => {
  if (!on) return;
  const files = await filesFromZip(new Uint8Array(readFileSync(ZIP!)));
  if (!(files instanceof Map)) throw new Error(files.error);
  const c = await convertRelease(files);
  if ('error' in c) throw new Error(c.error);
  const i = await inspectPackage(c.files);
  if (!i.ok || !i.manifest?.wasm) throw new Error(`not installable: ${i.errors.join('; ')}`);
  allowed = new Set(i.manifest.wasm.commands);
  const rec = { id: i.manifest.id, version: i.manifest.version, manifest: i.manifest, files: i.files!, scripts: {}, binaries: i.binaries, hash: i.hash!, source: { kind: 'zip', name: 'test' }, installedAt: 0 };
  plugin = await dataUrlLoader.load(rec as never);
}, 60_000);

const run = async (picks: unknown[]): Promise<string> => {
  try {
    const scr: Scratch = { async build() { throw new Error('host:build'); } };
    const ring = Array.from({ length: 33 }, (_, k) => [20 + 3 * Math.cos((k / 32) * 2 * Math.PI), 20 + 3 * Math.sin((k / 32) * 2 * Math.PI), 10]);
    const I = new Interpreter(scr, { doc: { up: 'z', bodies: [{ name: 'Block', bbox: { min: [0, 0, 0], max: [40, 40, 10] }, volume: 16000 }], selection: [], edges: { Block: [{ name: 'rim', pts: ring }] } } });
    await runPlugin(plugin, 'applica', { hole_picks: picks, serie: 'Standard', filettatura: 'Automatic (nominal Ø)', compensazione_mm: 0 }, async (c, a) => I.run(c, a), { allow: allowed });
    return '';
  } catch (e) { return (e as Error).message; }
};

describe.skipIf(!on)('SolidInserts reads the app\'s edge picks', () => {
  it('the plugin reads the app edge list (model.edges answers with `mid`) and a pick that carries point and mid', async () => {
    const msg = await run([{ type: 'edge', body: 'Block', index: 3, point: [1, 2, 3], mid: [1, 2, 3] }]);
    expect(msg).not.toMatch(/Invalid edges list|missing field/);
  });
});
