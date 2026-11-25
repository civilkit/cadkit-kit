// Linked external components, shared instances, and flexible subassemblies.
// Pure functions and EditOp builders for linking insertPart features to external sources (tabs, files, libraries),
// detecting out-of-date snapshots, syncing shared instances, breaking links, and articulating flexible subassemblies.
import type { EditOp } from '@ck/session';
import type { DocLike, Placement } from './model';

export type LinkedSourceKind = 'file' | 'tab' | 'library';

export interface LinkedComponentRef {
  sourceKind: LinkedSourceKind;
  sourceUri: string;
  sourceHash: string;
  lastSyncedAt?: string;
  outOfDate?: boolean;
}

export interface AvailableComponentSource {
  sourceKind?: LinkedSourceKind;
  sourceUri: string;
  name?: string;
  part: Record<string, unknown>;
  sourceHash?: string;
}

export type AvailableSourcesInput =
  | ReadonlyArray<AvailableComponentSource | { uri?: string; id?: string; kind?: LinkedSourceKind; sourceKind?: LinkedSourceKind; sourceUri?: string; part?: Record<string, unknown>; sourcePart?: Record<string, unknown>; doc?: Record<string, unknown>; sourceHash?: string; hash?: string; name?: string }>
  | ReadonlyMap<string, AvailableComponentSource | Record<string, unknown>>
  | Record<string, AvailableComponentSource | Record<string, unknown>>;

export interface LinkedComponentStatus {
  featureId: string;
  name: string;
  linked: boolean;
  linkedRef?: LinkedComponentRef;
  sourceKind?: LinkedSourceKind;
  sourceUri?: string;
  embeddedHash: string;
  latestHash?: string;
  sourceAvailable: boolean;
  outOfDate: boolean;
  /** Feature IDs of all insertPart components in this assembly linked to the same sourceUri. */
  sharedInstanceIds: string[];
}

export interface LiftedSubassemblyMate {
  id: string;
  type: 'mate';
  kind: string;
  name?: string;
  a?: unknown;
  b?: unknown;
  a2?: unknown;
  b2?: unknown;
  c?: unknown;
  componentA?: string;
  componentB?: string;
  subassemblyId: string;
  sourceMateId: string;
  parentTransform: Placement;
  [k: string]: unknown;
}

export interface SubassemblyComponentTransform {
  id: string;
  subassemblyId: string;
  sourceComponentId: string;
  name: string;
  flexible: boolean;
  parentTransform: Placement;
  localTransform: Placement;
  worldTranslation: [number, number, number];
}

const TRANSIENT_KEYS = new Set(['viewCache', 'thumbnail', 'linkedRef']);

function canonicalizeForHash(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalizeForHash);
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([k, val]) => !TRANSIENT_KEYS.has(k) && val !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, val]) => [k, canonicalizeForHash(val)] as const);
    return Object.fromEntries(entries);
  }
  return v;
}

/** Deterministic content hash for a part document snapshot. */
export function computePartHash(part: unknown): string {
  if (!part || typeof part !== 'object') return '0000000000000000';
  const text = JSON.stringify(canonicalizeForHash(part));
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export function isLinkedComponentRef(v: unknown): v is LinkedComponentRef {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    (r.sourceKind === 'file' || r.sourceKind === 'tab' || r.sourceKind === 'library') &&
    typeof r.sourceUri === 'string' &&
    r.sourceUri.length > 0 &&
    typeof r.sourceHash === 'string'
  );
}

function embeddedPartOf(feature: Record<string, unknown>): Record<string, unknown> | undefined {
  const p = feature.part ?? feature.sourcePart;
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : undefined;
}

function cloneValue<T>(v: T): T {
  if (v === undefined || v === null || typeof v !== 'object') return v;
  return JSON.parse(JSON.stringify(v)) as T;
}

interface NormalizedSource {
  sourceKind: LinkedSourceKind;
  sourceUri: string;
  name?: string;
  part: Record<string, unknown>;
  sourceHash: string;
}

