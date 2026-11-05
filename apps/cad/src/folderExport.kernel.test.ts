import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { checkMesh } from '@kit/io';
import type { FeatureRow } from '@kit/ui';
import { Controller, type KernelFactory } from './controller';
import { listBodies, readBodyFields } from './bodies';
import { folderIds } from './treeFolders';
import { exportCkpart, exportStep, exportStl } from './exportFiles';
import { planExtract, planFolderExport } from './folderExport';
import { partOfStep } from './files/sldprtImport';

const sq = (id: string, x: number, y: number, w: number, group?: string) => ({ type: 'sketch', id, ...(group ? { group } : {}), plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x, y }, { id: 'p2', x: x + w, y }, { id: 'p3', x: x + w, y: y + w }, { id: 'p4', x, y: y + w }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] });
const add = (id: string, sketch: string, depth: number, group?: string) => ({ type: 'extrude', id, op: 'add', sketch, end: 'blind', depth, ...(group ? { group } : {}) });
const cut = (id: string, sketch: string, group?: string) => ({ type: 'extrude', id, op: 'cut', sketch, end: 'throughBoth', ...(group ? { group } : {}) });

/** Folder Block: a 10 mm cube with a 3 x 3 boss 5 mm high. Folder Pad: a 10 mm cube apart with a 3 x 3 hole through it (910 mm3).
 *  Folder Notch: two holes through the block (50 mm3 off it, 995 mm3 left): it changes a body it did not make. */
const doc = (): PartDoc => ({
  ...emptyPart('Dash'),
  features: [
    sq('F1', 0, 0, 10, 'Block'), add('F2', 'F1', 10, 'Block'), sq('F3', 2, 2, 3, 'Block'), add('F4', 'F3', 15, 'Block'),
    sq('F5', 40, 0, 10, 'Pad'), add('F6', 'F5', 10, 'Pad'), sq('F7', 42, 2, 3, 'Pad'), cut('F8', 'F7', 'Pad'),
    sq('F9', 6, 6, 2, 'Notch'), cut('F10', 'F9', 'Notch'), sq('F11', 8, 1, 1, 'Notch'), cut('F12', 'F11', 'Notch'),
  ],
  seq: 13,
}) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function world(d: PartDoc) {
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(d);
  const feats = () => c.document()!.features as unknown as Array<{ id: string; type: string; group?: string }>;
  const frows = (): FeatureRow[] => feats().map((f) => ({ id: f.id, type: f.type, group: f.group, uses: f.type === 'extrude' ? [`F${Number(f.id.slice(1)) - 1}`] : undefined }));
  const bodyRows = () => listBodies(c.selModel()!.bodies(), readBodyFields(c.document()), {});
  const plan = (name: string, rolledBack = false) => planFolderExport(c.document()!, name, folderIds(frows(), feats(), name), bodyRows(), rolledBack);
  return { c, feats, plan, frows, bodyRows };
}
const meshVolume = (p: ArrayLike<number>): number => {
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5], p[i + 6], p[i + 7], p[i + 8]];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(v);
};
const volumeOfStep = async (step: string, w: Awaited<ReturnType<typeof world>>) => {
  const back = await world(await partOfStep(step, 'back'));
  return (await back.c.massProps())!.volume as number;
};

