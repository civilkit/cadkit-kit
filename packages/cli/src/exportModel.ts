// The mesh-format half of `cadkit export`, shared by the CLI and the MCP `export` tool so there is one implementation.
// Keep this module a leaf: it must not import commands.ts or the mcp / agent-tools packages (cli imports @kit/mcp).
// NOTE: the exporters live in apps/cad/src (packages importing apps); moving them is a separate change.
import type { PartDoc } from '@ck/part-model';
import { bodiesToObj, meshToGlb, meshToStl, meshToThreeMf, type MeshBody } from '@kit/io';
import { exportUrdf, type UrdfBuildInput, type UrdfLinkInput, type UrdfMateInput } from '../../../apps/cad/src/exportUrdf';
import { meshToUsdz } from '../../../apps/cad/src/exportUsdz';
import { meshToHtmlViewer } from '../../../apps/cad/src/exportHtmlViewer';
import { fileStem } from '../../../apps/cad/src/exportFiles';
import type { ExportQuality } from './args';
import { extractMeshBodies } from './part';

export type MeshExportFormat = 'stl' | 'obj' | '3mf' | 'glb' | 'urdf' | 'usdz' | 'html';

type MeshLike = Parameters<typeof extractMeshBodies>[0];
type EdgesLike = Parameters<typeof extractMeshBodies>[1];
type MassBody = { volume: number; area: number; com: number[]; inertia?: number[][]; principal?: number[]; axes?: number[][] };

/** The slice of a Session the mesh exporters need (satisfied by `@ck/session` Session and the CLI's CliSession). */
export interface ExportSessionLike {
  bodyForView(): Promise<{ mesh: MeshLike & { positions: Float32Array }; edges: EdgesLike } | null | undefined>;
  exportMesh(opts: { quality?: ExportQuality; chord_mm?: number }): Promise<{ mesh: MeshLike & { positions: Float32Array }; chord?: number; chordRaised?: boolean; failed?: unknown[] }>;
  massProps(opts?: { bodies?: boolean }): Promise<{ bodies?: MassBody[] }>;
}

export class ExportModelError extends Error {
  constructor(public readonly code: 'no_body' | 'export_error', message: string) { super(message); }
}

export interface MeshExportResult {
  data: string | Uint8Array;
  triangles: number | undefined;
  bodies: number | undefined;
  /** Set only when a quality / chord_mm was requested: what the kernel meshed with. */
  chord?: number;
  chordRaised?: boolean;
  unmeshedFaces?: unknown[];
}

function buildUrdfInputFromBodies(
  doc: PartDoc,
  bodies: readonly MeshBody[],
  massBodies?: MassBody[],
): UrdfBuildInput {
  const links: UrdfLinkInput[] = bodies.map((b, i) => {
    const mb = massBodies && bodies.length === massBodies.length ? massBodies[i] : undefined;
    const link: UrdfLinkInput = {
      id: `body_${i + 1}`,
      name: b.name || `link_${i + 1}`,
      positions: b.positions,
      fixed: i === 0,
      ...(b.color ? { color: b.color } : {}),
      ...(b.opacity !== undefined ? { opacity: b.opacity } : {}),
    };
    if (mb) {
      link.mass = {
        volume: mb.volume,
        ...(mb.com && mb.com.length >= 3 ? { com: [mb.com[0], mb.com[1], mb.com[2]] } : {}),
        ...(mb.inertia && mb.inertia.length === 3
          ? {
              inertia: [
                [mb.inertia[0][0], mb.inertia[0][1], mb.inertia[0][2]],
                [mb.inertia[1][0], mb.inertia[1][1], mb.inertia[1][2]],
                [mb.inertia[2][0], mb.inertia[2][1], mb.inertia[2][2]],
              ],
            }
          : {}),
        ...(mb.principal && mb.principal.length >= 3 ? { principal: [mb.principal[0], mb.principal[1], mb.principal[2]] } : {}),
        ...(mb.axes && mb.axes.length === 3
          ? {
              axes: [
                [mb.axes[0][0], mb.axes[0][1], mb.axes[0][2]],
                [mb.axes[1][0], mb.axes[1][1], mb.axes[1][2]],
                [mb.axes[2][0], mb.axes[2][1], mb.axes[2][2]],
              ],
            }
          : {}),
      };
    }
    return link;
  });

  const features = (doc.features ?? []) as unknown as Array<Record<string, unknown>>;
  const mates: UrdfMateInput[] = features
    .filter((f) => f.type === 'mate' && f.suppressed !== true)
    .map((f) => ({
      id: String(f.id ?? ''),
      ...(typeof f.name === 'string' ? { name: f.name } : {}),
      kind: String(f.kind ?? ''),
      ...(typeof f.a === 'string' ? { a: f.a } : {}),
      ...(typeof f.b === 'string' ? { b: f.b } : {}),
      ...(typeof f.a2 === 'string' ? { a2: f.a2 } : {}),
      ...(typeof f.b2 === 'string' ? { b2: f.b2 } : {}),
      ...(typeof f.c === 'string' ? { c: f.c } : {}),
      ...(typeof f.of === 'string' ? { of: f.of } : {}),
      ...(typeof f.min === 'number' ? { min: f.min } : {}),
      ...(typeof f.max === 'number' ? { max: f.max } : {}),
      ...(typeof f.distance === 'number' ? { distance: f.distance } : {}),
      ...(typeof f.angle === 'number' ? { angle: f.angle } : {}),
      ...(f.flip === true ? { flip: true } : {}),
      ...(Array.isArray(f.dir) && f.dir.length === 3
        ? { dir: [Number(f.dir[0]), Number(f.dir[1]), Number(f.dir[2])] }
        : {}),
    }));

  return { name: doc.name || 'robot', links, mates };
}

