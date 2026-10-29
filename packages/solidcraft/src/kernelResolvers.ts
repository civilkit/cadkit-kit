// The importer's three questions to the kernel (which edge, which face, which rim is at this position), answered with a Session on the
// part built so far. The caller says how to open that session (the app uses a scratch tag of its own on the shared kernel; tests open a
// kernel of their own), so this module holds no kernel of its own.
import type { Session } from '@ck/session';
import { axisLabel, faceAtPoint, faceOutlines, type AxisFaceResolver, type EdgeResolver, type FaceResolver, type RimResolver, type ScPart, type StepNormal, type StepNormalizer } from './import';

export interface KernelResolvers { axisFaceResolver: AxisFaceResolver; resolver: EdgeResolver; faceResolver: FaceResolver; rimResolver: RimResolver }

type Match = { name: string; ref?: Record<string, unknown> & { id?: string }; normal?: string; centroid: number[] };

export function kernelResolvers(open: (part: ScPart) => Promise<Session>): KernelResolvers {
  /** The faces the kernel lists and its view edges: what is needed to find the face a position lies on. */
  const faceData = async (part: ScPart, body?: string) => {
    const s = await open(part);
    let all = (await s.resolve([{ kind: 'face', ...(body ? { body } : {}) }])) as unknown as Array<{ matches?: Match[] }>;
    // a body the kernel does not know by that name (a piece of a split gets its own name in their file): all faces, by position alone
    if (body && !all[0]?.matches?.length) all = (await s.resolve([{ kind: 'face' }])) as unknown as Array<{ matches?: Match[] }>;
    const view = await s.bodyForView();
    return { faces: (all[0]?.matches ?? []).map((m) => ({ name: m.name, normal: m.normal, centroid: m.centroid })), edges: view?.edges ?? [] };
  };
  return {
    axisFaceResolver: async (part, picks) => {
      const s = await open(part);
      const all = (await s.resolve([{ kind: 'face', surface: 'cylinder' }])) as unknown as Array<{ matches?: Array<Match & { axis?: string; radius?: number }> }>;
      const cyl = all[0]?.matches ?? [];
      return picks.map((p) => {
        // a cylinder's reported centre lies on its surface: the pick is on the axis when its distance from the axis line through that centre is the radius
        const hit = cyl.filter((m) => {
          if (!m.name.endsWith(`@${p.insert}.1`) || m.radius === undefined) return false;
          const d = axisLabel(m.axis) ?? ((/^\(([^)]*)\)$/.exec(m.axis ?? '')?.[1] ?? '').split(',').map(Number) as number[]);
          if (d.length !== 3 || d.some((v) => !Number.isFinite(v))) return false;
          const w = [0, 1, 2].map((k) => p.point[k] - m.centroid[k]);
          const along = w[0] * d[0] + w[1] * d[1] + w[2] * d[2];
          return Math.abs(Math.hypot(w[0] - along * d[0], w[1] - along * d[1], w[2] - along * d[2]) - m.radius) < 1e-4;
        });
        return hit.length === 1 ? hit[0].name : null;
      });
    },
    resolver: async (part, points, hints) => {
      const s = await open(part);
      const found = (await s.resolve(points.map((p, i) => ({ kind: 'edge', near: p, within: 1e-3, ...(hints?.[i]?.body ? { body: hints[i]!.body } : {}) })))) as unknown as Array<{ matches?: Match[] }>;
      const out: Array<Record<string, unknown> | null> = points.map((_, i) => found[i]?.matches?.[0]?.ref ?? null);
      // a body name the kernel does not know: the same lookup by position alone
      const unnamed = points.map((_, i) => i).filter((i) => !out[i] && hints?.[i]?.body);
      if (unnamed.length) {
        const again = (await s.resolve(unnamed.map((i) => ({ kind: 'edge', near: points[i], within: 1e-3 })))) as unknown as Array<{ matches?: Match[] }>;
        unnamed.forEach((i, k) => { out[i] = again[k]?.matches?.[0]?.ref ?? null; });
      }
      // a point that is off the body: the straight edge parallel to the stored direction whose line passes through it, if there is one
      if (out.some((r, i) => !r && hints?.[i]?.dir)) {
        const viewEdges = (await s.bodyForView())?.edges ?? [];
        // the straight edges of one body as end points (bodies can lie on one another, so the view edges alone are ambiguous)
        const ofBody = new Map<string, Array<{ pts: number[][] }>>();
        for (const b of new Set(hints?.map((h) => h?.body))) {
          if (!b) continue;
          const all = (await s.resolve([{ kind: 'edge', curve: 'line', body: b }])) as unknown as Array<{ matches?: Array<{ mid: number[]; dir?: string; length: number }> }>;
          ofBody.set(b, (all[0]?.matches ?? []).flatMap((m) => {
            const d = axisLabel(m.dir) ?? ((/^\(([^)]*)\)$/.exec(m.dir ?? '')?.[1] ?? '').split(',').map(Number) as number[]);
            if (d.length !== 3 || d.some((v) => !Number.isFinite(v))) return [];
            const l = m.length / 2;
            return [{ pts: [[0, 1, 2].map((k) => m.mid[k] - d[k] * l), [0, 1, 2].map((k) => m.mid[k] + d[k] * l)] }];
          }));
        }
        for (let i = 0; i < points.length; i++) {
          const d = hints?.[i]?.dir;
          if (out[i] || !d) continue;
          const dl = Math.hypot(d[0], d[1], d[2]);
          const edges = (hints?.[i]?.body ? ofBody.get(hints[i]!.body!) : undefined) ?? viewEdges;
          const near = edges.filter((e) => {
            if (e.pts.length !== 2) return false;
            const a = e.pts[0], b = e.pts[1], t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], tl = Math.hypot(t[0], t[1], t[2]);
            if (tl < 1e-9 || Math.abs((t[0] * d[0] + t[1] * d[1] + t[2] * d[2]) / (tl * dl)) < 1 - (hints?.[i]?.body ? 1e-4 : 1e-6)) return false;
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
      // still not found, and the file names the two faces of the edge: the edge between faces of those names, the one nearest the stored position
      // (a parameter changed after the pick, so the position is stale but the names still say which edge it is)
      const byName = points.map((_, i) => i).filter((i) => !out[i] && hints?.[i]?.faces);
      if (byName.length) {
        const bodies = [...new Set(byName.map((i) => hints![i]!.body))];
        const names = new Map<string | undefined, string[]>();
        for (const b of bodies) {
          const all = (await s.resolve([{ kind: 'face', ...(b ? { body: b } : {}) }])) as unknown as Array<{ matches?: Match[] }>;
          names.set(b, (all[0]?.matches ?? []).map((m) => m.name));
        }
        const named = (list: string[], f: { prefix: string; inst?: string }) => list.filter((n) => {
          if (!n.startsWith(f.prefix)) return false;
          const rest = n.slice(f.prefix.length);
          return f.inst ? rest === f.inst || (/^~\d+/.test(rest) && rest.endsWith(f.inst)) : rest === '' || /^~\d+$/.test(rest);
        });
        for (const i of byName) {
          const h = hints![i]!, list = names.get(h.body) ?? [];
          const as = named(list, h.faces![0]), bs = named(list, h.faces![1]);
          const pairs = as.flatMap((a) => bs.map((b) => [a, b] as const)).filter(([a, b]) => a !== b);
          if (!pairs.length || pairs.length > 12) continue;
          const found = (await s.resolve(pairs.map(([a, b]) => ({ kind: 'edge', between: [a, b], ...(h.body ? { body: h.body } : {}) })))) as unknown as Array<{ matches?: Array<Match & { mid: number[]; dir?: string; length?: number }> }>;
          const cands = found.flatMap((r) => r.matches ?? []);
          // the distance from the stored position to the edge: to its segment for a line, to its middle for any other curve
          const dist = (m: { mid: number[]; dir?: string; length?: number }) => {
            const d = axisLabel(m.dir) ?? ((/^\(([^)]*)\)$/.exec(m.dir ?? '')?.[1] ?? '').split(',').map(Number) as number[]);
            const w = [0, 1, 2].map((k) => points[i][k] - m.mid[k]);
            if (d.length !== 3 || d.some((v) => !Number.isFinite(v)) || m.length === undefined) return Math.hypot(w[0], w[1], w[2]);
            const along = Math.max(-m.length / 2, Math.min(m.length / 2, w[0] * d[0] + w[1] * d[1] + w[2] * d[2]));
            return Math.hypot(w[0] - along * d[0], w[1] - along * d[1], w[2] - along * d[2]);
          };
          const best = cands.sort((x, y) => dist(x) - dist(y));
          // the nearest edge must be clearly nearer than the next one (inner and outer wall edges differ by the wall thickness)
          if (best.length && best[0].ref && (best.length === 1 || dist(best[1]) - dist(best[0]) > 1e-6) && dist(best[0]) < 5) out[i] = best[0].ref;
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

/** The kernel as a transport of messages: what a session talks to. */
export interface StepKernel { request(msg: Record<string, unknown>): Promise<{ ok?: boolean; trap?: string; error?: unknown; result?: unknown }> }
export interface StepTools { normalizeStep: StepNormalizer; volumeOf: (part: ScPart) => Promise<{ volume: number | null; errors: number }> }

/** Lower-case hex SHA-256 of the UTF-8 bytes of `text`. */
async function sha256(text: string): Promise<string> {
  const h = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Two volumes are the same body to this fraction. */
const SAME_BODY = 1e-3;

/**
 * What the importer asks of the kernel about an original solid (STEP text) and about the part built around it, on scratch tags of their own.
 *
 * The kernel reads a STEP text two ways: the `importStep` message repairs the orientation of faces (healing), the `importStep` feature of a part
 * does not, because a feature that changed geometry unseen would surprise. A STEP made from another program's own geometry reads the same both ways;
 * a restatement by a converter can have some faces turned, so the feature gives a wrong volume (an open shell, a wrong body) where the message gives
 * the right one. `normalizeStep` reads the text both ways and, when the volumes differ, writes the healed body out again with the kernel's own
 * writer and checks that the feature now gives the same volume. A text the kernel cannot read says why.
 */
export function kernelStepTools(transport: () => Promise<StepKernel>): StepTools {
  const tags = { feature: 'solidcraft-step-feature', message: 'solidcraft-step-message', again: 'solidcraft-step-again', part: 'solidcraft-volume' };
  const volume = async (k: StepKernel, tag: string): Promise<number | null> => {
    const r = await k.request({ type: 'massProps', tag });
    const v = r.ok && r.result ? (r.result as { volume?: unknown }).volume : null;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  };
  const viaFeature = async (k: StepKernel, text: string, tag: string): Promise<number | null> => {
    const key = await sha256(text);
    const part: ScPart = { format: 'ck-part', version: 1, name: 'step', seq: 2, features: [{ type: 'importStep', id: 'F1', blob: key }], blobs: { [key]: text } };
    const r = await k.request({ type: 'regen', tag, part, opts: { noView: true } });
    if (!r.ok || r.trap || ((r.result as { errors?: unknown[] } | undefined)?.errors?.length ?? 0)) return null;
    return volume(k, tag);
  };
  const memo = new Map<string, Promise<StepNormal>>();   // the same original is asked about twice (as the body, then to check the operations)
  const normalize: StepNormalizer = async (text) => {
      const k = await transport();
      const rep = await k.request({ type: 'importStep', tag: tags.message, name: 'original', data: text });
      const errors = (rep.result as { errors?: Array<[string, { code?: string; params?: { message?: string } }]> } | undefined)?.errors ?? [];
      if (!rep.ok || rep.trap || errors.length) {
        const e = errors[0]?.[1];
        return { ok: false, reason: e ? `${e.code ?? 'error'}${e.params?.message ? `: ${e.params.message}` : ''}` : String(rep.trap ?? rep.error ?? 'no answer') };
      }
      const healed = await volume(k, tags.message);
      if (!healed) return { ok: false, reason: 'the solid has no volume' };
      const plain = await viaFeature(k, text, tags.feature);
      if (plain !== null && Math.abs(plain - healed) <= SAME_BODY * healed) return { ok: true, step: text, volume: healed };
      // the plain reading is wrong or fails: the body as healed, written out again
      const out = await k.request({ type: 'step', tag: tags.message, name: 'original' });
      if (!out.ok || typeof out.result !== 'string' || !out.result.includes('ISO-10303-21')) return { ok: false, reason: 'the healed solid could not be written as STEP' };
      const again = await viaFeature(k, out.result, tags.again);
      if (again === null || Math.abs(again - healed) > SAME_BODY * healed) return { ok: false, reason: 'the body read from the text depends on healing that a part cannot repeat' };
      return { ok: true, step: out.result, volume: healed };
  };
  return {
    normalizeStep: (text) => { let r = memo.get(text); if (!r) { r = normalize(text); memo.set(text, r); } return r; },
    volumeOf: async (part) => {
      const k = await transport();
      const r = await k.request({ type: 'regen', tag: tags.part, part, opts: { noView: true } });
      if (!r.ok || r.trap) return { volume: null, errors: 1 };
      const errors = (r.result as { errors?: unknown[] } | undefined)?.errors?.length ?? 0;
      return { volume: await volume(k, tags.part), errors };
    },
  };
}
