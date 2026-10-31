// Import honesty and Repair Part against the real kernel: a STEP whose one face cannot be read comes in as a surface body (never a
// half-built solid) with the reason, and Repair Part, as one step after the import, makes it the solid again.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { importStepView } from './stepImport';
import { partOfStep } from './sldprtImport';
import { needsRepair, parseParts, parseRepairReport, repairOp } from './importReport';

const box = (w: number, d: number, h: number): PartDoc => ({
  ...emptyPart('Box'),
  features: [
    { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
      points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: w, y: 0 }, { id: 'p3', x: w, y: d }, { id: 'p4', x: 0, y: d }],
      entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] },
    { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: h },
  ],
  seq: 3,
}) as unknown as PartDoc;

/** The STEP with the loop of its `nth` face pointing at an entity that is not there: the reader cannot read that face. */
function breakFace(step: string, nth: number): string {
  let at = 0;
  for (let i = 0; i <= nth; i++) at = step.indexOf('ADVANCED_FACE(', at) + 1;
  const open = step.indexOf('(#', at) + 2;
  let end = open;
  while (/\d/.test(step[end])) end++;
  return step.slice(0, open) + '999999' + step.slice(end);
}

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('import honesty and Repair Part against the real kernel', { skip: !process.env.CK_WASM, timeout: 120_000 }, () => {
  it('a face the reader cannot read: a surface body with the reason, and Repair Part makes the solid again', async () => {
    const src = await Session.open(box(30, 20, 10)); sessions.push(src);
    const broken = breakFace(await src.step(), 2);
    // view-only import: no solid, one surface body of five faces, and the report says why
    const r = await importStepView(src, broken, 'Box');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0]).toMatchObject({ outcome: 'surface', faces: 5, facesTotal: 6 });
    expect(r.parts[0].reasons[0].code).toBe('badEntity');
    expect(r.parts[0].reasons.some((x) => x.code === 'SHELL_OPEN')).toBe(true);
    expect(r.view.mesh.triFace.length).toBe(0);
    expect((r.view as { surfaces?: unknown[] }).surfaces).toHaveLength(1);
    expect(needsRepair(r.parts)).toBe(true);

    // the editable part: the import step carries the needs-repair warning, its surface body is kept
    const part = await partOfStep(broken, 'Box', 'Box.step');
    const s = await Session.open(part); sessions.push(s);
    const rep = await s.regenReport();
    expect(rep.errors).toEqual([]);
    const w = (rep.warnings as Array<[string, { code: string; params: Record<string, unknown> }]>).find(([id, x]) => id === 'F1' && x.code === 'importStepParts');
    expect(w).toBeTruthy();
    expect(parseParts(w![1].params.parts)[0].surface).toBe('F1.P1');

    // Repair: one step after the import; the face is rebuilt on its own plane, the part is the 6000 mm3 solid again
    const op = repairOp('F1', s.document.features as Array<{ id: string }>);
    const ed = await s.edit([op as never]);
    expect(ed.ok).toBe(true);
    const after = await s.regenReport();
    const rr = (after.warnings as Array<[string, { code: string; params: Record<string, unknown> }]>).find(([id, x]) => id === op.feature.id && x.code === 'repairReport');
    const lines = parseRepairReport(rr![1].params);
    expect(lines[0]).toMatchObject({ valid: true, rebuilt: 1 });
    expect(lines[0].volume).toBeCloseTo(6000, 3);
    const m = await s.massProps();
    expect((m as { volume: number }).volume).toBeCloseTo(6000, 3);
    // undo: the repair goes, the surface body is back
    await s.undo();
    expect(s.document.features.map((f) => f.id)).toEqual(['F1']);
  });

  it('a sound file has nothing to repair: the step is refused with the reason and not added', async () => {
    const src = await Session.open(box(10, 10, 10)); sessions.push(src);
    const part = await partOfStep(await src.step(), 'Box', 'Box.step');
    const s = await Session.open(part); sessions.push(s);
    const ed = await s.edit([repairOp('F1', s.document.features as Array<{ id: string }>) as never]);
    expect(ed.ok).toBe(false);
    expect(ed.errors?.[0]?.[1].code).toBe('repairNothing');
    expect(s.document.features).toHaveLength(1);
  });
});
