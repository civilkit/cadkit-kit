// Convert mesh to solid, phase 2: Accept makes the previewed solid part of the document as a `meshToSolid` feature.
//   1. the converted triangles (world coordinates, see worldMesh in meshSolid.ts) are packed (`u32 nVerts, u32 nTris, f32 xyz * nVerts,
//      u32 index * 3 * nTris`, little endian) and go into the part's top-level `blobs` as base64, under the hex SHA-256 of that text:
//      the same scheme as importBody / importStep, so the part file carries the mesh and a regen rebuilds the solid;
//   2. one feature `{type: 'meshToSolid', id, name, body, blob, opts, replace: false, source}` is appended in ONE undoable edit
//      (DocPatch: `append` + `blobs`), with the options the preview was run with, so the rebuilt solid is the previewed one;
//   3. the kernel rebuilds the document first; if the feature fails (a refusal, the work budget) nothing is kept and the reason is returned.
// The reference mesh stays in `doc.meshes` (the user may hide or delete it); the feature holds its own copy of the triangles.
import type { PartDoc } from '@ck/part-model';
import { sha256Hex } from '@kit/viewdata';
import { bytesToBase64Async } from './meshDoc';
import { meshKindOf } from './meshImport';
import { requestOpts, type MeshInput, type MeshSolidOptions, type MeshSolidReport } from './meshSolid';
import type { DocPatch } from '../docFields';

/** The panel's Accept is on: the kernel keeps a converted mesh as a feature. */
export const MESH_SOLID_ACCEPT_READY = true;

export interface MeshSolidAcceptInput {
  /** the document the feature goes into */
  doc: PartDoc;
  /** the triangles that were converted (world coordinates) and the options they were converted with */
  mesh: MeshInput;
  options: MeshSolidOptions;
  /** the name of the solid (the mesh's name in the tree) */
  name: string;
  /** the file the mesh came from, when it has one */
  sourceName?: string;
  /** the preview's report */
  report: MeshSolidReport;
}

export type MeshSolidAcceptResult =
  | { ok: true; id: string }
  | { ok: false; code: string; message: string };

/** The kernel's blob payload of a mesh: counts, then the vertices, then the triangle corners, little endian. */
export function packMesh(m: MeshInput): Uint8Array {
  const nv = m.vertices.length / 3, nt = m.indices.length / 3;
  const out = new Uint8Array(8 + nv * 12 + nt * 12);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, nv, true); dv.setUint32(4, nt, true);
  let o = 8;
  for (let i = 0; i < m.vertices.length; i++, o += 4) dv.setFloat32(o, m.vertices[i], true);
  for (let i = 0; i < m.indices.length; i++, o += 4) dv.setUint32(o, m.indices[i], true);
  return out;
}

/** The next free feature id of a document (after the highest F<n> and its own `seq`). */
export function nextFeatureNumber(doc: PartDoc): number {
  const max = doc.features.reduce((n, f) => Math.max(n, /^F(\d+)$/.test(f.id) ? Number(f.id.slice(1)) : 0), 0);
  return Math.max(Number(doc.seq ?? 1), max + 1);
}

/** The edit that adds the feature and its blob (pure apart from the hash; the app applies it as one history step). */
export async function meshSolidPatch(input: MeshSolidAcceptInput): Promise<{ patch: DocPatch; id: string }> {
  const b64 = await bytesToBase64Async(packMesh(input.mesh));
  const key = await sha256Hex(new TextEncoder().encode(b64));
  const n = nextFeatureNumber(input.doc);
  const id = `F${n}`;
  const feature: Record<string, unknown> = {
    type: 'meshToSolid', id, name: input.name, body: input.name, blob: key,
    opts: requestOpts(input.options) ?? {}, replace: false,
    ...(input.sourceName ? { source: { name: input.sourceName, format: meshKindOf(input.sourceName) ?? 'stl' } } : {}),
  };
  return { patch: { append: [feature], seq: n + 1, blobs: { [key]: b64 } }, id };
}

/** Accept: add the feature through `apply` (one history step; the document is unchanged when the kernel cannot rebuild it). */
export async function acceptMeshSolid(
  input: MeshSolidAcceptInput,
  apply: (patch: DocPatch, reason: string) => Promise<{ ok: true } | { ok: false; errors: Array<{ feature: string; code: string }> }>,
): Promise<MeshSolidAcceptResult> {
  const { patch, id } = await meshSolidPatch(input);
  const r = await apply(patch, `convert ${input.name} to a solid`);
  if (r.ok) return { ok: true, id };
  const e = r.errors.find((x) => x.feature === id) ?? r.errors[0];
  return { ok: false, code: e?.code ?? 'failed', message: e ? `${e.feature}: ${e.code}` : 'the part could not be rebuilt' };
}