describe('folder geometry export on the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('a folder that made one of two bodies exports only that body, as STEP, STL and a frozen part', async () => {
    const w = await world(doc());
    const p = w.plan('Pad');
    if (!p.ok) throw new Error(p.reason);
    expect(p.bodies).toHaveLength(1);
    expect(p.whole).toBe(false);
    expect(p.shared).toBe(0);
    expect(p.doc.features.at(-1)).toMatchObject({ type: 'deleteBody', mode: 'keep' });
    // the open document is untouched
    expect(w.c.document()!.features).toHaveLength(12);
    const step = await w.c.folderBuild(p.doc, w.c.document()!, 'Pad', 'step');
    if (!step.ok) throw new Error(step.message);
    expect(step.solids).toBe(1);
    expect(step.volume).toBeCloseTo(910, 3);
    expect(exportStep(step.data as string, 'Dash - Pad').file?.name).toBe('Dash - Pad.step');
    expect(await volumeOfStep(step.data as string, w)).toBeCloseTo(910, 2);   // the STEP re-imports as the same solid

    const stl = await w.c.folderBuild(p.doc, w.c.document()!, 'Pad', 'stl');
    if (!stl.ok) throw new Error(stl.message);
    const mesh = stl.data as { positions: ArrayLike<number> };
    expect(checkMesh(mesh).watertight).toBe(true);
    expect(meshVolume(mesh.positions)).toBeCloseTo(910, 2);
    expect(exportStl(mesh, 'Dash - Pad').file?.name).toBe('Dash - Pad.stl');

    const ck = await w.c.folderBuild(p.doc, w.c.document()!, 'Pad', 'ckpart');
    if (!ck.ok) throw new Error(ck.message);
    const part = JSON.parse(ck.data as string) as PartDoc;
    expect(part.features.map((f) => f.type)).toEqual(['importStep']);
    expect(part.name).toBe('Pad');
    expect(exportCkpart(ck.data as string, 'Dash - Pad').file?.name).toBe('Dash - Pad.ckpart');
    const back = await world(part);   // opens as a part of its own with the folder's volume
    expect((await back.c.massProps())!.volume).toBeCloseTo(910, 2);
  });

  it('a folder that only changed a body exports the whole body and says it is shared', async () => {
    const w = await world(doc());
    const p = w.plan('Notch');
    if (!p.ok) throw new Error(p.reason);
    expect(p.bodies).toHaveLength(1);
    expect(p.shared).toBe(1);   // the block's faces come from F2 and F4 as well
    const step = await w.c.folderBuild(p.doc, w.c.document()!, 'Notch', 'step');
    if (!step.ok) throw new Error(step.message);
    expect(step.volume).toBeCloseTo(995, 3);   // the block with its boss, less the two holes
    expect(await volumeOfStep(step.data as string, w)).toBeCloseTo(995, 2);
  });

  it('a folder holding every body needs no cutting', async () => {
    const w = await world(doc());
    const whole = planFolderExport(w.c.document()!, 'All', w.feats().map((f) => f.id), w.bodyRows(), false);
    if (!whole.ok) throw new Error(whole.reason);
    expect(whole.whole).toBe(true);
    expect(whole.bodies).toHaveLength(2);
    expect(whole.doc).toBe(w.c.document());
    const step = await w.c.folderBuild(whole.doc, w.c.document()!, 'All', 'step');
    if (!step.ok) throw new Error(step.message);
    expect(step.solids).toBe(2);
    expect(step.volume).toBeCloseTo(1905, 3);
  });

  it('refuses with a reason: sketches only, suppressed, rolled back, no body left, no features', async () => {
    const w = await world(doc());
    expect(planFolderExport(w.c.document()!, 'Sk', ['F1', 'F3'], w.bodyRows(), false)).toMatchObject({ ok: false, reason: 'onlySketches' });
    expect(planFolderExport(w.c.document()!, 'Nothing', [], w.bodyRows(), false)).toMatchObject({ ok: false, reason: 'empty' });
    expect(w.plan('Block', true)).toMatchObject({ ok: false, reason: 'rolledBack' });
    // the folder's features made nothing that is left in the result
    expect(planFolderExport(w.c.document()!, 'Pad', ['F5', 'F6'], [], false)).toMatchObject({ ok: false, reason: 'noBodies' });
    const sup = await world({ ...doc(), features: doc().features.map((f) => (f.id === 'F6' || f.id === 'F8' ? { ...f, suppressed: true } : f)) } as PartDoc);
    expect(sup.plan('Pad')).toMatchObject({ ok: false, reason: 'allSuppressed' });
  });

  it('extracts a standalone folder as a part that builds to the same volume; a folder that acts on outside geometry does not', async () => {
    const w = await world(doc());
    const x = planExtract(w.c.document()!, 'Pad', folderIds(w.frows(), w.feats(), 'Pad'), false);
    if (!x.ok) throw new Error(x.reason);
    expect(x.part.features.map((f) => f.id)).toEqual(['F5', 'F6', 'F7', 'F8']);
    const built = await w.c.extractCheck(x.part);
    expect(built).toMatchObject({ ok: true });
    expect((built as { volume: number }).volume).toBeCloseTo(910, 3);
    const opened = await world(x.part);   // and it opens as a document of its own
    expect((await opened.c.massProps())!.volume).toBeCloseTo(910, 3);
    // the notch cuts name nothing outside the folder, yet there is nothing to cut: the check says so instead of handing over an empty part
    const n = planExtract(w.c.document()!, 'Notch', folderIds(w.frows(), w.feats(), 'Notch'), false);
    if (!n.ok) throw new Error(n.reason);
    const cutOnly = await w.c.extractCheck(n.part);
    expect(cutOnly.ok && cutOnly.volume !== null && cutOnly.volume > 0).toBe(false);
  });
});
