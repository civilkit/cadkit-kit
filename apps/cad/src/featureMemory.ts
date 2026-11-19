// What the feature panels remember between features: the last accepted options of each feature type (Extrude / Cut: operation, end condition,
// thin wall, draft, flip; Fillet radius; Chamfer distance; Shell thickness), so a new feature opens with them and Repeat last command reuses them.
// A Blind depth is tied to the geometry, so it is only carried when the user ticks "Remember depth" (or while repeating).
// Pure apart from the optional storage: the module-level `featureMemory` reads and writes localStorage when there is one.
import { endAllowsDraft, endNeedsObject, patchDraft, patchEnd, type EndCondition } from './optionRules';
import { t } from './i18n';

type Wire = Record<string, unknown>;

/** The feature types that have a memory, and the fields each remembers. */
export const MEMORY_KEYS: Record<string, string[]> = {
  extrude: ['op', 'end', 'flip', 'draft', 'draftOut', 'thin', 'depth'],
  fillet: ['radius'],
  chamfer: ['chamferType', 'distance', 'distance2', 'angle'],
  shell: ['thickness'],
};
export const remembersType = (type: string): boolean => type in MEMORY_KEYS;

/** The ribbon commands that make a feature whose options are remembered, and the feature type each makes. */
export const COMMAND_FEATURE: Record<string, string> = { 'add-extrude': 'extrude', 'add-cut': 'extrude', 'add-thin-extrude': 'extrude', 'add-thin-cut': 'extrude', 'add-fillet': 'fillet', 'add-chamfer': 'chamfer', 'add-shell': 'shell' };

/** The values of an accepted feature that its type remembers. A through-all-both-ways end and an end that names an object are not remembered (the first has no direction, the second a reference). */
export function pickMemory(feature: Wire): Wire {
  const type = String(feature.type ?? '');
  const keys = MEMORY_KEYS[type];
  if (!keys) return {};
  const out: Wire = {};
  for (const k of keys) {
    const v = feature[k];
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  if (type === 'extrude') {
    if (out.op !== 'cut' && out.op !== 'add') delete out.op;   // a new body is decided by the geometry
    if (typeof out.end === 'string' && endNeedsObject(out.end)) { delete out.end; delete out.depth; }
    out.flip = feature.flip === true;
    out.thin = feature.thin && typeof feature.thin === 'object' ? feature.thin : null;
  }
  return out;
}

export interface Storage1 { getItem(k: string): string | null; setItem(k: string, v: string): void }
const KEY = 'cad.featureMemory';
const defaultStorage = (): Storage1 | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

interface State { v: 1; values: Record<string, Wire>; depth: boolean }

export class FeatureMemory {
  private state: State = { v: 1, values: {}, depth: false };
  private loaded = false;
  constructor(private readonly storage: () => Storage1 | null = defaultStorage) {}
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(this.storage()?.getItem(KEY) ?? 'null') as Partial<State> | null;
      if (raw && typeof raw === 'object' && raw.values && typeof raw.values === 'object') this.state = { v: 1, values: raw.values as Record<string, Wire>, depth: raw.depth === true };
    } catch { /* unreadable: start empty */ }
  }
  private save(): void { try { this.storage()?.setItem(KEY, JSON.stringify(this.state)); } catch { /* private window: this session only */ } }
  /** Remember an accepted feature's options (a type with no memory is ignored). */
  remember(feature: Wire): void {
    this.load();
    const type = String(feature.type ?? '');
    const picked = pickMemory(feature);
    if (!remembersType(type) || !Object.keys(picked).length) return;
    this.state.values[type] = picked;
    this.save();
  }
  /** The remembered options of a type. The depth is left out unless "Remember depth" is on or `withDepth` (repeating the last feature). */
  recall(type: string, withDepth = false): Wire {
    this.load();
    const v = { ...(this.state.values[type] ?? {}) };
    if (!withDepth && !this.state.depth) delete v.depth;
    return v;
  }
  has(type: string): boolean { this.load(); return !!this.state.values[type]; }
  reset(type?: string): void {
    this.load();
    if (type) delete this.state.values[type]; else this.state.values = {};
    this.save();
  }
  get rememberDepth(): boolean { this.load(); return this.state.depth; }
  set rememberDepth(on: boolean) { this.load(); this.state.depth = on; this.save(); }
}

/** The one memory the app uses. */
export const featureMemory = new FeatureMemory();

// ---- Repeat last command: while it runs, the depth is carried too ----
let repeatDepth = 0;
export const repeating = (): boolean => repeatDepth > 0;
/** Run `fn` as a repeat of the last feature: the remembered options include the depth. */
export function whileRepeating<T>(fn: () => T): T { repeatDepth++; try { return fn(); } finally { repeatDepth--; } }
/** The options to start a new feature of this type with. */
export const recallFor = (type: string, mem: FeatureMemory = featureMemory): Wire => mem.recall(type, repeating());

