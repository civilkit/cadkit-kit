export type V3 = [number, number, number];
export type V2 = [number, number];

export type ViewName = 'iso' | 'top' | 'front' | 'right' | 'back' | 'left' | 'bottom';
export type ViewSpec = ViewName | { azimuth: number; elevation?: number } | { dir: V3; up?: V3 };
export type StyleName = 'shaded' | 'edges' | 'xray' | 'hidden-line' | 'mono';
export type SheetName = 'single' | 'drawing-first-angle' | 'drawing-third-angle' | 'ab' | 'orthos' | 'section';

/** A mesh as the kernel regen reply gives it (see @ck/mesh MeshData): 3 vertices per triangle, no index buffer. */
export interface MeshLike {
  positions: Float32Array | number[];
  normals?: Float32Array | number[];
  /** face index per triangle (into faceIds) */
  triFace?: Int32Array | number[];
  faceIds?: string[];
}

/** One loop of a kernel `section` reply (SectionLoop in @ck/session queries). pts are in the section frame. */
export interface SectionLoopLike { kind?: 'outer' | 'inner'; pts: Array<[number, number]>; area?: number }
/** The kernel `section` reply: exact loops in the plane frame {o, x, y, z}. */
export interface SectionLike {
  loops: SectionLoopLike[];
  frame: { o: number[]; x: number[]; y: number[]; z: number[] };
  area?: number;
  bbox2d?: [number, number, number, number];
}

import type { AppearanceFields } from './appearance.js';

/** What renderSnapshot draws: the ViewBody a Session gives (mesh, edges, box), plus optional extras. */
export interface SnapshotInput {
  mesh: MeshLike;
  /** B-rep edge polylines (Session.bodyForView().edges) */
  edges?: Array<{ key?: string; pts: number[][]; /** the two faces the edge separates (used to find the bodies) */ faces?: string[] }>;
  box?: { min: number[]; max: number[] };
  name?: string;
  /** mm^3, shown in the title block of drawing sheets */
  volume?: number;
  /** exact section loops from the kernel `section` request */
  section?: SectionLike;
  /** per-body colour, opacity and finish and the hidden bodies, as the document stores them (see docs/bodies-appearance.md); drawn unless `opts.appearance === false` */
  appearance?: AppearanceFields;
}

export interface Marker { p: V3; label?: string; color?: [number, number, number] }
export interface Dimension { from: V3; to: V3; label?: string }
export interface Frame { center: V3; radius: number }

export interface SnapshotOpts {
  view?: ViewSpec;
  up?: 'y' | 'z';
  size?: number | { width: number; height: number };
  /** 'ortho' (alias 'orthographic') or 'persp' (alias 'perspective') */
  projection?: 'ortho' | 'persp' | 'orthographic' | 'perspective';
  style?: StyleName;
  /** pin the framing so before/after renders are comparable */
  frame?: Frame;
  markers?: Marker[];
  /** dimension lines to draw; `true` draws the three overall extents of the bounding box */
  annotate?: Dimension[] | boolean;
  /** face ids to colour */
  highlight?: string[];
  background?: string | [number, number, number];
  /** a sheet name; `true` means 'drawing-third-angle', `false` 'single' */
  sheet?: SheetName | boolean;
  /** 'ab' sheet: B is `input` for B (two different inputs) or, when absent, the same view with negated azimuth. */
  ab?: { b?: SnapshotInput; bView?: ViewSpec; labels?: [string, string] };
  /** supersampling factor (integer, default 2) */
  supersample?: number;
  /** drawing sheets: sheet title text */
  title?: string;
  /** false: draw every body in the default grey even when the input carries an appearance */
  appearance?: boolean;
}

export interface SnapshotMeta {
  view: string;
  up: 'y' | 'z';
  projection: 'ortho' | 'persp';
  style: StyleName;
  sheet: SheetName;
  frame: Frame;
  /** pixels per mm of the main panel (ortho) */
  scale: number;
  triangles: number;
  bbox: { min: V3; max: V3 };
  ms: number;
  panels?: Array<{ label: string; x: number; y: number; width: number; height: number }>;
}

export interface SnapshotResult {
  png: Uint8Array;
  width: number;
  height: number;
  rgba: Uint8Array;
  meta: SnapshotMeta;
}
