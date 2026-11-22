// Threads in patterns and mirrors (pure rules, no DOM). The kernel copies the threads of a pattern's seeds onto every
// instance (docs: "Threads in patterns and mirrors"): a thread feature whose face was made by a seed, listed before the
// pattern or after it, follows the seed unless the pattern says `carryThreads: false`; a thread listed in `seeds` is
// copied even then. The copies are not features: they are result entries named `<thread>@<pattern>.<k>` with `instanceOf`.
type Wire = Record<string, unknown>;

export const PATTERN_TYPES = ['lpattern', 'cpattern', 'mirror'] as const;
export const isPatternType = (type: unknown): boolean => PATTERN_TYPES.includes(type as never);

/** The feature a face name belongs to: the last `@F7.2` instance suffix names the pattern, else the id before the first dot. */
export function hostOf(face: unknown): string {
  if (typeof face !== 'string') return '';
  const at = face.lastIndexOf('@');
  return at >= 0 ? face.slice(at + 1).split('.')[0] : face.split('.')[0];
}

/** Does the pattern carry the threads of its seeds (the default)? */
export const carriesThreads = (pattern: Wire): boolean => pattern.carryThreads !== false;

/** The patch for the "Carry threads" checkbox: `null` removes the field (the default is on). */
export const carryPatch = (on: boolean): Wire => ({ carryThreads: on ? null : false });

const seedsOf = (pattern: Wire): string[] => (Array.isArray(pattern.seeds) ? pattern.seeds.filter((s): s is string => typeof s === 'string') : []);

/** The thread features sitting on faces of feature `id`, in history order (suppressed ones left out). */
export function threadsOf(features: Wire[], id: string): Wire[] {
  return features.filter((f) => f.type === 'thread' && !f.suppressed && hostOf(f.face) === id);
}

export interface SeedInfo {
  id: string;
  /** The geometry seed's own type (`hole`, `extrude`, ...); '' when the id is unknown. */
  type: string;
  /** Thread features that follow this seed. */
  threads: string[];
  /** The seed is itself a thread feature (copied explicitly). */
  isThread: boolean;
}

/** What each seed of a pattern is and which threads come along with it. */
export function seedInfos(features: Wire[], pattern: Wire): SeedInfo[] {
  return seedsOf(pattern).map((id) => {
    const f = features.find((x) => x.id === id);
    const isThread = f?.type === 'thread';
    return { id, type: typeof f?.type === 'string' ? f.type : '', threads: isThread ? [] : carriesThreads(pattern) ? threadsOf(features, id).map((t) => String(t.id)) : [], isThread };
  });
}

/** `Hole F4 + Thread F5` : the seed with the threads that follow it. `name(type)` gives the display name of a feature type. */
export function seedLabel(info: SeedInfo, name: (type: string) => string): string {
  const base = `${info.type ? name(info.type) : ''} ${info.id}`.trim();
  return info.threads.length ? `${base} + ${name('thread')} ${info.threads.join(', ')}` : base;
}

/** For the history tree: the patterns / mirrors that copy each feature (seeds and the threads that ride along), id -> pattern ids. */
export function patternedBy(features: Wire[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (id: string, by: string) => { (out[id] ??= []).includes(by) || out[id].push(by); };
  for (const p of features) {
    if (!isPatternType(p.type) || p.suppressed) continue;
    const pid = String(p.id);
    for (const s of seedInfos(features, p)) {
      add(s.id, pid);
      for (const t of s.threads) add(t, pid);
    }
    if (p.type === 'mirror' && p.body === true && carriesThreads(p)) for (const t of features.filter((f) => f.type === 'thread' && !f.suppressed)) add(String(t.id), pid);
  }
  return out;
}

/**
 * Where a thread row sits in the tree: directly under its hole (or other host feature) when it follows it in the history
 * (the host, its sketch and sibling threads between them only). Otherwise it stays at the top level.
 */
export function threadParents(features: Wire[]): Record<string, string> {
  const out: Record<string, string> = {};
  features.forEach((f, i) => {
    if (f.type !== 'thread') return;
    const host = hostOf(f.face);
    const h = features.findIndex((x) => x.id === host);
    if (h < 0 || h >= i) return;
    for (let k = h + 1; k < i; k++) if (features[k].type !== 'thread' || hostOf(features[k].face) !== host) return;
    out[String(f.id)] = host;
  });
  return out;
}

/** A regen thread entry, the fields used here. */
export interface ThreadEntry { id?: string; face?: string; instanceOf?: string; size?: string; standard?: string; hand?: string; pattern?: string }

/** Faces that already carry a thread copied by a pattern: the thread to edit instead (`face` -> source thread id). */
export function followedFaces(faces: string[], entries: ThreadEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of faces) {
    const e = entries.find((x) => x.face === f && typeof x.instanceOf === 'string');
    if (e?.instanceOf) out[f] = e.instanceOf;
  }
  return out;
}

/** A thread entry is a copy made by a pattern or mirror (read-only: edit the source thread). */
export const isInstanceEntry = (e: ThreadEntry | undefined): boolean => !!e && typeof e.instanceOf === 'string';

/** How many threads of this one design there are: the source plus its copies (the `4x` of `4x M5`). */
export function instanceCount(entries: ThreadEntry[], id: string): number {
  return entries.filter((e) => e.id === id || e.instanceOf === id).length;
}

/** `4x M5` for a count above one, else the label alone. */
export const countedLabel = (n: number, label: string): string => (n > 1 ? `${n}x ${label}` : label);

/**
 * How many copies of a seed feature exist counting the seed: the product of the counts of the patterns (and 2 per mirror)
 * that repeat it. 1 when nothing repeats it; patterns whose count is an expression are not counted. Used for the `4x M5`
 * of drawing callouts, where the entries of a regen are not at hand.
 */
export function seedCount(features: Wire[], id: string): number {
  let n = 1;
  for (const p of features) {
    if (!isPatternType(p.type) || p.suppressed || !seedsOf(p).includes(id)) continue;
    if (p.type === 'mirror') { n *= 2; continue; }
    const c = typeof p.count === 'number' ? p.count : typeof p.count === 'string' && /^\d+$/.test(p.count) ? Number(p.count) : 1;
    if (c > 1) n *= Math.round(c);
  }
  return n;
}
