// The Catalog placement engine: given a catalog item and a screen position it finds the face under the pointer, snaps to
// edge midpoints / centres / corners, orients the shape to the face, keeps a live preview of the real features on screen and,
// on drop, commits them as ONE edit. Click-to-place and drag-and-drop both drive it (see useCatalog.tsx). No DOM here: the
// viewport and the controller come in through `PlacerDeps`, so it is tested with plain objects.
import type { EditOp } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { buildShape, defaultSize, shapeName, type BuildResult, type BuiltShape, type CatalogItem, type PlaceTarget } from './shapes';
import { DEFAULT_SETTING, groundPlane, describePlacement, rayStdPlane, toPlaneUV, type PlaneRef, type PlacementSetting, type StdPlane, type UpAxis } from './placement';
import { faceInfos, raycast, snapCandidates, snapTo, type EdgeLike, type MeshArrays, type SnapKind, type V3 } from './geometry';

export interface PlacerDeps {
  document(): PartDoc | null;
  hasSolid(): boolean;
  bodyFaces(): MeshArrays | null;
  bodyEdges(): EdgeLike[];
  bodyBox(): { min: number[]; max: number[] } | null;
  /** Show the candidate part (a speculative edit, nothing written). */
  preview(ops: EditOp[]): Promise<{ ok: boolean; stale?: boolean; hint?: string; body?: { sketches?: Array<{ id: string; frame: { o: number[]; x: number[]; y: number[]; z: number[] } }> } | null; sketches?: Array<{ id: string; frame: { o: number[]; x: number[]; y: number[]; z: number[] } }> }>;
  cancelPreview(): Promise<void>;
  /** One edit = one undo step. */
  commit(ops: EditOp[], reason: string): Promise<{ ok: boolean }>;
  /** Parts library: variables and features together, one undo step. */
  commitPatch?(patch: NonNullable<BuiltShape['patch']>, reason: string): Promise<{ ok: boolean }>;
  /** Parts library: run the entry's script in attach mode (linked: parameters become document variables). */
  buildBosl?(item: CatalogItem, target: PlaceTarget, doc: PartDoc, linked: boolean): Promise<BuildResult>;
  /** Library part: the part moved onto the target. Not linked (a hover): `{error: 'loading'}` while it is being fetched; linked (the drop): waits for it. */
  buildPart?(item: CatalogItem, target: PlaceTarget, doc: PartDoc, linked: boolean): Promise<BuildResult>;
  /** The up axis of the view (nav setting): the ground plane is the one whose normal it is. */
  upAxis?(): UpAxis;
  /** The Place-on / flip / rotate / mirror choice. */
  placement?(): PlacementSetting;
  /** The reference plane (Front / Top / Right) or plane feature drawn under a screen position, or null. */
  planeAt?(x: number, y: number): PlaneRef | null;
  rayAt(x: number, y: number): { o: number[]; d: number[] } | null;
  worldPerPixel(p: number[]): number;
  /** Translucent body while previewing. */
  setFade(on: boolean): void;
  /** Keep the camera where it is while the drop is committed (not for the first body, which is framed). */
  holdView(on: boolean): void;
}

export type PlaceStatus =
  | { state: 'idle' }
  | { state: 'blocked'; reason: 'needsBody' | 'miss' | 'noFrame' | 'failed' | 'planarOnly' | 'invalid' | 'scriptFailed' | 'loading' | 'fetchFailed'; hint?: string }
  | { state: 'ready'; face: string | null; snap: SnapKind | null; size: number; point: V3; /** Ground targets: the plane it lands on (Front / Top / Right, or the plane feature's id). */ plane?: PlaneRef; ground?: boolean };

/** English name of a standard plane (history entries are not translated). */
export const planeName = (id: StdPlane): string => id[0].toUpperCase() + id.slice(1);

/** Pixels within which a corner, midpoint or centre catches the pointer. */
export const SNAP_PX = 14;

interface Spot { target: PlaceTarget; snap: SnapKind | null }

export class Placer {
  /** What the last pointer position resolved to (null: the pointer is over nothing usable). */
  status: PlaceStatus = { state: 'idle' };
  /** The edit the preview shows, and its main feature id, ready for `drop`. */
  private current: { ops: EditOp[]; mainId: string; key: string } | null = null;
  private frames = new Map<string, PlaceTarget['frame']>();
  private running = false;
  private wanted: { item: CatalogItem; target: PlaceTarget; key: string } | null = null;
  private generation = 0;
  /** Ids of helper features of the last drop (see BuiltShape.helpers). */
  lastHelpers: string[] = [];
  /** What the last drop wants the user told (a library part that could not be moved), or ''. */
  lastNotice = '';
  private fading = false;
  private last: { item: CatalogItem; x: number; y: number; alt: boolean } | null = null;

  /** Placement choices (R / F / the row) changed: look at the same spot again. */
  rehover(): void { if (this.last) this.hover(this.last.item, this.last.x, this.last.y, this.last.alt); }

  constructor(private readonly deps: PlacerDeps, private readonly onStatus: (s: PlaceStatus) => void = () => {}) {}

