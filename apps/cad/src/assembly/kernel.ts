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
