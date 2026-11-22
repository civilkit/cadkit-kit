// Raw kernel queries for the Inspect tools. `Session` wraps massProps, but not `measure` or `interference` (a gap to
// close there); until it does, these go through the session's own transport and tag, with the same error handling.
import type { Session } from '@ck/session';
import type { KernelMeasure } from './measure';
import type { MassRaw } from './mass';

export interface Interference { bodies: number; pairs: Array<{ a: string; b: string; volume?: number; com?: number[]; box?: { min: number[]; max: number[] }; error?: string }> }

/** One span of a marched intersection curve that was not proved as traced (`repaired`: proved after points of the arc were inserted). */
export interface IntersectionIssue { a: string; b: string; curve: number; span: number; reason: 'unsupported' | 'singular' | 'noContraction' | 'degenerate' | string; repaired?: boolean; from?: number[]; to?: number[] }
/** The kernel's `checkIntersection`: per pair of faces, how many spans of the marched intersection curves are proved to lie on one arc of the true intersection. */
export interface IntersectionCheck {
  curves: number; marched: number; spans: number; proved: number; repaired: number; unresolved: number; pairs: number;
  byPair?: Array<{ a: string; b: string; curves: number; marched: number; spans: number; proved: number; unresolved: number }>;
  issues: IntersectionIssue[]; elapsedMs?: number; truncated?: boolean;
}

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
/** `a` and `b`: face names, or `body` for every face. A face is never paired with itself. */
export const queryIntersection = (s: Session, a: string | string[], b: string | string[]) => sessionQuery<IntersectionCheck>(s, { type: 'checkIntersection', a, b });
export const queryMass = (s: Session, densities?: number[]) => sessionQuery<MassRaw>(s, { type: 'massProps', bodies: true, ...(densities ? { densities } : {}) });

/** One flat face of a `faceRun` reply: where a Press Pull on it starts and how far its outline reaches from its area centre (the angle readout of a scale taper). `endOf` names the extrude, revolve or sweep the face is the moving end of. */
export interface FaceRunItem { face: string; found: boolean; flat?: boolean; centre?: number[]; normal?: number[]; reach?: number; area?: number; endOf?: { feature: string; kind: string; input: string } | null }
/** The kernel's faceRun query on the session's state (or the state of a scratch tag): per face its flatness, centre, normal, reach and area. */
export const queryFaceRun = (s: Session, faces: string[]) => sessionQuery<{ items: FaceRunItem[] }>(s, { type: 'faceRun', faces });
