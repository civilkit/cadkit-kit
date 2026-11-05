// The kernel side of reference resolution: turns the points and normals the importer read from FreeCAD's stored shapes into the kernel's
// edge references and face ids, using the `resolve` query on the body before the feature. The importer package does not depend on the
// session; the caller gives a function that opens one on a part (`Session.open`) and closes it again.
import type { EdgeResolver, FaceFrame, FaceResolver, FcImport } from './import';

/** The part of a kernel session that the resolvers use (`Session` from @ck/session has it). */
export interface ResolveSession {
  resolve(descriptions: Array<Record<string, unknown>>): Promise<unknown>;
  bodyForView?(): Promise<{ sketches?: Array<{ id: string; frame: FaceFrame }> } | null>;
  close(): Promise<void> | void;
}
type Reply = { status?: string; matches?: Array<{ ref?: Record<string, unknown> }> };

export function fcstdResolvers(open: (part: FcImport['part']) => Promise<ResolveSession>): { edges: EdgeResolver; faces: FaceResolver } {
  const ask = async (part: FcImport['part'], descs: Array<Record<string, unknown>>): Promise<Reply[]> => {
    const s = await open(part);
    try { return (await s.resolve(descs)) as Reply[]; } finally { await s.close(); }
  };
  return {
    edges: async (part, points) => {
      const r = await ask(part, points.map((p) => ({ kind: 'edge', near: p, within: 1e-3 })));
      return r.map((x) => x?.matches?.[0]?.ref ?? null);
    },
    faces: async (part, faces, opts) => {
      const r = await ask(part, faces.map((f) => ({ kind: 'face', surface: 'plane', normal: f.normal, near: f.at })));
      const ids = r.map((x) => (x?.status === 'unique' || x?.matches?.length === 1 ? String(x.matches?.[0]?.ref?.id ?? '') || null : null));
      const out: Array<{ id: string; frame?: FaceFrame } | null> = [];
      for (const id of ids) {
        if (!id) { out.push(null); continue; }
        if (!opts?.frames) { out.push({ id }); continue; }
        // the frame the kernel gives a sketch on that face: a probe sketch on it, read back
        const probe = { ...part, features: [...part.features, { type: 'sketch', id: '__probe', plane: { kind: 'face', id }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [] }] };
        const s = await open(probe);
        try { const v = await s.bodyForView?.(); const fr = v?.sketches?.find((q) => q.id === '__probe')?.frame; out.push(fr ? { id, frame: fr } : null); } finally { await s.close(); }
      }
      return out;
    },
  };
}
