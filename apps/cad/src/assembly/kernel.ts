// Kernel reads the Session does not expose: the `components[]` of a regen reply (id, degrees of freedom, placement) and the volume
// of a part on its own (for the bill of materials). Both go through the session's own transport.
import type { Session } from '@ck/session';

export interface AsmComponent { id: string; dof: number; place?: { o: number[]; x: number[]; y: number[]; z: number[] } }

type Reply = { ok?: boolean; result?: unknown; error?: unknown; trap?: unknown };
type Kernel = { request(msg: Record<string, unknown>): Promise<Reply> };
type Inner = { kernel?: Kernel; tag?: string };

/** Report the `components` of every regen the session makes of its own document (same tag; previews and queries use other tags).
 *  The session drops that field, so the transport it holds is wrapped to read it on the way back. Does nothing when the session has no transport. */
export function watchComponents(session: Session, on: (c: AsmComponent[]) => void): void {
  const inner = session as unknown as Inner;
  const k = inner.kernel;
  if (!k || typeof k.request !== 'function' || !inner.tag) return;
  const tag = inner.tag;
  const wrapped = new Proxy(k, {
    get(target, prop) {
      if (prop === 'request') {
        return async (msg: Record<string, unknown>) => {
          const r = await target.request(msg);
          if (msg.type === 'regen' && msg.tag === tag && r?.ok && r.result) {
            const c = (r.result as { components?: unknown }).components;
            on(Array.isArray(c) ? (c as AsmComponent[]) : []);
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
