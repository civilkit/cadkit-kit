// @vitest-environment node
// SolidInserts 1.2.0 (a third-party zip) on a real solid made by our kernel: the plate has a through hole; picking the rim of the hole at the top face must be accepted by the plugin.
// Run:  CK_WASM=<kernel wasm> CK_INSERTS_ZIP=<solidinserts-1.2.0.zip> npx vitest run apps/cad/src/solidInserts
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { filesFromZip, inspectPackage } from '@kit/plugin';
import { runPlugin } from '../../../packages/plugin-wasm/src/host';
import { convertRelease } from '../../../packages/plugin-wasm/src/convert';
import { Interpreter, type Scratch } from '../../../packages/plugin-wasm/src/interpreter';
import { dataUrlLoader } from '../../../packages/plugin-wasm/src/package';
import { Controller, type KernelFactory } from './controller';
import { pluginDocContext } from './pluginDoc';

const ZIP = process.env.CK_INSERTS_ZIP ?? (existsSync('solidcore_plugins/solidinserts-1.2.0.zip') ? 'solidcore_plugins/solidinserts-1.2.0.zip' : undefined);
const on = !!(process.env.CK_WASM && ZIP && existsSync(ZIP));
const sessions: Session[] = [];
afterAll(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

function plate(): PartDoc {
  const feats: unknown[] = [
    { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: 0, y: 0 }, { id: 'b', x: 40, y: 0 }, { id: 'c', x: 40, y: 30 }, { id: 'd', x: 0, y: 30 }],
      entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']].map(([id, p1, p2]) => ({ id, type: 'line', p1, p2 })), constraints: [] },
    { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 8 },
    { type: 'sketch', id: 'F3', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'h', x: 20, y: 15 }], entities: [{ id: 'e1', type: 'point', p: 'h' }], constraints: [] },
    { type: 'hole', id: 'F4', sketch: 'F3', end: 'through', kind: 'simple', diameter: 4 },
  ];
  return { ...emptyPart('Plate'), features: feats, seq: 5 } as unknown as PartDoc;
}

describe.skipIf(!on)('SolidInserts on a real plate with a hole', () => {
  // KNOWN GAP (UX round 3, R3-9): the plugin still answers "select a circular rim on a flat face, with a cylindrical wall and no chamfer" for a correct rim. What the app reads for it
  // (model.faces: the wall is recognised as a cylinder with its true area; model.edges: circle, mid) is complete as far as the plugin's field names show; the rule it checks is not
  // visible from outside. `it.fails` keeps CI green and turns red the day the plugin accepts the rim, so this gets turned into a plain `it`.
  it.fails('accepts the rim of the hole at the top face', async () => {
    const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
    const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
    await c.load(plate());
    const mesh = c.bodyFaces()!, edges = c.bodyEdges() as unknown as Array<{ key: string; pts: number[][] }>;
    const rows = [{ key: 'b', name: 'Plate', named: true, faces: [...mesh.faceIds], edges: edges.map((e) => e.key) }] as never;
    const rim = edges.find((e) => /^F2\.C1\|F4\.S\.h1/.test(e.key));
    expect(rim, 'the hole rim at z = 8: ' + edges.map((e) => e.key).join(' ')).toBeTruthy();
    const ctx = pluginDocContext(rows, mesh as never, [rim!.key], [], {}, { edges: true, edgePts: (k: string) => edges.find((e) => e.key === k)?.pts, edgePoint: (k: string) => { const p = edges.find((e) => e.key === k)?.pts; return p ? p[Math.floor(p.length / 2)] : undefined; } } as never);
    const files = await filesFromZip(new Uint8Array(readFileSync(ZIP!)));
    if (!(files instanceof Map)) throw new Error(files.error);
    const conv = await convertRelease(files);
    if ('error' in conv) throw new Error(conv.error);
    const i = await inspectPackage(conv.files);
    if (!i.ok || !i.manifest?.wasm) throw new Error(`not installable: ${i.errors.join('; ')}`);
    const allowed = new Set(i.manifest.wasm.commands);
    const plugin = await dataUrlLoader.load({ id: i.manifest.id, version: i.manifest.version, manifest: i.manifest, files: i.files!, scripts: {}, binaries: i.binaries, hash: i.hash!, source: { kind: 'zip', name: 'test' }, installedAt: 0 } as never);
    const scr: Scratch = { async build() { throw new Error('host:build'); } };
    const I = new Interpreter(scr, { doc: { ...ctx, up: 'z' } as never });
    const log: string[] = [];
    let err = '';
    const picks = ctx.selection.map((s: Record<string, unknown>) => ({ ...s }));
    try { await runPlugin(plugin, 'applica', { hole_picks: picks, serie: 'Standard', filettatura: 'Automatic (nominal Ø)', compensazione_mm: 0 }, async (cmd, a) => { const r = await I.run(cmd, a); log.push(`${cmd} ${JSON.stringify(a).slice(0, 200)} -> ${JSON.stringify(r).slice(0, 1500)}`); return r; }, { allow: allowed }); } catch (e) { err = (e as Error).message; }
    console.log('PICKS', JSON.stringify(picks), '\nLOG\n' + log.join('\n'), '\nERR', err);
    expect(err).not.toMatch(/select a circular rim/);
  }, 240_000);
});