  /** The shape for this spot: the built-in ones are plain data, a parts-library entry runs its script. */
  private async make(item: CatalogItem, target: PlaceTarget, doc: PartDoc, linked: boolean): Promise<BuildResult> {
    if (item.part) return this.deps.buildPart ? this.deps.buildPart(item, target, doc, linked) : { error: 'scriptFailed', hint: 'no library' };
    if (item.bosl) return this.deps.buildBosl ? this.deps.buildBosl(item, target, doc, linked) : { error: 'scriptFailed', hint: 'no script host' };
    return buildShape(item, target, doc.seq);
  }

  private set(s: PlaceStatus): void { this.status = s; this.onStatus(s); }

  /** Resolve a screen position to a place on the part (or the ground) with snapping, or null. */
  resolve(item: CatalogItem, x: number, y: number, alt: boolean): Spot | { blocked: 'needsBody' | 'miss' } {
    const ray = this.deps.rayAt(x, y);
    if (!ray) return { blocked: 'miss' };
    const solid = this.deps.hasSolid();
    const mesh = this.deps.bodyFaces();
    const setting = this.deps.placement?.() ?? DEFAULT_SETTING;
    const onPlane = (needHit: boolean): Spot | { blocked: 'miss' } => {
      const hit = this.deps.planeAt?.(x, y) ?? null;
      if (needHit && !hit) return { blocked: 'miss' };
      const ref: PlaneRef = hit ?? { kind: 'std', id: setting.plane === 'auto' ? groundPlane(this.deps.upAxis?.() ?? 'z') : setting.plane };
      const place = { flip: setting.flip, rot: setting.rot, mirror: setting.mirror };
      if (ref.kind === 'std') {
        const g = rayStdPlane(ref.id, ray.o, ray.d) ?? (hit ? null : [0, 0, 0] as V3);
        if (!g) return { blocked: 'miss' };
        const uv = toPlaneUV(ref.id, g);
        return { target: { kind: 'ground', point: g, plane: ref, uv, place }, snap: null };
      }
      return { target: { kind: 'ground', point: [0, 0, 0], plane: ref, uv: [0, 0], place }, snap: null };
    };
    if (!solid || !mesh) {
      if (item.op === 'cut') return { blocked: 'needsBody' };
      return onPlane(false);
    }
    const hit = raycast(mesh, ray.o, ray.d);
    if (!hit) return item.op === 'cut' ? { blocked: 'miss' } : onPlane(true);
    const info = faceInfos(mesh).get(hit.face);
    if (!info) return { blocked: 'miss' };
    let point = hit.point;
    let snap: SnapKind | null = null;
    if (info.planar && !alt) {
      const s = snapTo(point, snapCandidates(info, this.deps.bodyEdges()), SNAP_PX * this.deps.worldPerPixel(point));
      if (s) { point = s.point; snap = s.kind; }
    }
    const box = this.deps.bodyBox();
    // part size along the face normal: how deep a cut may go
    const n = info.normal;
    const thickness = box ? Math.abs(n[0]) * (box.max[0] - box.min[0]) + Math.abs(n[1]) * (box.max[1] - box.min[1]) + Math.abs(n[2]) * (box.max[2] - box.min[2]) : undefined;
    return { target: { kind: 'face', face: hit.face, planar: info.planar, point, extent: info.extent, thickness }, snap };
  }

  private async frameFor(item: CatalogItem, target: PlaceTarget, seq: number): Promise<PlaceTarget['frame'] | null> {
    const key = target.face!;
    const known = this.frames.get(key);
    if (known) return known;
    // a probe shape at the face's own origin tells where the kernel puts a sketch on this face
    const probe = buildShape({ id: 'add-block', kind: 'block', op: 'add' }, { ...target, frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, point: [0, 0, 0] }, seq, 1);
    if ('error' in probe) return null;
    const r = await this.deps.preview(probe.ops);
    if (r.stale) return null;
    const sk = (r.body?.sketches ?? r.sketches ?? []).find((s) => s.id === probe.sketchId);
    if (!sk?.frame?.x) return null;
    this.frames.set(key, sk.frame);
    return sk.frame;
  }

  /** The pointer moved: re-resolve and refresh the preview (latest position wins; one kernel call at a time). */
  hover(item: CatalogItem, x: number, y: number, alt = false): void {
    this.last = { item, x, y, alt };
    const spot = this.resolve(item, x, y, alt);
    if ('blocked' in spot) {
      this.wanted = null; this.current = null;
      this.set({ state: 'blocked', reason: spot.blocked });
      void this.clearPreview();
      return;
    }
    const doc = this.deps.document();
    if (!doc) return;
    const key = [item.id, spot.target.kind, spot.target.face ?? '', spot.target.point.map((v) => v.toFixed(2)).join(','), doc.seq, doc.features.length, spot.target.plane ? JSON.stringify(spot.target.plane) + JSON.stringify(spot.target.place) : '', item.bosl ? JSON.stringify(item.bosl.params) : ''].join('|');
    this.set({ state: 'ready', face: spot.target.face ?? null, snap: spot.snap, size: defaultSize(spot.target), point: spot.target.point, plane: spot.target.plane, ground: spot.target.kind === 'ground' });
    if (this.wanted?.key === key || this.current?.key === key) return;
    this.wanted = { item, target: spot.target, key };
    void this.pump();
  }

