import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../controller';
import { availableConnectors, insertFeature, NO_PLACEMENT } from './model';
import { mateFeature, newDraft } from './mateKinds';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function load(doc: PartDoc) {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(doc);
  return c;
}

function boxPartWithConnector(name: string, w: number, d: number, h: number, conn: Record<string, unknown>): Record<string, unknown> {
  return {
    format: 'ck-part',
    version: 1,
    name,
    features: [
      {
        type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'top' },
        points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: w, y: 0 }, { id: 'p3', x: w, y: d }, { id: 'p4', x: 0, y: d }],
        entities: [
          { type: 'line', id: 'e1', p1: 'p1', p2: 'p2' },
          { type: 'line', id: 'e2', p1: 'p2', p2: 'p3' },
          { type: 'line', id: 'e3', p1: 'p3', p2: 'p4' },
          { type: 'line', id: 'e4', p1: 'p4', p2: 'p1' },
        ],
        constraints: [],
      },
      { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: h },
      conn,
    ],
  };
}

function connFrame(c: Controller, compId: string, connId: string) {
  const comp = c.components().find((x) => x.id === compId);
  const entry = comp?.connectors?.find((e) => e[0] === connId);
  if (!entry) throw new Error(`connector ${compId}:${connId} not found`);
  return entry[1];
}

function expectVecNear(a: number[], b: number[], digits = 4) {
  expect(a.length).toBe(3);
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], digits);
}

describe('mate connectors end-to-end against the kernel', () => {
  const basePart = boxPartWithConnector('Base', 20, 20, 10, {
    type: 'connector', id: 'C_TOP', name: 'Top', anchor: { kind: 'face', id: 'F2.C1' },
  });
  const blockPart = boxPartWithConnector('Block', 10, 10, 10, {
    type: 'connector', id: 'C_BOT', name: 'Bottom', anchor: { kind: 'face', id: 'F2.C0' },
  });

  it('inserts two parts with connectors, discovers them, and solves fastened mate (flip, offset, rotateZ) to 0 DOF', async () => {
    const asm = {
      format: 'ck-part', version: 1, name: 'ConnectorAsm',
      features: [
        { ...insertFeature(basePart, NO_PLACEMENT, { name: 'Base', fixed: true }), id: 'I1' },
        { ...insertFeature(blockPart, { ...NO_PLACEMENT, dx: 50, dy: 40, dz: 30 }, { name: 'Block' }), id: 'I2' },
      ],
    } as unknown as PartDoc;
    const c = await load(asm);
    const conns = availableConnectors(c.document() as never, c.components());
    expect(conns.map((x) => x.key)).toEqual(['I1:C_TOP', 'I2:C_BOT']);
    expect(c.components().find((x) => x.id === 'I2')?.dof).toBe(6);

    // 1. Fastened with flip: true
    const d = newDraft('fastened');
    d.refs = { a: 'I1:C_TOP', b: 'I2:C_BOT' };
    d.flip = true;
    expect((await c.edit([{ op: 'add', feature: mateFeature(d) }])).ok).toBe(true);
    const report1 = c.assemblyExtra().report!;
    expect(report1.components.find((x) => x.id === 'I2')).toMatchObject({ dof: 0, translational: 0, rotational: 0 });
    const f1 = connFrame(c, 'I1', 'C_TOP');
    const f2 = connFrame(c, 'I2', 'C_BOT');
    expectVecNear(f2.o, f1.o);
    expectVecNear(f2.z, f1.z.map((v) => -v));

    // 2. Fastened with offset [2, 3, 5] and rotateZ: 90 (flip: false)
    const mateId = c.document()!.features.at(-1)!.id;
    const d2 = newDraft('fastened');
    d2.refs = { a: 'I1:C_TOP', b: 'I2:C_BOT' };
    d2.flip = false;
    d2.params.offx = 2; d2.params.offy = 3; d2.params.offz = 5;
    d2.params.rotateZ = 90;
    expect((await c.edit([{ op: 'replace', id: mateId, feature: { ...mateFeature(d2), id: mateId } }])).ok).toBe(true);
    const g1 = connFrame(c, 'I1', 'C_TOP');
    const g2 = connFrame(c, 'I2', 'C_BOT');
    const expectedO = [0, 1, 2].map((i) => g1.o[i] + 2 * g1.x[i] + 3 * g1.y[i] + 5 * g1.z[i]);
    expectVecNear(g2.o, expectedO);
    expectVecNear(g2.z, g1.z);
    expectVecNear(g2.x, g1.y);
  });

  it('solves revolute mate with angle limits (1 rotational DOF) and slider / cylindrical / planar DOFs', async () => {
    const part = boxPartWithConnector('Link', 20, 20, 10, {
      type: 'connector', id: 'C1', name: 'Top', anchor: { kind: 'face', id: 'F2.C1' },
    });
    const asm = {
      format: 'ck-part', version: 1, name: 'RevAsm',
      features: [
        { ...insertFeature(part, NO_PLACEMENT, { name: 'A', fixed: true }), id: 'I1' },
        { ...insertFeature(part, { dx: 30, dy: 20, dz: 10, axis: 'y', angle: 45 }, { name: 'B' }), id: 'I2' },
      ],
    } as unknown as PartDoc;
    const c = await load(asm);

    // Revolute with min/max [-20, 20]
    const rev = newDraft('revolute');
    rev.refs = { a: 'I1:C1', b: 'I2:C1' };
    rev.params.min = -20; rev.params.max = 20;
    expect((await c.edit([{ op: 'add', feature: mateFeature(rev) }])).ok).toBe(true);
    const rep = c.assemblyExtra().report!;
    expect(rep.components.find((x) => x.id === 'I2')).toMatchObject({ dof: 1, translational: 0, rotational: 1 });
    const f1 = connFrame(c, 'I1', 'C1');
    const f2 = connFrame(c, 'I2', 'C1');
    expectVecNear(f2.o, f1.o);
    expectVecNear(f2.z, f1.z);
    const cross = [
      f1.x[1] * f2.x[2] - f1.x[2] * f2.x[1],
      f1.x[2] * f2.x[0] - f1.x[0] * f2.x[2],
      f1.x[0] * f2.x[1] - f1.x[1] * f2.x[0],
    ];
    const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const angDeg = Math.atan2(dot(f1.z, cross), dot(f1.x, f2.x)) * (180 / Math.PI);
    expect(Math.abs(angDeg)).toBeCloseTo(20, 3);

    // Replace with slider, cylindrical, planar and verify DOF split
    const mateId = c.document()!.features.at(-1)!.id;
    for (const [kind, dof, t, r] of [['slider', 1, 1, 0], ['cylindrical', 2, 1, 1], ['planar', 3, 2, 1]] as const) {
      const m = newDraft(kind);
      m.refs = { a: 'I1:C1', b: 'I2:C1' };
      expect((await c.edit([{ op: 'replace', id: mateId, feature: { ...mateFeature(m), id: mateId } }])).ok, kind).toBe(true);
      expect(c.assemblyExtra().report!.components.find((x) => x.id === 'I2'), kind).toMatchObject({ dof, translational: t, rotational: r });
    }
  });
});