function isSourceWrapper(v: Record<string, unknown>): boolean {
  return (
    ('part' in v && typeof v.part === 'object' && v.part !== null && !Array.isArray(v.part)) ||
    ('sourcePart' in v && typeof v.sourcePart === 'object' && v.sourcePart !== null) ||
    ('doc' in v && typeof v.doc === 'object' && v.doc !== null) ||
    typeof v.sourceUri === 'string' ||
    typeof v.sourceHash === 'string'
  );
}

export function normalizeAvailableSources(input: AvailableSourcesInput = []): Map<string, NormalizedSource> {
  const map = new Map<string, NormalizedSource>();
  if (!input) return map;

  const addEntry = (uriKey: string, raw: Record<string, unknown>) => {
    if (!raw || typeof raw !== 'object') return;
    if (isSourceWrapper(raw)) {
      const partObj = (raw.part ?? raw.sourcePart ?? raw.doc) as Record<string, unknown> | undefined;
      if (!partObj || typeof partObj !== 'object') return;
      const uri = String(raw.sourceUri ?? raw.uri ?? raw.id ?? uriKey);
      if (!uri) return;
      const kindRaw = raw.sourceKind ?? raw.kind;
      const sourceKind: LinkedSourceKind =
        kindRaw === 'file' || kindRaw === 'tab' || kindRaw === 'library'
          ? kindRaw
          : uri.startsWith('tab:')
            ? 'tab'
            : uri.startsWith('library:')
              ? 'library'
              : 'file';
      const hashRaw = typeof raw.sourceHash === 'string' && raw.sourceHash ? raw.sourceHash : typeof raw.hash === 'string' && raw.hash ? raw.hash : computePartHash(partObj);
      map.set(uri, {
        sourceKind,
        sourceUri: uri,
        name: typeof raw.name === 'string' ? raw.name : typeof partObj.name === 'string' ? partObj.name : undefined,
        part: partObj,
        sourceHash: hashRaw,
      });
    } else {
      const uri = uriKey;
      if (!uri) return;
      const sourceKind: LinkedSourceKind = uri.startsWith('tab:') ? 'tab' : uri.startsWith('library:') ? 'library' : 'file';
      map.set(uri, {
        sourceKind,
        sourceUri: uri,
        name: typeof raw.name === 'string' ? raw.name : undefined,
        part: raw,
        sourceHash: computePartHash(raw),
      });
    }
  };

  if (Array.isArray(input)) {
    for (const item of input) {
      if (item && typeof item === 'object') {
        const r = item as Record<string, unknown>;
        const uri = String(r.sourceUri ?? r.uri ?? r.id ?? '');
        addEntry(uri, r);
      }
    }
  } else if (input instanceof Map) {
    for (const [k, v] of input.entries()) {
      if (v && typeof v === 'object') addEntry(String(k), v as Record<string, unknown>);
    }
  } else if (typeof input === 'object') {
    for (const [k, v] of Object.entries(input)) {
      if (v && typeof v === 'object') addEntry(k, v as Record<string, unknown>);
    }
  }
  return map;
}

function buildLinkedRef(
  feature: Record<string, unknown>,
  ref: Omit<LinkedComponentRef, 'sourceHash'> & { sourceHash?: string },
): LinkedComponentRef {
  const embedded = embeddedPartOf(feature);
  const sourceHash = typeof ref.sourceHash === 'string' && ref.sourceHash.length > 0 ? ref.sourceHash : computePartHash(embedded);
  return {
    sourceKind: ref.sourceKind,
    sourceUri: ref.sourceUri,
    sourceHash,
    lastSyncedAt: ref.lastSyncedAt ?? new Date().toISOString(),
    outOfDate: ref.outOfDate ?? false,
  };
}

