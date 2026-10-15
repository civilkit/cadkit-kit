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
import { importFcstd, resolveEdges, type EdgeResolver } from './import';
describe('real FCStd file (FreeCAD data/tests/PocketTest.fcstd, LGPL-2.1)', { skip: !process.env.CK_WASM }, () => {
  it('imports the legacy 0.14 file; the first pad has the volume of the cached FreeCAD shape', async () => {
    const r = await importFcstd(new Uint8Array(readFileSync(process.cwd() + '/packages/fcstd/fixtures/PocketTest.fcstd')), 'PocketTest');
    expect(r.steps.map((s) => s.fc)).toEqual(['Pad']);
    expect(r.warnings.map((w) => w.code)).toContain('legacyFormat');
    const s = await Session.open(r.part as unknown as PartDoc); sessions.push(s);
    expect((await s.facts()).volume).toBeCloseTo(230000, 3); // OCCT volume of Pad.Shape in the file
  });
});

describe('real FCStd file (FreeCAD tests/.../ModelFromV021.FCStd, LGPL-2.1)', { skip: !process.env.CK_WASM }, () => {
  const bytes = () => new Uint8Array(readFileSync(process.cwd() + '/packages/fcstd/fixtures/ModelFromV021.FCStd'));
  const stepVolumes = async (r: Awaited<ReturnType<typeof importFcstd>>) => {
    const out: number[] = [];
    for (const st of r.steps) {
      const last = Math.max(...st.features.map((id) => r.part.features.findIndex((x) => x.id === id)));
      const s = await Session.open({ ...r.part, features: r.part.features.slice(0, last + 1) } as unknown as PartDoc); sessions.push(s);
      out.push((await s.facts()).volume ?? NaN);
    }
    return out;
  };
  it('without a resolver the chamfer is left out and reported; Pad and Revolution match the cached volumes', async () => {
    const r = await resolveEdges(await importFcstd(bytes(), 'ModelFromV021'));
    expect(r.steps.map((s) => s.fc)).toEqual(['Pad', 'Revolution']);
    expect(r.skipped).toEqual(['Chamfer']);
    expect(r.warnings.find((w) => w.object === 'Chamfer')?.code).toBe('edgeReferences');
    const v = await stepVolumes(r);
    expect(v[0]).toBeCloseTo(15803.6505, 3); // OCCT volumes of Pad.Shape / Revolution.Shape in the file
    expect(v[1]).toBeCloseTo(15837.8813, 3);
  });
  it('with the kernel as edge resolver the chamfer is imported too: Edge names go through the cached BRep to points, then to edge references', async () => {
    const resolver: EdgeResolver = async (part, points) => {
      const s = await Session.open(part as unknown as PartDoc); sessions.push(s);
      const out: Array<Record<string, unknown> | null> = [];
      for (const p of points) {
        const m = await s.resolve([{ kind: 'edge', near: p, within: 1e-3 }]);
        const ref = (m as unknown as Array<{ matches?: Array<{ ref?: Record<string, unknown> }> }>)[0]?.matches?.[0]?.ref;
        out.push(ref ?? null);
      }
      return out;
    };
    const r = await resolveEdges(await importFcstd(bytes(), 'ModelFromV021'), resolver);
    expect(r.steps.map((s) => s.fc)).toEqual(['Pad', 'Revolution', 'Chamfer']);
    const v = await stepVolumes(r);
    expect(v[2]).toBeCloseTo(15759.2146, 3); // OCCT volume of Chamfer.Shape
  });
});
