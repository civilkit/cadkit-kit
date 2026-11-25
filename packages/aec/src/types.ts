// Clean-room types for Roadmap 3.4 AEC & industrial surface format importers (.ifc, .3dm, .dwg, .rvt).
// Pure TypeScript, zero external dependencies, compatible with @ck/part-model PartDoc.

export type AecFormat = 'ifc' | '3dm' | 'dwg' | 'rvt';

export type V2 = [number, number];
export type V3 = [number, number, number];

export interface Transform3D {
  /** World origin in millimetres (mm). */
  o: V3;
  /** Orthonormal X axis direction. */
  x: V3;
  /** Orthonormal Y axis direction. */
  y: V3;
  /** Orthonormal Z axis direction (x × y). */
  z: V3;
}

export interface AecWarning {
  object: string;
  code: string;
  message: string;
}

export interface AecLook {
  /** Hex colour `#rrggbb`. */
  color?: string;
  /** Opacity in `0.05 .. 1`. */
  opacity?: number;
  metallic?: number;
  roughness?: number;
}

export interface AecMeshBody {
  id: string;
  name: string;
  color: string;
  opacity: number;
  storey?: string;
  layer?: string;
  category?: string;
  /** Flat xyz Float32Array in millimetres (length = 3 * vertexCount). */
  vertices: Float32Array;
  /** Flat triangle corner indices Uint32Array (length = 3 * triangleCount). */
  indices: Uint32Array;
  watertight: boolean;
  /** ISO 10303-21 STEP faceted B-rep (`MANIFOLD_SOLID_BREP` / `CLOSED_SHELL`) representation of this mesh. */
  stepFacetedBrep: string;
}

export interface AecStorey {
  id: string;
  name: string;
  elevationMm: number;
  elementIds: string[];
  featureIds: string[];
}

export interface AecLayer {
  index: number;
  name: string;
  color: string;
  visible: boolean;
  elementCount: number;
}

export interface AecElementSummary {
  id: string;
  name: string;
  category: string;
  storey?: string;
  layer?: string;
  color: string;
  opacity?: number;
  placement: Transform3D;
  representation: 'extrude' | 'revolve' | 'primitive' | 'sketch' | 'mesh' | 'step' | 'sat';
  featureIds: string[];
  meshId?: string;
}

export interface AecParameter {
  name: string;
  expr: string;
  rawValue?: string | number;
  unit?: string;
  group?: string;
}

export interface AecSatBody {
  name: string;
  sat: string;
  layer?: string;
  color?: string;
}

export interface AecStepBody {
  name: string;
  step: string;
  layer?: string;
  storey?: string;
  color?: string;
}

export interface AecPart {
  format: 'ck-part';
  version: 1;
  name: string;
  features: Array<Record<string, unknown>>;
  seq: number;
  rollback: null;
  material: string;
  counters: Record<string, unknown>;
  upAxis?: 'y' | 'z';
  variables?: Array<{ name: string; expr: string }>;
  blobs?: Record<string, string>;
  appearance?: Record<string, AecLook>;
  bodyNames?: Record<string, string>;
  meshes?: Array<Record<string, unknown>>;
}

export type Part = AecPart;

export interface AecImportReport {
  name: string;
  format: AecFormat;
  schemaVersion: string;
  unitScaleToMm: number;
  part: Part;
  meshes: AecMeshBody[];
  storeys: AecStorey[];
  layers: AecLayer[];
  elements: AecElementSummary[];
  elementCount: number;
  parameters: AecParameter[];
  satBodies: AecSatBody[];
  stepBodies: AecStepBody[];
  warnings: AecWarning[];
  summary: string;
  error?: string;
}