/** Attach a `LinkedComponentRef` to an `insertPart` feature, returning an updated document copy. */
export function linkInsertedPart<D extends DocLike>(
  part: D,
  featureId: string,
  ref: Omit<LinkedComponentRef, 'sourceHash'> & { sourceHash?: string },
): D {
  if (!part || !Array.isArray(part.features)) return part;
  let changed = false;
  const features = part.features.map((f) => {
    if (f.id !== featureId || f.type !== 'insertPart') return f;
    changed = true;
    const linkedRef = buildLinkedRef(f, ref);
    return {
      ...f,
      source: typeof f.source === 'string' && f.source ? f.source : ref.sourceUri,
      linkedRef,
    };
  });
  return changed ? ({ ...part, features } as D) : part;
}

/** EditOps to link an `insertPart` feature in a session edit. */
export function linkInsertedPartOps(
  part: DocLike,
  featureId: string,
  ref: Omit<LinkedComponentRef, 'sourceHash'> & { sourceHash?: string },
): EditOp[] {
  const f = part.features.find((x) => x.id === featureId && x.type === 'insertPart');
  if (!f) return [];
  const linkedRef = buildLinkedRef(f, ref);
  return [{ op: 'set', id: featureId, path: 'linkedRef', value: linkedRef }];
}

/** Inspect all linked `insertPart` features in `part` and detect whether available external sources have a newer hash. */
export function getLinkedComponentStatus(
  part: DocLike | null | undefined,
  availableSources: AvailableSourcesInput = [],
): LinkedComponentStatus[] {
  if (!part || !Array.isArray(part.features)) return [];
  const sources = normalizeAvailableSources(availableSources);
  const inserts = part.features.filter((f) => f.type === 'insertPart');

  const byUri = new Map<string, string[]>();
  for (const f of inserts) {
    if (isLinkedComponentRef(f.linkedRef)) {
      const uri = f.linkedRef.sourceUri;
      const list = byUri.get(uri) ?? [];
      list.push(f.id);
      byUri.set(uri, list);
    }
  }

  const statuses: LinkedComponentStatus[] = [];
  for (const f of inserts) {
    if (!isLinkedComponentRef(f.linkedRef)) continue;
    const ref = f.linkedRef;
    const embedded = embeddedPartOf(f);
    const embeddedHash = computePartHash(embedded);
    const ext = sources.get(ref.sourceUri);
    const sourceAvailable = !!ext;
    const latestHash = ext?.sourceHash;
    const comparableEmbeddedHash =
      ext && embedded && (ext.part.material === undefined || ext.part.material === '') && embedded.material !== ext.part.material
        ? computePartHash({ ...embedded, material: ext.part.material })
        : embeddedHash;
    const outOfDate = ext
      ? Boolean(ref.outOfDate) || ext.sourceHash !== ref.sourceHash || ext.sourceHash !== comparableEmbeddedHash
      : Boolean(ref.outOfDate);
    statuses.push({
      featureId: f.id,
      name: String(f.name ?? f.id),
      linked: true,
      linkedRef: { ...ref, outOfDate },
      sourceKind: ref.sourceKind,
      sourceUri: ref.sourceUri,
      embeddedHash,
      ...(latestHash !== undefined ? { latestHash } : {}),
      sourceAvailable,
      outOfDate,
      sharedInstanceIds: byUri.get(ref.sourceUri) ?? [f.id],
    });
  }
  return statuses;
}

/** Status of a single `insertPart` feature (whether linked or unlinked). */
export function getComponentLinkStatus(
  part: DocLike | null | undefined,
  featureId: string,
  availableSources: AvailableSourcesInput = [],
): LinkedComponentStatus | null {
  if (!part || !Array.isArray(part.features)) return null;
  const f = part.features.find((x) => x.id === featureId && x.type === 'insertPart');
  if (!f) return null;
  if (isLinkedComponentRef(f.linkedRef)) {
    return getLinkedComponentStatus(part, availableSources).find((s) => s.featureId === featureId) ?? null;
  }
  return {
    featureId: f.id,
    name: String(f.name ?? f.id),
    linked: false,
    embeddedHash: computePartHash(embeddedPartOf(f)),
    sourceAvailable: false,
    outOfDate: false,
    sharedInstanceIds: [f.id],
  };
}

