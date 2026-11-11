// Import of an STL into the document: probe the file (counts, size, closed or open), pick a unit, build the record. Pure apart from
// the reader; the app wires the dialog and the controller around it.
import { readStl, StlError, UNIT_MM, type MeshCheck, type StlRead, type StlUnit, type StlWarning } from '@kit/io';
import { meshRecFromStl, nextMeshId, type MeshRec, type V3 } from './meshDoc';
import { onGround } from './meshEdit';

export interface MeshProbe {
  triangles: number;
  format: 'binary' | 'ascii';
  /** millimetres, as read with unit mm */
  size: V3;
  check: MeshCheck;
  degenerate: number;
  warnings: StlWarning[];
}

export type ProbeResult = { ok: true; probe: MeshProbe; read: StlRead } | { ok: false; code: string };

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
export const meshNameOf = (file: string): string => file.replace(/^.*[\\/]/, '').replace(/\.stl$/i, '') || 'Mesh';

/** The record to add for a file read in `unit`. `up`: put it on the ground at the origin. */
export function buildRecord(bytes: Uint8Array, file: string, unit: StlUnit, existing: MeshRec[], ground: 'y' | 'z' | null): { rec: MeshRec; read: StlRead } {
  const read = readStl(bytes, { unit });
  let rec = meshRecFromStl(read, nextMeshId(existing), meshNameOf(file), unit);
  if (ground) rec = onGround(rec, ground);
  return { rec, read };
}
