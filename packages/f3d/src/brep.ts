// Embedded B-rep detection & extraction for Fusion 360 .f3d archives.
// Handles:
//  - ACIS ASCII SAT (.sat) -> passed to ck-io `importSat`
//  - Embedded STEP (.step / .stp) -> passed to `importStep` / `partOfStep`
//  - Binary ACIS / Autodesk Shape Manager (.smb / .smbh / .sab) -> detected and reported cleanly

import { decodeText } from './manifest';

export interface F3dSatBody {
  name: string;
  entryPath: string;
  sat: string;
  /** Millimetres per SAT unit from line 3 of the ACIS header, when present. */
  unitsMmPerUnit?: number;
  /** Source design name when unpacked from a multi-design .f3z archive. */
  design?: string;
}

export interface F3dStepBody {
  name: string;
  entryPath: string;
  step: string;
  design?: string;
}

export interface F3dBinaryBody {
  name: string;
  entryPath: string;
  format: 'smb' | 'smbh' | 'sab';
  /** Leading ASCII header signature (e.g. "ASM BinaryFile 229.0") if readable. */
  header?: string;
  size: number;
  design?: string;
}

/** Derive a human-readable body name from a ZIP entry path. */
export function bodyNameFromPath(entryPath: string, fallback = 'Body'): string {
  const base = entryPath.replace(/\\/g, '/').split('/').pop() ?? '';
  const stem = base.replace(/\.(sat|sab|smb|smbh|step|stp)$/i, '').trim();
  return stem || fallback;
}

/**
 * Validate whether a text blob looks like an ACIS ASCII SAT file.
 * ACIS SAT files start with `<version> <records> <entities> <history>` (e.g. `700 0 1 0` or `22000 0 1 0`)
 * and end with `End-of-ACIS-data` or `End-of-ASM-data`.
 */
export function parseSatText(text: string): { valid: boolean; unitsMmPerUnit?: number } {
  const trimmed = text.trim();
  if (!trimmed) return { valid: false };
  const lines = trimmed.split(/\r\n|\r|\n/);
  if (lines.length < 4) return { valid: false };
  const headerRe = /^\s*\d{2,6}\s+\d+\s+\d+\s+\d+/;
  if (!headerRe.test(lines[0])) return { valid: false };

  // Line 3 (index 2) of ACIS SAT header: `<units_mm_per_unit> <resabs> <resnor>`
  let unitsMmPerUnit: number | undefined;
  const line3 = lines[2]?.trim().split(/\s+/) ?? [];
  const u = Number(line3[0]);
  if (Number.isFinite(u) && u > 0) unitsMmPerUnit = u;

  const hasEnd = /End-of-(?:ACIS|ASM)-data/i.test(trimmed);
  const hasEntity = /\b(?:body|lump|shell|face|plane-surface|cone-surface|sphere-surface|torus-surface|spline-surface)\b/.test(trimmed);
  return { valid: hasEnd || hasEntity, unitsMmPerUnit };
}

/** Check if text looks like a STEP AP203/AP214/AP242 file. */
export function isStepText(text: string): boolean {
  const head = text.slice(0, 512);
  return /ISO-10303-21\s*;/i.test(head) && /END-ISO-10303-21\s*;/i.test(text);
}

/** Extract a short printable ASCII header prefix from a binary ASM/ACIS `.smb`/`.smbh`/`.sab` blob. */
export function readBinaryBrepHeader(bytes: Uint8Array): string | undefined {
  const limit = Math.min(bytes.length, 64);
  let out = '';
  for (let i = 0; i < limit; i++) {
    const c = bytes[i];
    if (c === 0 || c === 10 || c === 13) {
      if (out.length >= 6) break;
      continue;
    }
    if (c >= 32 && c <= 126) out += String.fromCharCode(c);
    else if (out.length >= 6) break;
  }
  const clean = out.trim();
  return clean.length >= 4 ? clean : undefined;
}

/** Classify a ZIP entry path by B-rep extension. */
export function classifyBrepEntry(entryPath: string): 'sat' | 'step' | 'smb' | 'smbh' | 'sab' | null {
  const lower = entryPath.toLowerCase();
  if (lower.endsWith('.sat')) return 'sat';
  if (lower.endsWith('.step') || lower.endsWith('.stp')) return 'step';
  if (lower.endsWith('.smbh')) return 'smbh';
  if (lower.endsWith('.smb')) return 'smb';
  if (lower.endsWith('.sab')) return 'sab';
  return null;
}

/**
 * Inspect an extracted B-rep entry buffer.
 * Note: Some Fusion/third-party tools place ASCII SAT text inside a `.smb` file; if a `.smb` entry
 * turns out to be valid ASCII SAT text, we promote it to `sat` automatically!
 */
export function inspectBrepEntry(
  entryPath: string,
  bytes: Uint8Array,
  design?: string,
):
  | { kind: 'sat'; body: F3dSatBody }
  | { kind: 'step'; body: F3dStepBody }
  | { kind: 'binary'; body: F3dBinaryBody }
  | { kind: 'invalid'; reason: string } {
  const ext = classifyBrepEntry(entryPath);
  const name = bodyNameFromPath(entryPath);

  if (ext === 'sat') {
    const text = decodeText(bytes);
    const parsed = parseSatText(text);
    if (!parsed.valid) return { kind: 'invalid', reason: `"${entryPath}" does not contain valid ACIS SAT geometry` };
    return {
      kind: 'sat',
      body: { name, entryPath, sat: text, ...(parsed.unitsMmPerUnit ? { unitsMmPerUnit: parsed.unitsMmPerUnit } : {}), ...(design ? { design } : {}) },
    };
  }

  if (ext === 'step') {
    const text = decodeText(bytes);
    if (!isStepText(text)) return { kind: 'invalid', reason: `"${entryPath}" does not contain a valid STEP (ISO-10303-21) block` };
    return {
      kind: 'step',
      body: { name, entryPath, step: text, ...(design ? { design } : {}) },
    };
  }

  if (ext === 'smb' || ext === 'smbh' || ext === 'sab') {
    // Check if it is actually ASCII SAT text stored under a .smb extension
    const prefix = decodeText(bytes.subarray(0, Math.min(bytes.length, 256)));
    if (/^\s*\d{2,6}\s+\d+\s+\d+\s+\d+/.test(prefix) && !bytes.subarray(0, Math.min(bytes.length, 64)).includes(0)) {
      const fullText = decodeText(bytes);
      const parsed = parseSatText(fullText);
      if (parsed.valid) {
        return {
          kind: 'sat',
          body: { name, entryPath, sat: fullText, ...(parsed.unitsMmPerUnit ? { unitsMmPerUnit: parsed.unitsMmPerUnit } : {}), ...(design ? { design } : {}) },
        };
      }
    }
    const header = readBinaryBrepHeader(bytes);
    return {
      kind: 'binary',
      body: { name, entryPath, format: ext, ...(header ? { header } : {}), size: bytes.length, ...(design ? { design } : {}) },
    };
  }

  return { kind: 'invalid', reason: `unrecognized B-rep entry "${entryPath}"` };
}
