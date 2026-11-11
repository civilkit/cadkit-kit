/**
 * The sketch tool interface. A tool is a pure state machine: it is fed
 * plane-space pointer events (already snapped by the caller), typed field
 * values and keys, and returns the next state, the next draft, a preview to
 * draw and the on-view fields to show. No DOM, no Three.js, no kernel calls.
 */
import type { SketchDraft } from '../index';

export interface Pt { x: number; y: number }
export interface Modifiers { shift: boolean; ctrl: boolean; alt: boolean }

export type SnapKind = 'point' | 'midpoint' | 'center' | 'grid' | 'axis' | 'align' | 'intersection' | 'quadrant' | 'perpendicular' | 'tangent' | 'oncurve'
  | 'modelEndpoint' | 'modelMidpoint' | 'modelCenter' | 'modelExtent';
/** What the snap engine found under the pointer. `pointId` is set when the hit is an existing sketch point. */
export interface SnapHit {
  kind: SnapKind;
  at: Pt;
  pointId?: string;
  entityId?: string;
  /** For `intersection`: the two curves that cross there. */
  entityIds?: string[];
  /** For `point`: what the point is (an end of a shape, the centre of a circle or arc, the sketch origin). */
  role?: 'endpoint' | 'center' | 'origin';
  /** For `align`: the point whose x (vertical alignment) and/or y (horizontal alignment) the pointer matches. */
  alignTo?: { x?: string; y?: string };
  /** For the model snaps: what was found (an i18n suffix: modelEndpoint, midExtent, bodyCentre, midExtrusion, ...). */
  model?: string;
  /** For a model guide line: its two ends, drawn dashed. */
  guide?: { a: Pt; b: Pt };
}

/** User settings that change how tools behave (see the sketch editor spec, input techniques). */
export interface ToolSettings {
  autoConstraints: boolean;
  arcSwitch: 'hover' | 'keys' | 'off';
  onViewValues: 'both' | 'dimensions' | 'off';
  /** A typed angle in the Line tool also makes a driving angle dimension between the new line and the previous one (default on). */
  typedAngleDims?: boolean;
}
export const DEFAULT_SETTINGS: ToolSettings = { autoConstraints: true, arcSwitch: 'hover', onViewValues: 'dimensions', typedAngleDims: true };

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
  /** The expression (no leading =) the value is linked to, when it has one. */
  expr?: string;
  /** A small switch beside the field (the line tool's relative angle): clicking it sends a `field` event with this id and 1 (turn on) or 0. */
  toggle?: { id: string; on: boolean; /** i18n keys */ label: string; tip: string };
}

/** One row of a tool's side panel. Every edit goes back to the tool as a `field` event with the row's id: a number row sends its value,
 *  a choice row the index of the option picked, a pick row 1 (start picking) or 0 (stop). */
export type PanelRow =
  | { kind: 'number'; id: string; /** i18n key */ label: string; value: number; unit: 'length' | 'angle' | 'count'; /** the user typed it (as opposed to a default or the pointer) */ locked?: boolean }
  | { kind: 'choice'; id: string; label: string; value: number; /** i18n keys */ options: string[] }
  | { kind: 'pick'; id: string; label: string; active: boolean; /** i18n key of the button text */ button: string };

/** A side panel in the style of the feature editors (titled groups of rows, an OK and a Cancel): set while a tool wants more than a pointer-following field or two. */
export interface PanelSpec {
  /** i18n key */
  title: string;
  groups: Array<{ id: string; /** i18n key, omitted for an untitled group */ title?: string; rows: PanelRow[] }>;
  /** i18n key of a line of explanation under the groups */
  note?: string;
  /** OK is offered only when the tool would make something */
  canApply: boolean;
}

export interface ToolOutput<S> {
  state: S;
  /** The tool's side panel, when it has one. */
  panel?: PanelSpec;
  draft: SketchDraft;
  preview: PreviewShape[];
  fields: FieldSpec[];
  /** i18n key of a short message for the status line, if any. */
  hint?: string;
  /** Constraints the tool inferred for the pending segment, shown as glyphs before the click. */
  pending?: string[];
  /** Where the shape being drawn started from (the line tool's last point): the perpendicular and tangent snaps are measured from it. */
  from?: Pt;
  /** The point the chain continues from: resting the pointer on it flips the line tool to a tangent arc. */
  anchor?: Pt;
  /** Constraint kinds a tool had to drop because they cannot carry over (Split Entity): the hint names them (`{kinds}`). */
  dropped?: string[];
  /** The mode of a tool that has more than one (the line tool: `line` or `arc`). */
  mode?: string;
}

/** A world-space plane frame: origin and unit x, y, z axes (z is the normal). */
export interface PlaneFrame3 { o: number[]; x: number[]; y: number[]; z: number[] }
/** An edge of the body on screen, as the viewer has it: a world-space polyline, the two faces it separates and its key. */
export interface BodyEdge {
  key?: string; faces?: string[]; pts: number[][];
  /** Exact source of a free-form edge: the fit points (world space) of the sketch spline whose extrusion made it. The closed spline's outline may be split into `pieces` edges that
   *  share this one value: it is used when all of them are projected together. Projecting the edge
   *  then reproduces that spline point for point instead of fitting the tessellation, so the copy coincides with the wall. */
  exact?: { pts: number[][]; closed: boolean; pieces: number };
}

/** What a tool may know about the world outside the sketch. Only tools that look at the body (project) read it. */
export interface ToolEnv {
  /** The sketch plane and the body's edges (world space). */
  body?: { frame: PlaneFrame3; edges: BodyEdge[] };
  /** Pointer hit tolerance in sketch units (the viewport's pick radius at the current zoom). */
  tol?: number;
  /** Edge keys and face names the user had selected in the 3D view before the sketch was opened. */
  selection?: string[];
  /** Sketch entity ids selected in the sketch (Select mode, box or Ctrl-click) before this tool was chosen: the transform tools act on them. */
  entities?: string[];
}

export interface Tool<S> {
  id: string;
  start(): S;
  step(state: S, event: ToolEvent, draft: SketchDraft, settings: ToolSettings, env?: ToolEnv): ToolOutput<S>;
}
