// Raw kernel queries for the Inspect tools. `Session` wraps massProps, but not `measure` or `interference` (a gap to
// close there); until it does, these go through the session's own transport and tag, with the same error handling.
import type { Session } from '@ck/session';
import type { KernelMeasure } from './measure';
import type { MassRaw } from './mass';

export interface Interference { bodies: number; pairs: Array<{ a: string; b: string; volume?: number; com?: number[]; box?: { min: number[]; max: number[] }; error?: string }> }

type Transport = { request(msg: Record<string, unknown>): Promise<{ ok?: boolean; result?: unknown; error?: unknown; trap?: unknown }> };

/** Send `msg` for the session's current state. Throws on a trap or an error reply; a null result stays null. */
export async function sessionQuery<T>(session: Session, msg: { type: string; [k: string]: unknown }): Promise<T | null> {
  const inner = session as unknown as { kernel: Transport; tag: string };
  const r = await inner.kernel.request({ tag: inner.tag, ...msg });
  if (r.trap) throw new Error(`trap: ${String(r.trap)}`);
  if (!r.ok) throw new Error(typeof r.error === 'string' ? r.error : 'request failed');
  return (r.result ?? null) as T | null;
}

export const queryMeasure = (s: Session, refs: Array<Record<string, unknown>>) => sessionQuery<KernelMeasure>(s, { type: 'measure', refs });
export const queryInterference = (s: Session) => sessionQuery<Interference>(s, { type: 'interference' });
export const queryMass = (s: Session, densities?: number[]) => sessionQuery<MassRaw>(s, { type: 'massProps', bodies: true, ...(densities ? { densities } : {}) });
