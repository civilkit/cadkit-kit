import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { importFcDocument } from './import';
import { DOC, pl } from './fixture';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const run = async (xml: string) => {
  const r = importFcDocument(xml);
  const s = await Session.open(r.part as unknown as PartDoc); sessions.push(s);
  return s.facts();
};

describe('FCStd fixture against the kernel', { skip: !process.env.CK_WASM }, () => {
  it('a 20 x 10 sketch padded 5 is 1000 mm3 and sits where FreeCAD put it', async () => {
    const f = await run(DOC);
    expect(f.volume).toBeCloseTo(1000, 6);
    expect(f.box?.min).toEqual([0, 0, 0]);
    expect(f.box?.max).toEqual([20, 10, 5]);
  });
  it('a sketch on XY at z = 7 with a downward normal pads downwards (z 2..7)', async () => {
    const f = await run(DOC.replace(`<Property name="Placement" type="App::PropertyPlacement">${pl(0, 0, 0)}`, `<Property name="Placement" type="App::PropertyPlacement">${pl(0, 0, 7, [1, 0, 0, 0])}`));
    expect(f.volume).toBeCloseTo(1000, 6);
    // the 180 degree turn about X also mirrors y, so the rectangle lies at y -10..0
    expect(f.box?.min.map((v) => +v.toFixed(6))).toEqual([0, -10, 2]);
    expect(f.box?.max.map((v) => +v.toFixed(6))).toEqual([20, 0, 7]);
  });
  it('a sketch on the YZ plane maps to our right plane', async () => {
    // rotation taking x->y, y->z (normal along +x): quaternion (0.5, 0.5, 0.5, 0.5)
    const f = await run(DOC.replace(`<Property name="Placement" type="App::PropertyPlacement">${pl(0, 0, 0)}`, `<Property name="Placement" type="App::PropertyPlacement">${pl(0, 0, 0, [0.5, 0.5, 0.5, 0.5])}`));
    expect(f.volume).toBeCloseTo(1000, 6);
    expect(f.box?.max.map((v) => +v.toFixed(6))).toEqual([5, 20, 10]);
  });
});

import { readFileSync } from 'node:fs';
import { importFcstd, resolveEdges, resolveReferences } from './import';
import { fcstdResolvers, type ResolveSession } from './resolve';

// Real FreeCAD 1.1.4 documents of our own corpus (packages/fcstd/corpus); the volumes are FreeCAD's, from the dumps next to them.
const GEN = process.cwd() + '/packages/fcstd/corpus/generated/';
const fcBytes = (n: string) => new Uint8Array(readFileSync(GEN + n + '.FCStd'));
const fcVolume = (n: string, obj: string): number => JSON.parse(readFileSync(GEN + n + '.dump.json', 'utf8')).objects.find((o: any) => o.name === obj).shape.volume;
const stepVolumes = async (r: Awaited<ReturnType<typeof importFcstd>>) => {
  const out: number[] = [];
  for (const st of r.steps) {
    const last = Math.max(...st.features.map((id) => r.part.features.findIndex((x) => x.id === id)));
    const s = await Session.open({ ...r.part, features: r.part.features.slice(0, last + 1) } as unknown as PartDoc); sessions.push(s);
    out.push((await s.facts()).volume ?? NaN);
  }
  return out;
};

describe('corpus model with a Pad and a Pocket (37_dressup_chain)', { skip: !process.env.CK_WASM }, () => {
  it('imports the pad and the pocket (and the dress-ups once edges can be resolved) with the volumes FreeCAD stored', async () => {
    const r = await resolveEdges(await importFcstd(fcBytes('37_dressup_chain'), '37_dressup_chain'));
    expect(r.steps.map((s) => s.fc)).toEqual(['Pad', 'Pocket']); // without a resolver the fillet and the chamfer are left out and reported
    expect(r.skipped).toEqual(['Fillet', 'Chamfer']);
    expect(r.warnings.find((w) => w.object === 'Fillet')?.code).toBe('edgeReferences');
    const v = await stepVolumes(r);
    expect(v[0]).toBeCloseTo(fcVolume('37_dressup_chain', 'Pad'), 4);
    expect(v[1]).toBeCloseTo(fcVolume('37_dressup_chain', 'Pocket'), 4);
  });
});

describe('corpus models with a Revolution and a Chamfer (31_groove, 36_chamfer)', { skip: !process.env.CK_WASM }, () => {
  it('Pad then Groove: both steps have the stored volumes', async () => {
    const r = await importFcstd(fcBytes('31_groove'), '31_groove', { body: 'BodyFull' });
    expect(r.steps.map((s) => s.fc)).toEqual(['BaseFull', 'GrooveFull']);
    const v = await stepVolumes(r);
    expect(v[0]).toBeCloseTo(fcVolume('31_groove', 'BaseFull'), 4);
    expect(v[1]).toBeCloseTo(fcVolume('31_groove', 'GrooveFull'), 4);
  });
  it('with the kernel as edge resolver the chamfer is imported too: Edge names go through the cached BRep to points, then to edge references', async () => {
    const resolver = fcstdResolvers(async (part) => { const s = await Session.open(part as unknown as PartDoc); sessions.push(s); return s as unknown as ResolveSession; }).edges;
    const r = await resolveEdges(await importFcstd(fcBytes('36_chamfer'), '36_chamfer', { body: 'BodyEqual' }), resolver);
    expect(r.steps.map((s) => s.fc)).toEqual(['BaseEqual', 'ChEqual']);
    const v = await stepVolumes(r);
    expect(v[1]).toBeCloseTo(fcVolume('36_chamfer', 'ChEqual'), 4);
  });
});