/** Mesh the document and encode it in `format`. Throws ExportModelError for "no solid" / "URDF produced nothing". */
export async function exportMeshFormat(
  session: ExportSessionLike,
  doc: PartDoc,
  format: MeshExportFormat,
  opts: { quality?: ExportQuality; chordMm?: number; ascii?: boolean } = {},
): Promise<MeshExportResult> {
  const stem = fileStem(doc.name);
  const view = await session.bodyForView();
  if (!view || !view.mesh.positions.length) throw new ExportModelError('no_body', 'part has no solid geometry to export');

  let chordInfo: Pick<MeshExportResult, 'chord' | 'chordRaised' | 'unmeshedFaces'> = {};
  let customMesh: MeshLike & { positions: Float32Array } = view.mesh;
  if (opts.quality !== undefined || opts.chordMm !== undefined) {
    const rep = await session.exportMesh({
      ...(opts.quality !== undefined ? { quality: opts.quality } : {}),
      ...(opts.chordMm !== undefined ? { chord_mm: opts.chordMm } : {}),
    });
    customMesh = rep.mesh;
    chordInfo = {
      ...(rep.chord !== undefined ? { chord: rep.chord } : {}),
      ...(rep.chordRaised ? { chordRaised: true } : {}),
      ...(rep.failed && rep.failed.length ? { unmeshedFaces: rep.failed } : {}),
    };
  }

  const meshBodies = extractMeshBodies(customMesh, view.edges, doc);
  if (!meshBodies.length) throw new ExportModelError('no_body', 'part has no mesh triangles to export');
  let bodies: number | undefined = meshBodies.length;
  let data: string | Uint8Array;
  let triangles: number | undefined;

  switch (format) {
    case 'stl': {
      const r = meshToStl({ positions: customMesh.positions }, { name: doc.name || stem, binary: !opts.ascii });
      data = r.data; triangles = r.triangles;
      break;
    }
    case 'obj': {
      const r = bodiesToObj(meshBodies);
      data = r.data; triangles = r.triangles; bodies = r.bodies;
      break;
    }
    case '3mf': {
      const r = await meshToThreeMf(meshBodies, { title: doc.name || stem });
      data = r.data; triangles = r.triangles; bodies = r.bodies;
      break;
    }
    case 'glb': {
      const r = meshToGlb(meshBodies, { name: doc.name || stem });
      data = r.data; triangles = r.triangles; bodies = r.bodies;
      break;
    }
    case 'usdz': {
      const r = meshToUsdz(meshBodies, { name: doc.name || stem });
      data = r.data; triangles = r.triangles; bodies = r.bodies;
      break;
    }
    case 'html': {
      const r = meshToHtmlViewer(meshBodies, { name: doc.name || stem });
      data = r.html; triangles = r.triangles; bodies = r.bodies;
      break;
    }
    case 'urdf': {
      const mass = await session.massProps({ bodies: true }).catch(() => null);
      const res = await exportUrdf(buildUrdfInputFromBodies(doc, meshBodies, mass?.bodies));
      if (!res.file) throw new ExportModelError('export_error', 'URDF export produced no output');
      data = res.file.data;
      triangles = meshBodies.reduce((n, b) => n + Math.floor(b.positions.length / 9), 0);
      break;
    }
  }
  return { data, triangles, bodies, ...chordInfo };
}
