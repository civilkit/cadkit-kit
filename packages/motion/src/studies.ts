// Motion studies (docs/spec-motion-studies.md, section 5): a named motion, a list of tracks (one driver each) of keyframes, played once, looped
// or ping-pong. Pure logic: sampling values at a time, mapping the play clock to the study's time, the frames a study needs from the kernel, and
// what a solved study says about contact. The player and the panel build on it.
import { poseDeltas, type Frame, type PoseReply, type Rigid } from './model';

export type Ease = 'linear' | 'inOut';
export type LoopMode = 'once' | 'loop' | 'pingpong';
export interface Key { t: number; v: number; ease?: Ease }
export interface Track { driver: string; keys: Key[] }
export interface Study { id: string; name: string; duration: number; loop: LoopMode; clearance: number; tracks: Track[]; [k: string]: unknown }

/** Frames per second the kernel is asked for (a study is solved once for these, then played from the cache). */
export const FPS = 30;
/** Most frames one study asks for (a long study gets fewer frames per second rather than a longer wait). */
export const MAX_FRAMES = 600;

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** The studies of `doc.motion`, defensively: entries without tracks (the mjcf bridge's logged joint values) are left out here and kept in the document. */
export function readStudies(motion: Record<string, unknown> | null | undefined): Study[] {
  const raw = motion?.studies;
  if (!Array.isArray(raw)) return [];
  const out: Study[] = [];
  for (const s of raw as Array<Record<string, unknown>>) {
    if (!s || typeof s.id !== 'string' || !Array.isArray(s.tracks)) continue;
    const tracks: Track[] = [];
    for (const tr of s.tracks as Array<Record<string, unknown>>) {
      if (!tr || typeof tr.driver !== 'string' || !Array.isArray(tr.keys)) continue;
      const keys = (tr.keys as Array<Record<string, unknown>>).filter((k) => k && num(k.t) && num(k.v)).map((k) => ({ t: k.t as number, v: k.v as number, ...(k.ease === 'inOut' || k.ease === 'linear' ? { ease: k.ease as Ease } : {}) }));
      keys.sort((a, b) => a.t - b.t);
      tracks.push({ driver: tr.driver, keys });
    }
    out.push({ ...s, id: s.id, name: typeof s.name === 'string' ? s.name : s.id, duration: num(s.duration) && s.duration > 0 ? s.duration : 4, loop: s.loop === 'loop' || s.loop === 'pingpong' ? s.loop : 'once', clearance: num(s.clearance) && s.clearance >= 0 ? s.clearance : 0, tracks });
  }
  return out;
}

/** The study list written back: other entries of `doc.motion.studies` are kept where they are, this study replaces the one with its id (or is appended). */
export function withStudy(motion: Record<string, unknown>, study: Study): unknown[] {
  const all = Array.isArray(motion.studies) ? [...(motion.studies as unknown[])] : [];
  const i = all.findIndex((s) => (s as { id?: unknown })?.id === study.id);
  if (i >= 0) all[i] = study; else all.push(study);
  return all;
}
export function withoutStudy(motion: Record<string, unknown>, id: string): unknown[] {
  return (Array.isArray(motion.studies) ? (motion.studies as unknown[]) : []).filter((s) => (s as { id?: unknown })?.id !== id);
}
export function newStudyId(existing: ReadonlyArray<{ id: string }>): string {
  let n = existing.length + 1;
  while (existing.some((s) => s.id === 's' + n)) n++;
  return 's' + n;
}

const smooth = (u: number): number => u * u * (3 - 2 * u);

/** Value of a track at time `t`: held before the first key and after the last, between two keys eased by the later key's ease. `null` for a track with no keys. */
export function valueAt(track: Track, t: number): number | null {
  const k = track.keys;
  if (!k.length) return null;
  if (t <= k[0].t) return k[0].v;
  const last = k[k.length - 1];
  if (t >= last.t) return last.v;
  let i = 1;
  while (k[i].t < t) i++;
  const a = k[i - 1], b = k[i];
  const u = (t - a.t) / (b.t - a.t);
  return a.v + (b.v - a.v) * (b.ease === 'inOut' ? smooth(u) : u);
}

/** The pose request of a study at time `t`: `{driver: value}` for every track that has keys. */
export function poseRequestAt(study: Study, t: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const tr of study.tracks) { const v = valueAt(tr, t); if (v !== null) out[tr.driver] = v; }
  return out;
}

