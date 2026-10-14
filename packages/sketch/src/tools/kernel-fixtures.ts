/** Shared by the real-kernel tests of the sketch tools: regenerate a drawn sketch (plus an extrude) with the kernel and read back
 *  the solver's verdict. Not part of the package surface (nothing imports it but tests). */
import { Session } from '@ck/session';
import { emptyPart, type PartDoc, type SketchSolverStatus } from '@ck/part-model';
import { toFeature, type SketchDraft } from '../index';

export const sessions: Session[] = [];
export const closeSessions = async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); };

/** Regenerate `draft` as sketch F1 extruded by `depth` (extra features appended as given). `solve` also asks the kernel to
 *  re-solve the sketch (the controller does this on every edit). */
export async function solveDraft(draft: SketchDraft, depth = 5, opts: { solve?: boolean; extrude?: Record<string, unknown>; extra?: Record<string, unknown>[] } = {}) {
  const doc = {
    ...emptyPart('Drawn'),
    features: [toFeature(draft), { type: 'extrude', op: 'add', sketch: 'F1', end: 'blind', depth, id: 'F2', ...(opts.extrude ?? {}) }, ...(opts.extra ?? [])],
    seq: 3 + (opts.extra?.length ?? 0),
  } as unknown as PartDoc;
  const s = await Session.open(doc);
  sessions.push(s);
  const r = await s.preview([], { sketchStatus: true, ...(opts.solve ? { solveSketches: true } : {}) });
  const facts = await s.facts();
  const sk = r.body?.sketches[0] as unknown as { sketch: { points: Array<{ id: string; x: number; y: number }>; entities: Array<Record<string, unknown>> }; status?: SketchSolverStatus } | undefined;
  const pts = Object.fromEntries((sk?.sketch.points ?? []).map((p) => [p.id, [p.x, p.y] as [number, number]]));
  return { r, facts, status: sk?.status, pts, entities: sk?.sketch.entities ?? [] };
}

export const boxSize = (b: { min: number[]; max: number[] }) => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
