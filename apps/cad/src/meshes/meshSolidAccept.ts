// Convert mesh to solid, phase 2 (NOT YET AVAILABLE): Accept, which makes the previewed solid part of the document. The kernel has no
// persistent feature for a converted mesh yet, so the panel's Accept button is disabled with a tooltip (`MESH_SOLID_ACCEPT_READY`).
//
// The plan, once the kernel has an `importMesh` feature (the way sldprtImport.ts holds a SolidWorks body as `importBody` + a blob):
//   1. the mesh (world coordinates, see worldMesh in meshSolid.ts) goes into the part's `blobs` under the SHA-256 of its packed bytes;
//   2. one feature is added in one undoable edit: {type: 'importMesh', id, name, blob: <key>, opts: <requestOpts(options)>}, so a
//      regen rebuilds exactly the previewed solid (same kernel, same options);
//   3. the regenerated volume is checked against the preview's `report.volume.body` (as sldprtImport checks its volume) before the
//      edit is kept; the reference mesh stays in `doc.meshes` (the user may hide or delete it).
// Nothing else in the preview path changes: the panel calls `acceptMeshSolid` with what it already has.
import type { PartDoc } from '@ck/part-model';
import type { MeshInput, MeshSolidOptions, MeshSolidReport } from './meshSolid';

/** False until the kernel can rebuild a converted mesh as a feature; the panel shows Accept disabled while it is. */
export const MESH_SOLID_ACCEPT_READY = false;

export interface MeshSolidAcceptInput {
  /** the document the feature goes into */
  doc: PartDoc;
  /** the triangles that were converted (world coordinates) and the options they were converted with */
  mesh: MeshInput;
  options: MeshSolidOptions;
  name: string;
  /** the preview's report: the regenerated feature must match its volume */
  report: MeshSolidReport;
}

/** Phase 2. Always refuses today: there is no kernel feature to hold the converted mesh. */
export async function acceptMeshSolid(_input: MeshSolidAcceptInput): Promise<{ ok: false; code: 'notAvailable' }> {
  return { ok: false, code: 'notAvailable' };
}