/** The study time for a play clock `p` (seconds since play began): once stops at the end, loop starts over, ping-pong goes back and forth. */
export function studyTime(p: number, duration: number, loop: LoopMode): number {
  if (!(duration > 0) || p <= 0) return 0;
  if (loop === 'once') return Math.min(p, duration);
  if (loop === 'loop') return p % duration;
  const m = p % (2 * duration);
  return m <= duration ? m : 2 * duration - m;
}

/** Number of frames a study is solved for (at `FPS` up to `MAX_FRAMES`) and the time of frame `i`. */
export const frameCount = (duration: number): number => Math.min(MAX_FRAMES, Math.max(2, Math.ceil(duration * FPS) + 1));
export const frameTime = (i: number, n: number, duration: number): number => (n <= 1 ? 0 : (i / (n - 1)) * duration);

/** All poses a study needs, in time order. */
export function studyFrames(study: Study): Array<Record<string, number>> {
  const n = frameCount(study.duration);
  return Array.from({ length: n }, (_, i) => poseRequestAt(study, frameTime(i, n, study.duration)));
}

/** The index of the frame to show at study time `t`. */
export const frameAt = (t: number, n: number, duration: number): number => (n <= 1 || !(duration > 0) ? 0 : Math.max(0, Math.min(n - 1, Math.round((t / duration) * (n - 1)))));

/** A solved study: the per-component motion of each frame, and what each frame touches. */
export interface Solved { deltas: Array<ReadonlyMap<string, Rigid>>; contacts: Array<{ a: string; b: string; kind: string; distance: number } | null>; failed: Array<{ frame: number; error: string } | null> }

export function solvedFrom(assembled: ReadonlyArray<{ id: string; place?: Frame }>, poses: PoseReply[]): Solved {
  return {
    deltas: poses.map((p) => (p.ok ? poseDeltas(assembled, p) : new Map())),
    contacts: poses.map((p) => (p.contact ? { a: p.contact.a, b: p.contact.b, kind: p.contact.kind, distance: p.contact.distance } : null)),
    failed: poses.map((p, i) => (p.ok ? null : { frame: i, error: p.error ?? 'error' })),
  };
}

/** What a study does to the assembly: the first frame that touches or fails, with its time. `null` when it runs clear. */
export interface StudyIssue { kind: 'contact' | 'near' | 'solver'; time: number; a?: string; b?: string; distance?: number; error?: string }
export function firstIssue(s: Solved, duration: number): StudyIssue | null {
  const n = s.deltas.length;
  for (let i = 0; i < n; i++) {
    const t = +frameTime(i, n, duration).toFixed(3);
    const f = s.failed[i];
    if (f) return { kind: 'solver', time: t, error: f.error };
    const c = s.contacts[i];
    if (c) return { kind: c.kind === 'near' ? 'near' : 'contact', time: t, a: c.a, b: c.b, distance: c.distance };
  }
  return null;
}

/** A keyframe added at time `t` with value `v` (replacing a key within half a frame of that time). */
export function withKey(study: Study, driver: string, t: number, v: number, ease: Ease = 'inOut'): Study {
  const eps = 0.5 / FPS;
  const tracks = study.tracks.some((tr) => tr.driver === driver) ? study.tracks : [...study.tracks, { driver, keys: [] }];
  return { ...study, tracks: tracks.map((tr) => (tr.driver !== driver ? tr : { ...tr, keys: [...tr.keys.filter((k) => Math.abs(k.t - t) > eps), { t: +t.toFixed(3), v, ease }].sort((a, b) => a.t - b.t) })) };
}
export function withoutKey(study: Study, driver: string, index: number): Study {
  return { ...study, tracks: study.tracks.map((tr) => (tr.driver !== driver ? tr : { ...tr, keys: tr.keys.filter((_, i) => i !== index) })).filter((tr) => tr.keys.length > 0) };
}