/** Build the EditOps and updated document for syncing linked `insertPart` components and all shared instances sharing their `sourceUri`. */
export function updateLinkedComponentsOps<D extends DocLike>(
  part: D,
  availableSources: AvailableSourcesInput,
  featureIds?: readonly string[],
): { part: D; ops: EditOp[]; updatedIds: string[] } {
  if (!part || !Array.isArray(part.features)) {
    return { part, ops: [], updatedIds: [] };
  }
  const sources = normalizeAvailableSources(availableSources);
  const targetUris = new Set<string>();
  const targetIds = featureIds ? new Set(featureIds) : null;

  for (const f of part.features) {
    if (f.type !== 'insertPart' || !isLinkedComponentRef(f.linkedRef)) continue;
    if (!targetIds || targetIds.has(f.id)) {
      targetUris.add(f.linkedRef.sourceUri);
    }
  }

  const ops: EditOp[] = [];
  const updatedIds: string[] = [];
  const syncedAt = new Date().toISOString();

  const nextFeatures = part.features.map((f) => {
    if (f.type !== 'insertPart' || !isLinkedComponentRef(f.linkedRef)) return f;
    const ref = f.linkedRef;
    // Sync if this feature was targeted directly OR is a shared instance referencing a targeted sourceUri
    if (targetIds && !targetIds.has(f.id) && !targetUris.has(ref.sourceUri)) return f;
    const src = sources.get(ref.sourceUri);
    if (!src) return f;

    const oldEmbedded = embeddedPartOf(f);
    const nextEmbedded: Record<string, unknown> = cloneValue(src.part);
    if (
      (nextEmbedded.material === undefined || nextEmbedded.material === '') &&
      oldEmbedded &&
      typeof oldEmbedded.material === 'string' &&
      oldEmbedded.material
    ) {
      nextEmbedded.material = oldEmbedded.material;
    }

    const nextRef: LinkedComponentRef = {
      ...ref,
      sourceKind: ref.sourceKind ?? src.sourceKind,
      sourceUri: ref.sourceUri,
      sourceHash: src.sourceHash,
      lastSyncedAt: syncedAt,
      outOfDate: false,
    };

    updatedIds.push(f.id);
    ops.push(
      { op: 'set', id: f.id, path: 'part', value: nextEmbedded },
      { op: 'set', id: f.id, path: 'linkedRef', value: nextRef },
    );

    const updatedFeature: typeof f = {
      ...f,
      part: nextEmbedded,
      linkedRef: nextRef,
    };
    if ('sourcePart' in f) {
      updatedFeature.sourcePart = cloneValue(nextEmbedded);
    }
    return updatedFeature;
  });

  const nextPart = (updatedIds.length > 0 ? { ...part, features: nextFeatures } : part) as D;
  return { part: nextPart, ops, updatedIds };
}

/**
 * Update all (or specified) linked `insertPart` features with the latest `sourcePart` from `availableSources`,
 * preserving transforms, mates, and feature IDs, and syncing all shared instances referencing the same `sourceUri`.
 */
export function updateLinkedComponents<D extends DocLike>(
  part: D,
  availableSources: AvailableSourcesInput,
  featureIds?: readonly string[],
): D & { part: D; ops: EditOp[]; updatedIds: string[] } {
  const { part: nextPart, ops, updatedIds } = updateLinkedComponentsOps(part, availableSources, featureIds);
  const result = { ...nextPart } as D & { part: D; ops: EditOp[]; updatedIds: string[] };
  Object.defineProperties(result, {
    part: { value: result, enumerable: false, configurable: true },
    ops: { value: ops, enumerable: false, configurable: true },
    updatedIds: { value: updatedIds, enumerable: false, configurable: true },
  });
  return result;
}

