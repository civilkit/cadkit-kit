// Import of an STL into the document: probe the file (counts, size, closed or open), pick a unit, build the record. Pure apart from
// the reader; the app wires the dialog and the controller around it.
import { MeshReadError, readGlb, readObj, readStl, readThreeMf, StlError, UNIT_MM, type MeshCheck, type MeshFileRead, type MeshNote, type StlRead, type StlUnit, type StlWarning } from '@kit/io';
import { t } from '../i18n';
import { meshRecFromArrays, meshRecFromStl, nextMeshId, type MeshRec, type V3 } from './meshDoc';
import { onGround } from './meshEdit';

/** The file formats a reference mesh can be read from. */
export type MeshKind = 'stl' | 'obj' | 'glb' | '3mf';

export interface MeshProbe {
  triangles: number;
  format: 'binary' | 'ascii' | 'obj' | 'glb' | '3mf';
  /** the file's own unit is known (GLB metres, 3MF its model unit): the dialog does not ask */
  unitFixed?: StlUnit;
  /** what the file held that the mesh does not keep, and what was done to it (see `meshNoteLines`) */
  notes?: MeshNote[];
  /** colours the file gave (0: none read) */
  colours?: number;
  /** millimetres, as read with unit mm */
  size: V3;
  check: MeshCheck;
  degenerate: number;
  warnings: StlWarning[];
}

export type ProbeResult = { ok: true; probe: MeshProbe; read: StlRead | MeshFileRead } | { ok: false; code: string };

/** Read the file as millimetres to report on it; the unit scales the size afterwards. */
export function probeStl(bytes: Uint8Array): ProbeResult {
  try {
    const r = readStl(bytes, { unit: 'mm' });
    return { ok: true, read: r, probe: { triangles: r.triangles, format: r.format, size: [r.bbox.max[0] - r.bbox.min[0], r.bbox.max[1] - r.bbox.min[1], r.bbox.max[2] - r.bbox.min[2]], check: r.check, degenerate: r.degenerate, warnings: r.warnings } };
  } catch (e) {
    if (e instanceof StlError) return { ok: false, code: e.code };
    throw e;
  }
}

/** Read an OBJ, GLB or 3MF (or STL) to report on it. `mtl`: the text of the OBJ's material file when it was opened with it. */
export async function probeMesh(kind: MeshKind, bytes: Uint8Array, o: { mtl?: string } = {}): Promise<ProbeResult> {
  if (kind === 'stl') return probeStl(bytes);
  try {
    const r = await readMesh(kind, bytes, 'mm', o.mtl);
    return {
      ok: true, read: r,
      probe: {
        triangles: r.triangles, format: kind, size: [r.bbox.max[0] - r.bbox.min[0], r.bbox.max[1] - r.bbox.min[1], r.bbox.max[2] - r.bbox.min[2]], check: r.check, degenerate: r.degenerate, warnings: [],
        ...(r.unitFromFile ? { unitFixed: r.unit } : {}), notes: r.notes, colours: r.mats?.length ?? 0,
      },
    };
  } catch (e) {
    if (e instanceof MeshReadError) return { ok: false, code: e.code };
    throw e;
  }
}

/** One of the three readers; an OBJ takes the unit the user chose (GLB and 3MF state theirs). */
export async function readMesh(kind: Exclude<MeshKind, 'stl'>, bytes: Uint8Array, unit: StlUnit, mtl?: string): Promise<MeshFileRead> {
  if (kind === 'obj') return readObj(bytes, { unit, mtl });
  if (kind === 'glb') return readGlb(bytes);
  return readThreeMf(bytes);
}

/** The lines a notice about a read file is made of: one per thing that was not kept or was changed. */
export function meshNoteLines(notes: readonly MeshNote[]): string[] {
  return notes.map((n) => t('mesh.note.' + n.code, { n: n.n ?? 0, unit: n.text ?? '' }));
}

/** The size of the model in mm if the file's numbers are in a unit of `mmPerUnit` millimetres. */
export const sizeMm = (p: MeshProbe, mmPerUnit: number): V3 => [p.size[0] * mmPerUnit, p.size[1] * mmPerUnit, p.size[2] * mmPerUnit];

/** A hint when the size looks off for the unit chosen: a model under 2 mm across (a metre file read as mm), over 5 m (a micrometre file). */
export function unitHint(size: V3): { key: string; size: number } | null {
  const big = Math.max(size[0], size[1], size[2]);
  if (big < 2) return { key: 'mesh.import.guessSmall', size: big };
  if (big > 5000) return { key: 'mesh.import.guessLarge', size: big };
  return null;
}

/** The unit to offer first: the one that makes the model between 5 mm and 3 m across, preferring mm. */
export function guessUnit(sizeAsMm: V3): StlUnit {
  const big = Math.max(sizeAsMm[0], sizeAsMm[1], sizeAsMm[2]);
  for (const u of ['mm', 'm', 'in', 'cm'] as StlUnit[]) {
    const s = big * UNIT_MM[u];
    if (s >= 5 && s <= 3000) return u;
  }
  return 'mm';
}

/** A file name without its extension, as the mesh's name. */
export const meshNameOf = (file: string): string => file.replace(/^.*[\\/]/, '').replace(/\.(stl|obj|glb|3mf)$/i, '') || 'Mesh';

/** The mesh format a file name says, or null. */
export const meshKindOf = (file: string): MeshKind | null => { const e = /\.(stl|obj|glb|3mf)$/i.exec(file)?.[1].toLowerCase(); return (e as MeshKind | undefined) ?? null; };

/** The record to add for a file read in `unit`. `up`: put it on the ground at the origin. */
export function buildRecord(bytes: Uint8Array, file: string, unit: StlUnit, existing: MeshRec[], ground: 'y' | 'z' | null): { rec: MeshRec; read: StlRead } {
  const read = readStl(bytes, { unit });
  let rec = meshRecFromStl(read, nextMeshId(existing), meshNameOf(file), unit);
  if (ground) rec = onGround(rec, ground);
  return { rec, read };
}

/** The same for any mesh format: the record for a file read in `unit` (GLB and 3MF use their own). */
export async function buildMeshRecord(kind: MeshKind, bytes: Uint8Array, file: string, unit: StlUnit, existing: MeshRec[], ground: 'y' | 'z' | null, mtl?: string): Promise<{ rec: MeshRec; read: StlRead | MeshFileRead }> {
  if (kind === 'stl') return buildRecord(bytes, file, unit, existing, ground);
  const read = await readMesh(kind, bytes, unit, mtl);
  let rec = meshRecFromArrays({ vertices: read.mesh.vertices, indices: read.mesh.indices, ...(read.tm ? { tm: read.tm } : {}) }, { id: nextMeshId(existing), name: meshNameOf(file), unit: read.unit, watertight: read.check.watertight, ...(read.mats ? { mats: read.mats.map((m) => ({ c: m.c, o: m.o })) } : {}) });
  if (ground) rec = onGround(rec, ground);
  return { rec, read };
}
