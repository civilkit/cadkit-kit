import { afterEach, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import { listBodies, readBodyFields, faceVolumes } from './bodies';
import { queryMass } from './inspect/kernel';
import { importSolidcraft } from '@kit/solidcraft';
import { kernelResolvers } from '../../../packages/solidcraft/src/kernelResolvers';
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
it('rows', async () => {
  const open = async (p: any) => { const s = await Session.open(p as PartDoc); sessions.push(s); return s; };
  const { resolver, faceResolver, rimResolver } = kernelResolvers(open as any);
  for (const f of ['move-bodies', 'battery-tpu-case', 'm0-revolve-primitives']) {
    const imp: any = await importSolidcraft(new Uint8Array(readFileSync('../corpus/solidcraft/' + f + '.solidcraft')), f, { resolver, faceResolver, rimResolver } as any);
    const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
    const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
    await c.load(imp.part as PartDoc);
    const rows = listBodies(c.selModel()!.bodies(), readBodyFields(c.document()), { featureName: (id) => ((c.document() as any).features.find((x: any) => x.id === id)?.name ?? null) });
    const ss = await open(imp.part); const mp: any = await queryMass(ss); console.log('massProps', JSON.stringify((mp?.bodies ?? []).map((b: any) => [b.name, +b.volume.toFixed(1), b.com.map((x: number) => +x.toFixed(1))])));
    const fv = faceVolumes(c.bodyFaces()); console.log('rowvols', JSON.stringify(rows.map((r) => r.faces.reduce((a, f) => a + (fv.get(f) ?? 0), 0)).map((v) => +Math.abs(v).toFixed(1))));
    const feats = (imp.part.features as any[]).filter((x) => x.body || ['moveBody', 'combine', 'deleteBody'].includes(x.type)).map((x) => `${x.id}:${x.type}${x.body ? '=' + x.body : ''}`);
    console.log(f, '\n features:', feats.join(' '), '\n rows:', rows.map((r) => `${r.name} [origin ${r.origin}; ${r.faces.slice(0, 2).join(',')}...; vol ${r.volume?.toFixed(0)}]`).join('\n       '));
  }
}, 120000);