/** Convert a linked `insertPart` component into a standalone embedded copy (`linkedRef` removed). */
export function breakComponentLink<D extends DocLike>(part: D, featureId: string): D {
  if (!part || !Array.isArray(part.features)) return part;
  let changed = false;
  const features = part.features.map((f) => {
    if (f.id !== featureId || f.type !== 'insertPart' || !('linkedRef' in f)) return f;
    changed = true;
    const { linkedRef: _dropped, ...rest } = f;
    const embedded = embeddedPartOf(f);
    if (embedded) {
      rest.part = cloneValue(embedded);
      if ('sourcePart' in rest) rest.sourcePart = cloneValue(embedded);
    }
    return rest;
  });
  return changed ? ({ ...part, features } as D) : part;
}

/** EditOps to break a component link in a session edit. */
export function breakComponentLinkOps(part: DocLike, featureId: string): EditOp[] {
  const f = part.features.find((x) => x.id === featureId && x.type === 'insertPart');
  if (!f || !('linkedRef' in f)) return [];
  const { linkedRef: _dropped, ...rest } = f;
  const embedded = embeddedPartOf(f);
  if (embedded) {
    rest.part = cloneValue(embedded);
  }
  return [{ op: 'replace', id: featureId, feature: rest }];
}

// ---- Flexible Subassemblies -----------------------------------------------------------------------------------------------

const SOLID_CREATING_TYPES = new Set(['extrude', 'revolve', 'sweep', 'loft', 'sphere', 'importStep', 'frame']);

/** True when an embedded part document represents a subassembly (contains multiple bodies, nested components, or internal mates). */
export function isSubassemblyPart(embeddedPart: unknown): boolean {
  if (!embeddedPart || typeof embeddedPart !== 'object') return false;
  const p = embeddedPart as Record<string, unknown>;
  if (Array.isArray(p.mates) && p.mates.length > 0) return true;
  if (Array.isArray(p.bodies) && p.bodies.length > 1) return true;
  if (typeof p.bodyCount === 'number' && p.bodyCount > 1) return true;
  if (Array.isArray(p.components) && p.components.length > 0) return true;

  const features = Array.isArray(p.features) ? (p.features as Array<Record<string, unknown>>) : [];
  let bodyCount = 0;
  for (const f of features) {
    if (!f || typeof f !== 'object' || f.suppressed === true) continue;
    if (f.type === 'mate' || f.type === 'insertPart') return true;
    if (f.op === 'newBody') return true;
    if (f.type === 'moveBody' && f.copy === true) return true;
    if (f.type === 'mirror' && f.body === true && f.replace !== true) return true;
    if (SOLID_CREATING_TYPES.has(String(f.type)) && f.op !== 'cut') {
      bodyCount++;
      if (bodyCount > 1) return true;
    }
  }
  return false;
}

/** True when component `featureId` in `part` is a subassembly (or is already marked flexible). */
export function isSubassemblyComponent(part: DocLike | null | undefined, featureId: string): boolean {
  if (!part || !Array.isArray(part.features)) return false;
  const f = part.features.find((x) => x.id === featureId && x.type === 'insertPart');
  if (!f) return false;
  return f.flexible === true || isSubassemblyPart(embeddedPartOf(f));
}

/** True when subassembly `featureId` is marked flexible (`flexible: true`); defaults to `false` (Rigid). */
export function isSubassemblyFlexible(part: DocLike | null | undefined, featureId: string): boolean {
  if (!part || !Array.isArray(part.features)) return false;
  const f = part.features.find((x) => x.id === featureId && x.type === 'insertPart');
  return f?.flexible === true;
}

/** Mark an `insertPart` subassembly component as Flexible (`true`) or Rigid (`false`). */
export function setSubassemblyFlexible<D extends DocLike>(part: D, featureId: string, flexible: boolean): D {
  if (!part || !Array.isArray(part.features)) return part;
  let changed = false;
  const features = part.features.map((f) => {
    if (f.id !== featureId || f.type !== 'insertPart') return f;
    changed = true;
    return { ...f, flexible: Boolean(flexible) };
  });
  return changed ? ({ ...part, features } as D) : part;
}