// ---- applying the memory to a new feature ----

/** The operation a new extrude starts with: an explicit Cut command stays a cut; otherwise a remembered cut applies (when there is a body to cut) over the geometry's default. */
export function memoryOp(mem: Wire, explicitCut: boolean, hasSolid: boolean, geometric: 'add' | 'cut' | 'newBody'): 'add' | 'cut' | 'newBody' {
  if (explicitCut) return 'cut';
  return mem.op === 'cut' && hasSolid ? 'cut' : geometric;
}

/** A new extrude's fields with the remembered end condition, draft, thin wall and (when remembered) depth laid over them. The operation and the flip are decided by the caller. */
export function applyExtrudeMemory(base: Wire, mem: Wire): Wire {
  let out: Wire = { ...base };
  const end = typeof mem.end === 'string' ? (mem.end as EndCondition) : null;
  if (end && end !== 'blind') out = { ...out, ...patchEnd(out, end) };
  else if (end === 'blind' && out.end !== 'blind') out = { ...out, ...patchEnd(out, 'blind') };
  if (typeof mem.depth === 'number' && (out.end === undefined || out.end === 'blind' || out.end === 'mid')) out.depth = mem.depth;
  const curEnd = typeof out.end === 'string' ? out.end : 'blind';
  if (typeof mem.draft === 'number' && mem.draft > 0 && endAllowsDraft(curEnd)) {
    out = { ...out, ...patchDraft(out, mem.draft) };
    if (mem.draftOut === true) out.draftOut = true;
  }
  if (!out.thin && mem.thin && typeof mem.thin === 'object') out.thin = mem.thin;
  for (const k of Object.keys(out)) if (out[k] === null) delete out[k];
  return out;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
/** The fillet radius a new fillet starts with: the remembered one, else `fallback`. */
export const rememberedRadius = (fallback: number, mem: FeatureMemory = featureMemory): number => num(recallFor('fillet', mem).radius) ?? fallback;
/** The chamfer fields a new chamfer starts with (type and distances). */
export function rememberedChamfer(fallbackDistance: number, mem: FeatureMemory = featureMemory): Wire {
  const m = recallFor('chamfer', mem);
  const type = m.chamferType === 'distances' || m.chamferType === 'angle' ? m.chamferType : 'equal';
  return {
    chamferType: type, distance: num(m.distance) ?? fallbackDistance,
    ...(type === 'distances' && num(m.distance2) ? { distance2: m.distance2 } : {}),
    ...(type === 'angle' && num(m.angle) ? { angle: m.angle } : {}),
  };
}
/** The shell thickness a new shell starts with. */
export const rememberedThickness = (fallback: number, mem: FeatureMemory = featureMemory): number => num(recallFor('shell', mem).thickness) ?? fallback;

// ---- the Repeat last command's tooltip ----

const label = (k: string, fallback: string): string => { const s = t(k); return s === k ? fallback : s; };

/** One line naming the feature a command makes and the options a repeat would use, or undefined when the command is not a remembered feature. */
export function describeRepeat(commandId: string | null, mem: FeatureMemory = featureMemory): string | undefined {
  const type = commandId ? COMMAND_FEATURE[commandId] : undefined;
  if (!commandId || !type) return undefined;
  const m = mem.recall(type, true);
  const parts: string[] = [];
  if (type === 'extrude') {
    if (m.op === 'cut' || commandId.includes('cut')) parts.push(t('opt.op.cut'));
    if (typeof m.end === 'string') parts.push(t('opt.end.' + m.end));
    if (typeof m.depth === 'number' && (m.end === undefined || m.end === 'blind' || m.end === 'mid')) parts.push(`${m.depth} mm`);
    if (m.flip === true) parts.push(t('opt.flip'));
    if (typeof m.draft === 'number') parts.push(`${t('opt.draft')} ${m.draft}°`);
    if (m.thin) parts.push(t('opt.thin.on'));
  } else if (type === 'fillet' && typeof m.radius === 'number') parts.push(`${m.radius} mm`);
  else if (type === 'chamfer' && typeof m.distance === 'number') parts.push(`${m.distance} mm`);
  else if (type === 'shell' && typeof m.thickness === 'number') parts.push(`${m.thickness} mm`);
  const name = label('cmd.' + commandId, commandId);
  return parts.length ? t('cmd.repeat-last.tip', { what: name, options: parts.join(', ') }) : t('cmd.repeat-last.tipPlain', { what: name });
}