  private async clearPreview(): Promise<void> {
    if (!this.fading) return;
    this.fading = false;
    await this.cancelHeld();
    this.deps.setFade(false);
  }

  /** Put the committed part back on screen without moving the camera. */
  private async cancelHeld(): Promise<void> {
    this.deps.holdView(true);
    try { await this.deps.cancelPreview(); } finally { this.deps.holdView(false); }
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const gen = this.generation;
    try {
      while (this.wanted && gen === this.generation) {
        const w = this.wanted;
        this.wanted = null;
        const doc = this.deps.document();
        if (!doc) break;
        let target = w.target;
        if (target.kind === 'face' && target.planar) {
          const frame = await this.frameFor(w.item, target, doc.seq);
          if (gen !== this.generation) break;
          if (!frame) { this.set({ state: 'blocked', reason: 'noFrame' }); continue; }
          target = { ...target, frame };
        }
        const built = await this.make(w.item, target, doc, false);
        if (gen !== this.generation) break;
        if ('error' in built) { this.set({ state: 'blocked', reason: built.error, hint: (built as { hint?: string }).hint }); continue; }
        this.fading = true;
        this.deps.setFade(true);
        const r = await this.deps.preview(built.ops);
        if (gen !== this.generation) break;
        if (r.stale) continue;
        if (!r.ok) { this.current = null; this.set({ state: 'blocked', reason: 'failed', hint: r.hint }); continue; }
        this.current = { ops: built.ops, mainId: built.mainId, key: w.key };
      }
    } finally { this.running = false; }
  }

  /**
   * Drop the shape at a screen position. Resolves it afresh (so a drop without a hover, as in a test or on touch, works), builds the
   * ops and commits them as one edit. Returns the id of the main feature, or null when nothing was made.
   */
  async drop(item: CatalogItem, x: number, y: number, alt = false): Promise<string | null> {
    this.generation++;     // any preview still running is dropped
    this.wanted = null;
    return this.dropSpot(item, this.resolve(item, x, y, alt));
  }

  /** Drop on a plane named directly (a plane row of the history tree): no pointer ray, the shape goes to the plane's origin. */
  async dropOnPlane(item: CatalogItem, plane: PlaneRef): Promise<string | null> {
    this.generation++;
    this.wanted = null;
    if (item.op === 'cut') { await this.end(); this.set({ state: 'blocked', reason: this.deps.hasSolid() ? 'miss' : 'needsBody' }); return null; }
    const s = this.deps.placement?.() ?? DEFAULT_SETTING;
    return this.dropSpot(item, { target: { kind: 'ground', point: [0, 0, 0], plane, uv: [0, 0], place: { flip: s.flip, rot: s.rot, mirror: s.mirror } }, snap: null });
  }

  private async dropSpot(item: CatalogItem, spot: Spot | { blocked: 'needsBody' | 'miss' }): Promise<string | null> {
    if ('blocked' in spot) { await this.end(); this.set({ state: 'blocked', reason: spot.blocked }); return null; }
    const doc = this.deps.document();
    if (!doc) { await this.end(); return null; }
    let target = spot.target;
    if (target.kind === 'face' && target.planar) {
      const frame = this.frames.get(target.face!) ?? (await this.frameFor(item, target, doc.seq));
      if (!frame) { await this.end(); this.set({ state: 'blocked', reason: 'noFrame' }); return null; }
      target = { ...target, frame };
    }
    const built = await this.make(item, target, doc, true);
    if ('error' in built) { await this.end(); this.set({ state: 'blocked', reason: built.error, hint: (built as { hint?: string }).hint }); return null; }
    this.deps.setFade(false); this.fading = false;
    this.deps.holdView(this.deps.hasSolid());
    const pn = target.kind === 'ground' && target.plane ? (target.plane.kind === 'std' ? planeName(target.plane.id) : target.plane.id) : null;
    const note = pn && target.place ? describePlacement(pn, target.place) : '';
    const why = `Catalog: ${shapeName(item)}${note ? ` (${note})` : ''}`;
    const r = await (built.patch && this.deps.commitPatch ? this.deps.commitPatch(built.patch, why) : this.deps.commit(built.ops, why)).finally(() => this.deps.holdView(false));
    this.lastHelpers = built.helpers;
    this.lastNotice = built.notice ?? '';
    if (r.ok) built.onCommitted?.();
    void this.end(true);
    return r.ok ? built.mainId : null;
  }

  /** Stop placing: drop the preview and forget the cached frames. */
  async end(committed = false): Promise<void> {
    this.generation++;
    this.wanted = null; this.current = null; this.frames.clear(); this.last = null;
    const was = this.fading;
    this.fading = false;
    if (was && !committed) await this.cancelHeld();
    this.deps.setFade(false);
    this.set({ state: 'idle' });
  }
}