/** EditOps to toggle `flexible` on an `insertPart` feature. */
export function setSubassemblyFlexibleOps(part: DocLike, featureId: string, flexible: boolean): EditOp[] {
  const f = part.features.find((x) => x.id === featureId && x.type === 'insertPart');
  if (!f) return [];
  return [{ op: 'set', id: featureId, path: 'flexible', value: Boolean(flexible) }];
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const axisOf = (v: unknown): 'x' | 'y' | 'z' | null => {
  if (v === 'x' || v === 'y' || v === 'z') return v;
  const a = (v as { axis?: unknown } | null | undefined)?.axis;
  return a === 'x' || a === 'y' || a === 'z' ? a : null;
};

function placementOfFeature(f: Record<string, unknown>): Placement {
  const tr = (f.transform ?? f.place) as Record<string, unknown> | undefined;
  return {
    dx: num(f.dx, num(tr?.dx, 0)),
    dy: num(f.dy, num(tr?.dy, 0)),
    dz: num(f.dz, num(tr?.dz, 0)),
    axis: axisOf(f.axis ?? tr?.axis),
    angle: num(f.angle, num(tr?.angle, 0)),
  };
}

function rotatePoint(p: [number, number, number], axis: 'x' | 'y' | 'z' | null, angleDeg: number): [number, number, number] {
  if (!axis || !angleDeg) return p;
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const [x, y, z] = p;
  if (axis === 'x') return [x, c * y - s * z, s * y + c * z];
  if (axis === 'y') return [c * x + s * z, y, -s * x + c * z];
  return [c * x - s * y, s * x + c * y, z];
}

function composeTranslation(parent: Placement, child: Placement): [number, number, number] {
  const rotated = rotatePoint([child.dx, child.dy, child.dz], parent.axis, parent.angle);
  return [parent.dx + rotated[0], parent.dy + rotated[1], parent.dz + rotated[2]];
}

function liftMateRef(ref: unknown, prefix: string): unknown {
  if (typeof ref === 'string' && ref.length > 0) {
    return ref.startsWith(`${prefix}:`) ? ref : `${prefix}:${ref}`;
  }
  if (ref && typeof ref === 'object' && (ref as { kind?: unknown }).kind === 'connector') {
    const conn = ref as { kind: 'connector'; id: string; component?: string };
    const comp = conn.component ? (conn.component.startsWith(`${prefix}:`) ? conn.component : `${prefix}:${conn.component}`) : prefix;
    return { ...conn, component: comp };
  }
  return ref;
}

function internalMatesOf(partObj: Record<string, unknown>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const features = Array.isArray(partObj.features) ? (partObj.features as Array<Record<string, unknown>>) : [];
  for (const f of features) {
    if (f && f.type === 'mate' && f.suppressed !== true) {
      const id = String(f.id ?? `M${out.length + 1}`);
      seen.add(id);
      out.push(f);
    }
  }
  const extraMates = Array.isArray(partObj.mates) ? (partObj.mates as Array<Record<string, unknown>>) : [];
  for (const m of extraMates) {
    if (m && typeof m === 'object' && m.suppressed !== true) {
      const id = String(m.id ?? `M${out.length + 1}`);
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ type: 'mate', ...m, id });
      }
    }
  }
  return out;
}

export type ExpandedMatesResult = LiftedSubassemblyMate[] & {
  liftedMates: LiftedSubassemblyMate[];
  topLevelMates: Array<Record<string, unknown>>;
  subComponents: SubassemblyComponentTransform[];
};

/**
 * Expand assembly mates for the solver / motion preview / DOF inspector:
 * - Rigid subassemblies (`flexible !== true`) keep their child sub-bodies locked together under the parent `insertPart` transform; their internal mates are not lifted.
 * - Flexible subassemblies (`flexible === true`) have their internal mates lifted with namespace prefix `${featureId}:` and their sub-component transforms composed with the parent transform.
 */
