// Kernel reads the Session does not expose: the `components[]` of a regen reply (id, degrees of freedom, placement) and the volume
// of a part on its own (for the bill of materials). Both go through the session's own transport.
import type { Session } from '@ck/session';

export interface AsmComponent { id: string; dof: number; place?: { o: number[]; x: number[]; y: number[]; z: number[] } }

/** The `assembly` object of a regen reply asked with `opts.dofReport`: remaining freedom in total and per component, and the mates that are redundant or rejected. */
export interface AsmReport {
  dof: { total: number; translational: number; rotational: number };
  components: Array<{ id: string; fixed: boolean; dof: number; translational: number; rotational: number }>;
  overConstrained: boolean;
  redundant: string[];
  conflicts: Array<{ mate: string; with: string[] }>;
  truncated?: boolean;
}
/** A feature the kernel rejected: its code and the `detail` / neighbouring `mates` of the structured error (mateGeometry, mateConflict). */
export interface AsmFeatureError { code: string; detail?: string; mates?: string[] }
export interface AsmExtra { report: AsmReport | null; errors: Map<string, AsmFeatureError> }

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
/** Read the `assembly` object defensively (a reply without it, or with fields missing, gives null / zeros). */
export function readReport(a: unknown): AsmReport | null {
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  const d = (o.dof ?? {}) as Record<string, unknown>;
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    dof: { total: num(d.total), translational: num(d.translational), rotational: num(d.rotational) },
    components: Array.isArray(o.components) ? (o.components as Array<Record<string, unknown>>).map((c) => ({ id: String(c.id), fixed: c.fixed === true, dof: num(c.dof), translational: num(c.translational), rotational: num(c.rotational) })) : [],
    overConstrained: o.overConstrained === true,
    redundant: strs(o.redundant),
    conflicts: Array.isArray(o.conflicts) ? (o.conflicts as Array<Record<string, unknown>>).map((c) => ({ mate: String(c.mate), with: strs(c.with) })) : [],
    ...(o.truncated === true ? { truncated: true } : {}),
  };
}
/** The structured errors of a regen reply (`[featureId, {code, params}]`) with the mate detail kept. */
export function readErrors(e: unknown): Map<string, AsmFeatureError> {
  const out = new Map<string, AsmFeatureError>();
  if (!Array.isArray(e)) return out;
  for (const item of e) {
    if (!Array.isArray(item) || typeof item[0] !== 'string') continue;
    const err = (item[1] ?? {}) as { code?: unknown; params?: Record<string, unknown> };
    const p = err.params ?? {};
    out.set(item[0], { code: String(err.code ?? 'error'), ...(typeof p.detail === 'string' ? { detail: p.detail } : {}), ...(Array.isArray(p.mates) ? { mates: p.mates.filter((x): x is string => typeof x === 'string') } : {}) });
  }
  return out;
}

type Reply = { ok?: boolean; result?: unknown; error?: unknown; trap?: unknown };
type Kernel = { request(msg: Record<string, unknown>): Promise<Reply> };
type Inner = { kernel?: Kernel; tag?: string };

/** Report the `components` of every regen the session makes of its own document (same tag; previews and queries use other tags).
 *  The session drops that field, so the transport it holds is wrapped to read it on the way back. Does nothing when the session has no transport. */
