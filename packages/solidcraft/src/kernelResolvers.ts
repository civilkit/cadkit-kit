// The importer's three questions to the kernel (which edge, which face, which rim is at this position), answered with a Session on the
// part built so far. The caller says how to open that session (the app uses a scratch tag of its own on the shared kernel; tests open a
// kernel of their own), so this module holds no kernel of its own.
import type { Session } from '@ck/session';
import { axisLabel, faceAtPoint, faceOutlines, type EdgeResolver, type FaceResolver, type RimResolver, type ScPart } from './import';

export interface KernelResolvers { resolver: EdgeResolver; faceResolver: FaceResolver; rimResolver: RimResolver }

type Match = { name: string; ref?: Record<string, unknown> & { id?: string }; normal?: string; centroid: number[] };

export function kernelResolvers(open: (part: ScPart) => Promise<Session>): KernelResolvers {
  /** The faces the kernel lists and its view edges: what is needed to find the face a position lies on. */
  const faceData = async (part: ScPart, body?: string) => {
    const s = await open(part);
    const all = (await s.resolve([{ kind: 'face', ...(body ? { body } : {}) }])) as unknown as Array<{ matches?: Match[] }>;
    const view = await s.bodyForView();
    return { faces: (all[0]?.matches ?? []).map((m) => ({ name: m.name, normal: m.normal, centroid: m.centroid })), edges: view?.edges ?? [] };
  };
  return {
    resolver: async (part, points, hints) => {
      const s = await open(part);
      const found = (await s.resolve(points.map((p, i) => ({ kind: 'edge', near: p, within: 1e-3, ...(hints?.[i]?.body ? { body: hints[i]!.body } : {}) })))) as unknown as Array<{ matches?: Match[] }>;
      const out: Array<Record<string, unknown> | null> = points.map((_, i) => found[i]?.matches?.[0]?.ref ?? null);
      // a point that is off the body: the straight edge parallel to the stored direction whose line passes through it, if there is one
      if (out.some((r, i) => !r && hints?.[i]?.dir)) {
        const edges = (await s.bodyForView())?.edges ?? [];
        for (let i = 0; i < points.length; i++) {
          const d = hints?.[i]?.dir;
          if (out[i] || !d) continue;
          const dl = Math.hypot(d[0], d[1], d[2]);
          const near = edges.filter((e) => {
            if (e.pts.length !== 2) return false;
            const a = e.pts[0], b = e.pts[1], t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], tl = Math.hypot(t[0], t[1], t[2]);
            if (tl < 1e-9 || Math.abs((t[0] * d[0] + t[1] * d[1] + t[2] * d[2]) / (tl * dl)) < 1 - 1e-6) return false;
            const w = [points[i][0] - a[0], points[i][1] - a[1], points[i][2] - a[2]];
            const along = (w[0] * t[0] + w[1] * t[1] + w[2] * t[2]) / (tl * tl);
            const off = Math.hypot(w[0] - along * t[0], w[1] - along * t[1], w[2] - along * t[2]);
            return off < 1e-3;
          });
          if (near.length !== 1) continue;
          const m = (await s.resolve([{ kind: 'edge', near: [0, 1, 2].map((k) => (near[0].pts[0][k] + near[0].pts[1][k]) / 2), within: 1e-3, ...(hints?.[i]?.body ? { body: hints[i]!.body } : {}) }])) as unknown as Array<{ matches?: Match[] }>;
          out[i] = m[0]?.matches?.[0]?.ref ?? null;
        }
      }
      // still off the body, and the body is no longer the size it was when the edge was picked on exactly one axis (a height changed
      // after the pick): the point moved along that axis by the same proportion
      if (out.some((r, i) => !r && hints?.[i]?.box)) {
        const edges = (await s.bodyForView())?.edges ?? [];
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const e of edges) for (const q of e.pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
        for (let i = 0; i < points.length; i++) {
          const b = hints?.[i]?.box;
          if (out[i] || !b || !edges.length) continue;
          const moved = [0, 1, 2].filter((k) => Math.abs(b.min[k] - lo[k]) > 1e-6 || Math.abs(b.max[k] - hi[k]) > 1e-6);
          if (moved.length !== 1) continue;
          const k = moved[0], span = b.max[k] - b.min[k];
          if (span < 1e-9) continue;
          const p = [...points[i]];
          p[k] = lo[k] + ((p[k] - b.min[k]) / span) * (hi[k] - lo[k]);
          const m = (await s.resolve([{ kind: 'edge', near: p, within: 1e-3, ...(hints?.[i]?.body ? { body: hints[i]!.body } : {}) }])) as unknown as Array<{ matches?: Match[] }>;
          out[i] = m[0]?.matches?.[0]?.ref ?? null;
        }
      }
      return out;
    },
    faceResolver: async (part, points, hints) => {
      // the faces of a named body only when the file names one (bodies can lie on one another)
      const bodies = [...new Set(points.map((_, i) => hints?.[i]?.body))];
      const data = new Map(await Promise.all(bodies.map(async (b) => [b, await faceData(part, b)] as const)));
      const out = points.map((p, i) => { const d = data.get(hints?.[i]?.body)!; return faceAtPoint(p, d.faces, d.edges); });
      // a position that is off the body: the cap of the extrude the file names
      for (let i = 0; i < points.length; i++) {
        const cap = hints?.[i]?.cap;
        if (out[i] || !cap) continue;
        const s = await open(part);
        const m = (await s.resolve([{ kind: 'face', role: 'cap', name: `${cap.feature}.C${cap.end === 'end' ? 1 : 0}*` }])) as unknown as Array<{ matches?: Match[] }>;
        const list = m[0]?.matches ?? [];
        if (list.length === 1) out[i] = list[0].name;
      }
      return out;
    },
    rimResolver: async (part, point) => {
      const { faces, edges } = await faceData(part);
      const name = faceAtPoint(point, faces, edges);
      const normal = axisLabel(faces.find((f) => f.name === name)?.normal);
      return name && normal ? { name, normal, loops: faceOutlines(edges, name) } : null;
    },
  };
}