export function expandFlexibleSubassemblyMates(part: DocLike | null | undefined): ExpandedMatesResult {
  const topLevelMates: Array<Record<string, unknown>> = [];
  const liftedMates: LiftedSubassemblyMate[] = [];
  const subComponents: SubassemblyComponentTransform[] = [];

  if (!part || typeof part !== 'object') {
    const empty = [] as unknown as ExpandedMatesResult;
    Object.defineProperties(empty, {
      liftedMates: { value: liftedMates, enumerable: false },
      topLevelMates: { value: topLevelMates, enumerable: false },
      subComponents: { value: subComponents, enumerable: false },
    });
    return empty;
  }

  for (const m of internalMatesOf(part as unknown as Record<string, unknown>)) {
    topLevelMates.push(m);
  }

  const walkSubassembly = (
    subPart: Record<string, unknown>,
    prefix: string,
    parentPlacement: Placement,
    isFlexible: boolean,
  ) => {
    const subFeats = Array.isArray(subPart.features) ? (subPart.features as Array<Record<string, unknown>>) : [];
    for (const sf of subFeats) {
      if (!sf || sf.type !== 'insertPart' || sf.suppressed === true) continue;
      const localPlacement = placementOfFeature(sf);
      const worldTranslation = composeTranslation(parentPlacement, localPlacement);
      const childId = `${prefix}:${sf.id}`;
      subComponents.push({
        id: childId,
        subassemblyId: prefix,
        sourceComponentId: String(sf.id),
        name: String(sf.name ?? sf.id),
        flexible: isFlexible,
        parentTransform: parentPlacement,
        localTransform: localPlacement,
        worldTranslation,
      });

      const nestedPart = embeddedPartOf(sf);
      if (nestedPart && isFlexible && sf.flexible === true) {
        walkSubassembly(
          nestedPart,
          childId,
          {
            dx: worldTranslation[0],
            dy: worldTranslation[1],
            dz: worldTranslation[2],
            axis: localPlacement.axis ?? parentPlacement.axis,
            angle: localPlacement.angle || parentPlacement.angle,
          },
          true,
        );
      }
    }

    if (!isFlexible) return;

    for (const m of internalMatesOf(subPart)) {
      const sourceMateId = String(m.id ?? 'M1');
      const lifted: LiftedSubassemblyMate = {
        ...m,
        id: `${prefix}:${sourceMateId}`,
        type: 'mate',
        kind: String(m.kind ?? 'coincident'),
        ...(typeof m.name === 'string' && m.name ? { name: `${prefix}:${m.name}` } : {}),
        subassemblyId: prefix,
        sourceMateId,
        parentTransform: parentPlacement,
      };
      for (const refKey of ['a', 'b', 'a2', 'b2', 'c'] as const) {
        if (m[refKey] !== undefined && m[refKey] !== null) {
          lifted[refKey] = liftMateRef(m[refKey], prefix);
        }
      }
      if (typeof m.componentA === 'string' && m.componentA) {
        lifted.componentA = m.componentA.startsWith(`${prefix}:`) ? m.componentA : `${prefix}:${m.componentA}`;
      }
      if (typeof m.componentB === 'string' && m.componentB) {
        lifted.componentB = m.componentB.startsWith(`${prefix}:`) ? m.componentB : `${prefix}:${m.componentB}`;
      }
      liftedMates.push(lifted);
    }
  };

  const features = Array.isArray(part.features) ? part.features : [];
  for (const f of features) {
    if (f.type !== 'insertPart' || f.suppressed === true) continue;
    const embedded = embeddedPartOf(f);
    if (!embedded) continue;
    const parentPlacement = placementOfFeature(f);
    const flexible = f.flexible === true;
    walkSubassembly(embedded, f.id, parentPlacement, flexible);
  }

  const all = [...(topLevelMates as unknown as LiftedSubassemblyMate[]), ...liftedMates] as ExpandedMatesResult;
  Object.defineProperties(all, {
    liftedMates: { value: liftedMates, enumerable: false, configurable: true },
    topLevelMates: { value: topLevelMates, enumerable: false, configurable: true },
    subComponents: { value: subComponents, enumerable: false, configurable: true },
  });
  return all;
}
