/**
 * The sketch tool interface. A tool is a pure state machine: it is fed
 * plane-space pointer events (already snapped by the caller), typed field
 * values and keys, and returns the next state, the next draft, a preview to
 * draw and the on-view fields to show. No DOM, no Three.js, no kernel calls.
 */
import type { SketchDraft } from '../index';

export interface Pt { x: number; y: number }
export interface Modifiers { shift: boolean; ctrl: boolean; alt: boolean }

export type SnapKind = 'point' | 'midpoint' | 'center' | 'grid' | 'axis' | 'align';
/** What the snap engine found under the pointer. `pointId` is set when the hit is an existing sketch point. */
export interface SnapHit {
  kind: SnapKind;
  at: Pt;
  pointId?: string;
  entityId?: string;
  /** For `align`: the point whose x (vertical alignment) and/or y (horizontal alignment) the pointer matches. */
  alignTo?: { x?: string; y?: string };
}

/** User settings that change how tools behave (see the sketch editor spec, input techniques). */
export interface ToolSettings {
  autoConstraints: boolean;
  arcSwitch: 'hover' | 'keys' | 'off';
  onViewValues: 'both' | 'dimensions' | 'off';
}
export const DEFAULT_SETTINGS: ToolSettings = { autoConstraints: true, arcSwitch: 'hover', onViewValues: 'dimensions' };

export type ToolEvent =
  | { type: 'move'; at: Pt; snap?: SnapHit; mods: Modifiers }
  | { type: 'click'; at: Pt; snap?: SnapHit; mods: Modifiers }
  /** A typed value. `commit` (Tab or Enter) locks it as a driving dimension; without it the value is only a live preview. `null` clears the field. */
  | { type: 'field'; id: string; value: number | null; commit?: boolean }
  | { type: 'key'; key: string };

export type PreviewShape =
  | { kind: 'line'; a: Pt; b: Pt }
  | { kind: 'circle'; c: Pt; r: number };

export interface FieldSpec {
  id: string;
  /** i18n key, never display text. */
  label: string;
  value: number;
  locked: boolean;
  unit: 'length' | 'angle' | 'count';
}

export interface ToolOutput<S> {
  state: S;
  draft: SketchDraft;
  preview: PreviewShape[];
  fields: FieldSpec[];
  /** i18n key of a short message for the status line, if any. */
  hint?: string;
  /** Constraints the tool inferred for the pending segment, shown as glyphs before the click. */
  pending?: string[];
  /** The point the chain continues from: resting the pointer on it flips the line tool to a tangent arc. */
  anchor?: Pt;
  /** The mode of a tool that has more than one (the line tool: `line` or `arc`). */
  mode?: string;
}

export interface Tool<S> {
  id: string;
  start(): S;
  step(state: S, event: ToolEvent, draft: SketchDraft, settings: ToolSettings): ToolOutput<S>;
}
