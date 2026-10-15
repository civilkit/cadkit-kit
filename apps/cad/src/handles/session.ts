// The contract between a handle gesture and the app. A session is built for the current selection (see plan.ts), lists
// the handles to draw and turns the quantity a handle reports into edit ops: `preview` for every drag step (shown without
// committing), `commit` once on release. `create` says the commit adds a feature, so the Editor opens on it afterwards.
import type { EditOp } from '@ck/session';
import type { HandleSpec, Vec3 } from '@kit/viewport';

export type GestureKind = 'round-new' | 'round-edit' | 'extrude-depth' | 'shell-thickness' | 'hole-diameter' | 'thread-length' | 'thin-thickness' | 'placement' | 'size-box';

export interface HandleCommit {
  ops: EditOp[]; create: boolean;
  /** The gesture edits an open editor's draft instead of the document: the app hands this patch to the editor and makes no edit itself. */
  draft?: Record<string, unknown>;
  /** Said to the user after the edit (e.g. sketch constraints the new size broke were removed). */
  notice?: string;
}

export interface HandleSession {
  kind: GestureKind;
  specs: HandleSpec[];
  /** The feature this gesture edits in place (absent when it adds one). */
  target?: string;
  /** Ops to show for the quantity now, or null when there is nothing to show (a zero-size feature). */
  preview(handleId: string, q: number, vec: Vec3): EditOp[] | null;
  /** The one edit to make on release, or null to leave the document alone. */
  commit(handleId: string, q: number, vec: Vec3): HandleCommit | null;
  format?(handleId: string, q: number): string;
  /** The specs to show while this drag runs (the size box and its labels follow the value). */
  live?(handleId: string, q: number, vec: Vec3): HandleSpec[] | null;
  step?(handleId: string): number;
}

/** Smallest size a drag may produce; below it the gesture shows and commits nothing. */
export const MIN_SIZE = 0.01;
