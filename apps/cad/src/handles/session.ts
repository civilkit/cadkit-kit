// The contract between a handle gesture and the app. A session is built for the current selection (see plan.ts), lists
// the handles to draw and turns the quantity a handle reports into edit ops: `preview` for every drag step (shown without
// committing), `commit` once on release. `create` says the commit adds a feature, so the Editor opens on it afterwards.
import type { EditOp } from '@ck/session';
import type { HandleSpec, Vec3 } from '@kit/viewport';

export type GestureKind = 'round-new' | 'round-edit' | 'extrude-depth' | 'shell-thickness' | 'hole-diameter' | 'thread-length' | 'thin-thickness' | 'push-pull' | 'placement' | 'size-box';

export interface HandleCommit {
  ops: EditOp[]; create: boolean;
  /** The gesture edits an open editor's draft instead of the document: the app hands this patch to the editor and makes no edit itself. */
  draft?: Record<string, unknown>;
  /** Said to the user after the edit (e.g. sketch constraints the new size broke were removed). */
  notice?: string;
  /** The edit needs a decision first (a shared sketch: move every user, or give this shape its own copy). The app asks; `ops` is the first choice's edit. */
  choices?: Array<{ id: string; label: string; ops: EditOp[] }>;
}

/** Modifier keys held during a drag. */
export interface DragMods { shift?: boolean; ctrl?: boolean; alt?: boolean }

/** What the typed-position fields and the nudge keys need to know about the shape being moved. */
export interface MoveInfo {
  /** The footprint in the sketch plane and the host face's extent there. */
  box: { u0: number; u1: number; v0: number; v1: number };
  host: { u0: number; u1: number; v0: number; v1: number } | null;
  /** Centre of the footprint in the sketch plane, and in world coordinates (shown beside the typed position). */
  centre: { u: number; v: number };
  world: Vec3;
  /** The body points nearest the shape (hole centres, corners, midpoints) that "Lock to" offers. */
  near: Array<{ u: number; v: number; kind: string }>;
  /** The edit that ties the shape to such a point with persistent sketch constraints holding the present offset. */
  lockTo(p: { u: number; v: number }): HandleCommit | null;
  /** Grid step for nudges and Ctrl moves. */
  step: number;
  /** The edit (and notice / choices) of moving by (du, dv) in the sketch plane, no snapping. Null when it changes nothing or cannot be done. */
  to(du: number, dv: number): HandleCommit | null;
}

export interface HandleSession {
  kind: GestureKind;
  specs: HandleSpec[];
  /** The feature this gesture edits in place (absent when it adds one). */
  target?: string;
  /** Ops to show for the quantity now, or null when there is nothing to show (a zero-size feature). */
  preview(handleId: string, q: number, vec: Vec3, mods?: DragMods): EditOp[] | null;
  /** The one edit to make on release, or null to leave the document alone. */
  commit(handleId: string, q: number, vec: Vec3, mods?: DragMods): HandleCommit | null;
  format?(handleId: string, q: number): string;
  /** The specs to show while this drag runs (the size box and its labels follow the value). */
  live?(handleId: string, q: number, vec: Vec3, mods?: DragMods): HandleSpec[] | null;
  step?(handleId: string): number;
  /** The size box: repositioning in the sketch plane. */
  move?: MoveInfo;
}

/** Smallest size a drag may produce; below it the gesture shows and commits nothing. */
export const MIN_SIZE = 0.01;
