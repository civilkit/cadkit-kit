// The importer's three questions to the kernel (which edge, which face, which rim is at this position), answered with a Session on the
// part built so far. The caller says how to open that session (the app uses a scratch tag of its own on the shared kernel; tests open a
// kernel of their own), so this module holds no kernel of its own.
import type { Session } from '@ck/session';
import { axisLabel, faceAtPoint, faceOutlines, type EdgeResolver, type FaceResolver, type RimResolver, type ScPart } from './import';

export interface KernelResolvers { resolver: EdgeResolver; faceResolver: FaceResolver; rimResolver: RimResolver }

type Match = { name: string; ref?: Record<string, unknown> & { id?: string }; normal?: string; centroid: number[] };

export function kernelResolvers(open: (part: ScPart) => Promise<Session>): KernelResolvers {
  /** The faces the kernel lists and its view edges: what is needed to find the face a position lies on. */
  const faceData = async (part: ScPart) => {
    const s = await open(part);
    const all = (await s.resolve([{ kind: 'face' }])) as unknown as Array<{ matches?: Match[] }>;
    const view = await s.bodyForView();
    return { faces: (all[0]?.matches ?? []).map((m) => ({ name: m.name, normal: m.normal, centroid: m.centroid })), edges: view?.edges ?? [] };
  };
  return {
    resolver: async (part, points) => {
      const s = await open(part);
      const found = (await s.resolve(points.map((p) => ({ kind: 'edge', near: p, within: 1e-3 })))) as unknown as Array<{ matches?: Match[] }>;
      return points.map((_, i) => found[i]?.matches?.[0]?.ref ?? null);
    },
    faceResolver: async (part, points) => {
      const { faces, edges } = await faceData(part);
      return points.map((p) => faceAtPoint(p, faces, edges));
    },
    rimResolver: async (part, point) => {
      const { faces, edges } = await faceData(part);
      const name = faceAtPoint(point, faces, edges);
      const normal = axisLabel(faces.find((f) => f.name === name)?.normal);
      return name && normal ? { name, normal, loops: faceOutlines(edges, name) } : null;
    },
  };
}