export function watchComponents(session: Session, on: (c: AsmComponent[], extra: AsmExtra) => void): void {
  const inner = session as unknown as Inner;
  const k = inner.kernel;
  if (!k || typeof k.request !== 'function' || !inner.tag) return;
  const tag = inner.tag;
  const wrapped = new Proxy(k, {
    get(target, prop) {
      if (prop === 'request') {
        return async (msg: Record<string, unknown>) => {
          // the report is asked for on every regen of the document itself: it is what the DOF summary and the rolled-back notes read
          if (msg.type === 'regen' && msg.tag === tag) msg = { ...msg, opts: { ...((msg.opts as Record<string, unknown> | undefined) ?? {}), dofReport: true } };
          const r = await target.request(msg);
          if (msg.type === 'regen' && msg.tag === tag && r?.ok && r.result) {
            const res = r.result as { components?: unknown; assembly?: unknown; errors?: unknown };
            on(Array.isArray(res.components) ? (res.components as AsmComponent[]) : [], { report: readReport(res.assembly), errors: readErrors(res.errors) });
          }
          return r;
        };
      }
      const v = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  inner.kernel = wrapped as Kernel;
}

const cache = new Map<string, { volume: number | null; error?: string }>();

/** Volume of a part document (unit density, mm3). Cached by the part's text. */
export async function partMassProps(session: Session, part: unknown): Promise<{ volume: number | null; error?: string }> {
  const inner = session as unknown as Inner;
  const k = inner.kernel;
  if (!k || !inner.tag) return { volume: null, error: 'no kernel' };
  const key = JSON.stringify(part);
  const hit = cache.get(key);
  if (hit) return hit;
  const tag = `${inner.tag}-bom`;
  let out: { volume: number | null; error?: string };
  try {
    const r = await k.request({ type: 'regen', tag, part });
    const errors = (r.result as { errors?: unknown[] } | undefined)?.errors ?? [];
    if (r.trap || !r.ok) out = { volume: null, error: String(r.trap ?? r.error ?? 'regen failed') };
    else if (errors.length) out = { volume: null, error: 'rebuild errors' };
    else {
      const m = await k.request({ type: 'massProps', tag });
      const v = (m.result as { volume?: number } | undefined)?.volume;
      out = m.ok && typeof v === 'number' ? { volume: v } : { volume: null, error: 'no volume' };
    }
  } catch (e) { out = { volume: null, error: (e as Error).message }; }
  cache.set(key, out);
  return out;
}

export type KernelFaceGeo =
  | { kind: 'plane'; o: [number, number, number]; n: [number, number, number] }
  | { kind: 'cylinder' | 'cone'; o: [number, number, number]; d: [number, number, number]; r?: number }
  | { kind: 'sphere'; c: [number, number, number]; r: number }
  | { kind: 'other' };

export interface UrdfKernelData {
  /** Exact per-component (insertPart feature id) local mass properties from the kernel. */
  componentMass: Map<string, { volume?: number; com?: number[]; inertia?: number[][]; principal?: number[]; axes?: number[][] }>;
  /** World-frame face geometry keyed by face name for active mates. */
  faceGeo: Map<string, KernelFaceGeo>;
}

const vec3 = (a: unknown): [number, number, number] =>
  Array.isArray(a) && a.length >= 3 && a.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? [a[0], a[1], a[2]] : [0, 0, 0];

const unit3 = (v: [number, number, number]): [number, number, number] => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : [0, 0, 1];
};

/** Read per-component B-rep mass properties and mate face geometry for URDF export. Runs on the session's kernel transport
 *  without disturbing the open document (per-part regens use a dedicated scratch tag). */
export async function urdfKernelData(
  session: Session,
  doc: { features?: Array<Record<string, unknown>> },
): Promise<UrdfKernelData> {
  const componentMass = new Map<string, { volume?: number; com?: number[]; inertia?: number[][]; principal?: number[]; axes?: number[][] }>();
  const faceGeo = new Map<string, KernelFaceGeo>();
  const inner = session as unknown as Inner;
  const k = inner.kernel;
  if (!k || !inner.tag || !Array.isArray(doc.features)) return { componentMass, faceGeo };

  const live = doc.features.filter((f) => f.suppressed !== true);

  // Per-component exact B-rep mass properties (deduplicated by part content)
  const inserts = live.filter((f) => f.type === 'insertPart' && f.part);
  const byPartText = new Map<string, { volume?: number; com?: number[]; inertia?: number[][]; principal?: number[]; axes?: number[][] } | null>();
  const ptag = `${inner.tag}-urdf`;
  for (const f of inserts) {
    const id = String(f.id ?? '');
    if (!id) continue;
    const text = JSON.stringify(f.part);
    let m = byPartText.get(text);
    if (m === undefined) {
      m = null;
      try {
        const r = await k.request({ type: 'regen', tag: ptag, part: f.part });
        if (r?.ok && !r.trap) {
          const mr = await k.request({ type: 'massProps', tag: ptag });
          if (mr?.ok && mr.result && typeof mr.result === 'object') {
            m = mr.result as { volume?: number; com?: number[]; inertia?: number[][]; principal?: number[]; axes?: number[][] };
          }
        }
      } catch { /* fall back to mesh inertia */ }
      byPartText.set(text, m);
    }
    if (m) componentMass.set(id, m);
  }

  // Face geometry for active mates at the current assembled pose
  const faceNames = new Set<string>();
  for (const f of live) {
    if (f.type !== 'mate') continue;
    for (const key of ['a', 'b', 'a2', 'b2', 'c']) {
      if (typeof f[key] === 'string' && f[key]) faceNames.add(f[key] as string);
    }
  }
  const names = [...faceNames];
  if (names.length) {
    type MeasureItem = { surface?: string; normal?: number[]; center?: number[]; axis?: number[]; radius?: number };
    let items: Array<MeasureItem | null> = [];
    try {
      const mr = await k.request({ type: 'measure', tag: inner.tag, refs: names.map((id) => ({ kind: 'face', id })) });
      if (mr?.ok && mr.result && Array.isArray((mr.result as { items?: unknown }).items)) {
        items = (mr.result as { items: Array<MeasureItem | null> }).items;
      }
    } catch {
      for (const id of names) {
        try {
          const mr = await k.request({ type: 'measure', tag: inner.tag, refs: [{ kind: 'face', id }] });
          const one = mr?.ok && mr.result ? (mr.result as { items?: Array<MeasureItem | null> }).items?.[0] ?? null : null;
          items.push(one);
        } catch { items.push(null); }
      }
    }
    let cents: Array<{ centroid?: number[] }> = [];
    try {
      const dr = await k.request({ type: 'describe', tag: inner.tag, names });
      if (dr?.ok && dr.result && Array.isArray((dr.result as { items?: unknown }).items)) {
        cents = (dr.result as { items: Array<{ centroid?: number[] }> }).items;
      }
    } catch { /* centroids optional */ }

    names.forEach((n, i) => {
      const it = items[i];
      if (!it) { faceGeo.set(n, { kind: 'other' }); return; }
      const c = vec3(cents[i]?.centroid);
      if (it.surface === 'plane' && it.normal) faceGeo.set(n, { kind: 'plane', o: c, n: unit3(vec3(it.normal)) });
      else if ((it.surface === 'cylinder' || it.surface === 'cone') && it.axis) faceGeo.set(n, { kind: it.surface, o: vec3(it.center), d: unit3(vec3(it.axis)), ...(typeof it.radius === 'number' ? { r: it.radius } : {}) });
      else if (it.surface === 'sphere' && it.center) faceGeo.set(n, { kind: 'sphere', c: vec3(it.center), r: it.radius ?? 0 });
      else faceGeo.set(n, { kind: 'other' });
    });
  }

  return { componentMass, faceGeo };
}
