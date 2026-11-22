// Fusion 360 (.f3d / .f3z) archive reader and importer.
// Clean-room, zero-dependency TypeScript implementation:
//  - Unpacks .f3d (single design ZIP) and .f3z (multi-design assembly ZIP with nested .f3d archives).
//  - Extracts design metadata (Manifest.dat), user parameters (converted from Fusion cm -> CadKit mm),
//    readable parametric timeline features (Sketch, Extrude, Revolve, Fillet, Chamfer, offset Plane),
//    and embedded B-rep blobs (ACIS ASCII .sat, .step/.stp, and binary .smb/.smbh/.sab detection).
//  - Never throws on corrupt, truncated, encrypted, or unknown archives; always returns a structured
//    F3dImportResult with plain-English warnings/errors.

import { zipEntries, zipRead, looksLikeZip, type F3dZipEntry } from './zip';
import { parseManifest, inferDesignName, decodeText, type F3dManifest } from './manifest';
import { classifyBrepEntry, inspectBrepEntry, type F3dSatBody, type F3dStepBody, type F3dBinaryBody } from './brep';
import {
  extractParametersFromJson,
  extractParametersFromXml,
  extractTimelineFromJson,
  type F3dWarning,
  type F3dStep,
  type F3dParameter,
  type TimelineParseContext,
} from './timeline';

export * from './zip';
export * from './units';
export * from './manifest';
export * from './brep';
export * from './timeline';

export interface F3dDesignSummary {
  name: string;
  entryPath?: string;
  featureCount: number;
  satCount: number;
  stepCount: number;
  binaryBodyCount: number;
}

export interface F3dImportOptions {
  /** Maximum recursion depth for nested .f3d archives inside .f3z assemblies (default 4). */
  maxDepth?: number;
}

export interface F3dImportResult {
  name: string;
  kind: 'f3d' | 'f3z';
  part: {
    format: 'ck-part';
    version: number;
    name: string;
    features: Array<Record<string, unknown>>;
    seq: number;
    variables?: Array<{ name: string; expr: string }>;
    blobs?: Record<string, string>;
  } & Record<string, unknown>;
  /** Extracted ACIS ASCII SAT B-rep blobs ready for ck-io `importSat`. */
  satBodies: F3dSatBody[];
  /** Extracted STEP B-rep blobs ready for `importStep` / `partOfStep`. */
  stepBodies: F3dStepBody[];
  /** Detected binary ACIS/ASM (.smb/.smbh/.sab) B-rep blobs. */
  binaryBodies: F3dBinaryBody[];
  /** Extracted user parameters (already converted to mm / deg). */
  parameters: F3dParameter[];
  /** Mapped parametric timeline steps, in order. */
  steps: F3dStep[];
  /** Timeline features that could not be mapped to native CadKit features. */
  skipped: string[];
  /** Designs unpacked (one for .f3d, one per nested .f3d for .f3z). */
  designs: F3dDesignSummary[];
  /** Plain-English import warnings (never fatal). */
  warnings: F3dWarning[];
  /** Non-empty when the archive itself could not be read (corrupt, truncated, encrypted, not a ZIP). */
  error?: string;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

function emptyResult(name: string, kind: 'f3d' | 'f3z', error?: string, warnings: F3dWarning[] = []): F3dImportResult {
  return {
    name,
    kind,
    part: { format: 'ck-part', version: 1, name, features: [], seq: 1 },
    satBodies: [],
    stepBodies: [],
    binaryBodies: [],
    parameters: [],
    steps: [],
    skipped: [],
    designs: [],
    warnings,
    ...(error ? { error } : {}),
  };
}

function isMetadataJsonEntry(entryName: string): boolean {
  const lower = entryName.replace(/\\/g, '/').toLowerCase();
  if (!lower.endsWith('.json')) return false;
  const base = lower.split('/').pop() ?? '';
  return (
    base === 'parameters.json' ||
    base === 'userparameters.json' ||
    base === 'timeline.json' ||
    base === 'features.json' ||
    base === 'design.json' ||
    base === 'manifest.json' ||
    lower.includes('designdata/') ||
    lower.includes('fusionassetname')
  );
}

function isMetadataXmlEntry(entryName: string): boolean {
  const lower = entryName.replace(/\\/g, '/').toLowerCase();
  if (!lower.endsWith('.xml')) return false;
  const base = lower.split('/').pop() ?? '';
  return (
    base === 'parameters.xml' ||
    base === 'userparameters.xml' ||
    base === 'design.xml' ||
    base === 'manifest.xml' ||
    lower.includes('designdata/')
  );
}

function isManifestEntry(entryName: string): boolean {
  const base = (entryName.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase();
  return base === 'manifest.dat' || base === 'manifest.xml' || base === 'manifest.json';
}

interface InternalAccumulator {
  seq: number;
  features: Array<Record<string, unknown>>;
  steps: F3dStep[];
  skipped: string[];
  warnings: F3dWarning[];
  parameters: F3dParameter[];
  seenVarNames: Set<string>;
  satBodies: F3dSatBody[];
  stepBodies: F3dStepBody[];
  binaryBodies: F3dBinaryBody[];
  designs: F3dDesignSummary[];
}

async function unpackArchive(
  bytes: Uint8Array,
  fallbackName: string | undefined,
  acc: InternalAccumulator,
  opts: { depth: number; maxDepth: number; entryPath?: string; namePrefix?: string },
): Promise<{ name: string; kind: 'f3d' | 'f3z'; error?: string }> {
  if (!bytes || bytes.length === 0) {
    const msg = 'the Fusion 360 file is empty';
    acc.warnings.push({ object: fallbackName ?? 'archive', code: 'emptyFile', message: msg });
    return { name: inferDesignName([], fallbackName), kind: 'f3d', error: msg };
  }

  if (!looksLikeZip(bytes)) {
    const msg = 'file is not a valid Fusion 360 (.f3d / .f3z) ZIP archive';
    acc.warnings.push({ object: fallbackName ?? 'archive', code: 'notZip', message: msg });
    return { name: inferDesignName([], fallbackName), kind: 'f3d', error: msg };
  }

  let entries: F3dZipEntry[];
  try {
    entries = zipEntries(bytes);
  } catch (e) {
    const msg = `could not read Fusion 360 archive: ${(e as Error).message}`;
    acc.warnings.push({ object: fallbackName ?? 'archive', code: 'corruptZip', message: msg });
    return { name: inferDesignName([], fallbackName), kind: 'f3d', error: msg };
  }

  const fileEntries = entries.filter((e) => !e.name.endsWith('/'));
  if (fileEntries.length === 0) {
    const msg = 'Fusion 360 archive contains no files';
    acc.warnings.push({ object: fallbackName ?? 'archive', code: 'emptyArchive', message: msg });
    return { name: inferDesignName([], fallbackName), kind: 'f3d', error: msg };
  }

  // Detect encrypted entries upfront
  const encryptedEntries = fileEntries.filter((e) => e.encrypted);
  if (encryptedEntries.length === fileEntries.length) {
    const msg = 'Fusion 360 archive is encrypted / password-protected and cannot be read';
    acc.warnings.push({ object: fallbackName ?? 'archive', code: 'encryptedArchive', message: msg });
    return { name: inferDesignName([], fallbackName), kind: 'f3d', error: msg };
  }

  // Read Manifest.dat (if present) first so we know design name & unit defaults
  let manifest: F3dManifest = { references: [] };
  const manifestEntry = fileEntries.find((e) => isManifestEntry(e.name));
  if (manifestEntry) {
    try {
      const mBytes = await zipRead(bytes, manifestEntry);
      manifest = parseManifest(mBytes);
    } catch (e) {
      acc.warnings.push({
        object: manifestEntry.name,
        code: 'manifestReadFailed',
        message: `could not read ${manifestEntry.name}: ${(e as Error).message}`,
      });
    }
  }

  const designName = manifest.name || inferDesignName(fileEntries.map((e) => e.name), fallbackName);

  // Check if this is a .f3z multi-design archive (contains nested .f3d or .f3z entries)
  const nestedDesigns = fileEntries.filter((e) => /\.(f3d|f3z)$/i.test(e.name));
  if (nestedDesigns.length > 0) {
    if (opts.depth >= opts.maxDepth) {
      acc.warnings.push({
        object: designName,
        code: 'maxDepthExceeded',
        message: `nested .f3d/.f3z archive depth exceeded limit (${opts.maxDepth}); deeper entries were skipped`,
      });
      return { name: designName, kind: 'f3z' };
    }

    // Extract any top-level assembly parameters from Manifest.dat
    if (manifest.rawJson) {
      const topCtx: TimelineParseContext = {
        nextId: () => `F${acc.seq++}`,
        features: acc.features,
        steps: acc.steps,
        skipped: acc.skipped,
        warnings: acc.warnings,
        parameters: acc.parameters,
        seenVarNames: acc.seenVarNames,
        sketchIdByRef: new Map(),
        defaultLengthUnit: 'cm',
      };
      extractParametersFromJson(manifest.rawJson, topCtx);
    }

    const usePrefix = nestedDesigns.length > 1;
    for (const child of nestedDesigns) {
      let childBytes: Uint8Array;
      try {
        childBytes = await zipRead(bytes, child);
      } catch (e) {
        acc.warnings.push({
          object: child.name,
          code: 'nestedReadFailed',
          message: `could not extract nested design "${child.name}": ${(e as Error).message}`,
        });
        continue;
      }
      const childFallback = child.name.replace(/^.*[\\/]/, '').replace(/\.(f3d|f3z)$/i, '');
      await unpackArchive(childBytes, childFallback, acc, {
        depth: opts.depth + 1,
        maxDepth: opts.maxDepth,
        entryPath: child.name,
        namePrefix: usePrefix ? childFallback : opts.namePrefix,
      });
    }
    return { name: designName, kind: 'f3z' };
  }

  // Single .f3d design archive
  const featStart = acc.features.length;
  const satStart = acc.satBodies.length;
  const stepStart = acc.stepBodies.length;
  const binStart = acc.binaryBodies.length;

  const ctx: TimelineParseContext = {
    nextId: () => `F${acc.seq++}`,
    features: acc.features,
    steps: acc.steps,
    skipped: acc.skipped,
    warnings: acc.warnings,
    parameters: acc.parameters,
    seenVarNames: acc.seenVarNames,
    sketchIdByRef: new Map(),
    namePrefix: opts.namePrefix,
    // Fusion 360 internal coordinates and bare numeric parameter values are always cm
    defaultLengthUnit: 'cm',
  };

  // Extract parameters and timeline from Manifest.dat JSON if embedded there
  if (manifest.rawJson) {
    extractParametersFromJson(manifest.rawJson, ctx);
    extractTimelineFromJson(manifest.rawJson, ctx);
  }

  // Sort entries deterministically: parameters first, then timeline/design JSON/XML, then B-rep files
  const paramEntries: F3dZipEntry[] = [];
  const timelineEntries: F3dZipEntry[] = [];
  const xmlEntries: F3dZipEntry[] = [];
  const brepEntries: F3dZipEntry[] = [];

  for (const e of fileEntries) {
    if (e === manifestEntry) continue;
    if (e.encrypted) {
      acc.warnings.push({
        object: e.name,
        code: 'encryptedEntry',
        message: `skipped encrypted archive entry "${e.name}"`,
      });
      continue;
    }
    if (classifyBrepEntry(e.name)) {
      brepEntries.push(e);
    } else if (isMetadataJsonEntry(e.name)) {
      if (e.name.toLowerCase().includes('param')) paramEntries.push(e);
      else timelineEntries.push(e);
    } else if (isMetadataXmlEntry(e.name)) {
      xmlEntries.push(e);
    }
  }

  // 1. JSON parameter files
  for (const e of paramEntries) {
    try {
      const text = decodeText(await zipRead(bytes, e));
      extractParametersFromJson(JSON.parse(text), ctx);
    } catch (err) {
      acc.warnings.push({
        object: e.name,
        code: 'metadataParseFailed',
        message: `could not parse "${e.name}": ${(err as Error).message}`,
      });
    }
  }

  // 2. XML metadata files
  for (const e of xmlEntries) {
    try {
      const text = decodeText(await zipRead(bytes, e));
      extractParametersFromXml(text, ctx);
    } catch (err) {
      acc.warnings.push({
        object: e.name,
        code: 'metadataParseFailed',
        message: `could not parse "${e.name}": ${(err as Error).message}`,
      });
    }
  }

  // 3. JSON timeline / design files
  for (const e of timelineEntries) {
    try {
      const text = decodeText(await zipRead(bytes, e));
      const parsed = JSON.parse(text);
      extractParametersFromJson(parsed, ctx);
      extractTimelineFromJson(parsed, ctx);
    } catch (err) {
      acc.warnings.push({
        object: e.name,
        code: 'metadataParseFailed',
        message: `could not parse "${e.name}": ${(err as Error).message}`,
      });
    }
  }

  // 4. Embedded B-rep blobs (.sat, .step/.stp, .smb/.smbh/.sab)
  for (const e of brepEntries) {
    let raw: Uint8Array;
    try {
      raw = await zipRead(bytes, e);
    } catch (err) {
      acc.warnings.push({
        object: e.name,
        code: 'brepReadFailed',
        message: `could not extract B-rep entry "${e.name}": ${(err as Error).message}`,
      });
      continue;
    }
    const inspected = inspectBrepEntry(e.name, raw, opts.namePrefix ? designName : undefined);
    if (inspected.kind === 'sat') {
      acc.satBodies.push(inspected.body);
    } else if (inspected.kind === 'step') {
      acc.stepBodies.push(inspected.body);
    } else if (inspected.kind === 'binary') {
      acc.binaryBodies.push(inspected.body);
    } else {
      acc.warnings.push({
        object: e.name,
        code: 'invalidBrep',
        message: inspected.reason,
      });
    }
  }

  const featureCount = acc.features.length - featStart;
  const satCount = acc.satBodies.length - satStart;
  const stepCount = acc.stepBodies.length - stepStart;
  const binaryBodyCount = acc.binaryBodies.length - binStart;

  if (binaryBodyCount > 0 && featureCount === 0 && satCount === 0 && stepCount === 0) {
    acc.warnings.push({
      object: designName,
      code: 'binarySmbOnly',
      message: `found ${binaryBodyCount} binary ACIS/ASM (.smb/.sab) B-rep body file(s) with no readable ASCII SAT, STEP, or timeline JSON; export as STEP (.step) or ACIS SAT (.sat) from Fusion 360 to import the solid geometry`,
    });
  } else if (binaryBodyCount > 0 && featureCount === 0) {
    acc.warnings.push({
      object: designName,
      code: 'binarySmbSkipped',
      message: `${binaryBodyCount} binary ACIS/ASM (.smb/.sab) file(s) were skipped; using embedded SAT/STEP geometry instead`,
    });
  }

  acc.designs.push({
    name: designName,
    ...(opts.entryPath ? { entryPath: opts.entryPath } : {}),
    featureCount,
    satCount,
    stepCount,
    binaryBodyCount,
  });

  return { name: designName, kind: 'f3d' };
}

/**
 * Unpack and import a Fusion 360 `.f3d` (single design) or `.f3z` (multi-design assembly) archive.
 * Never throws: corrupt, truncated, encrypted, or unsupported archives return a structured result
 * with plain-English `error` / `warnings`.
 */
export async function importF3d(
  bytes: Uint8Array,
  name?: string,
  opts: F3dImportOptions = {},
): Promise<F3dImportResult> {
  const maxDepth = opts.maxDepth ?? 4;
  const isF3zName = typeof name === 'string' && /\.f3z$/i.test(name);
  const acc: InternalAccumulator = {
    seq: 1,
    features: [],
    steps: [],
    skipped: [],
    warnings: [],
    parameters: [],
    seenVarNames: new Set(),
    satBodies: [],
    stepBodies: [],
    binaryBodies: [],
    designs: [],
  };

  const top = await unpackArchive(bytes, name, acc, { depth: 0, maxDepth });
  const kind: 'f3d' | 'f3z' = top.kind === 'f3z' || isF3zName ? 'f3z' : 'f3d';

  if (top.error) {
    return emptyResult(top.name, kind, top.error, acc.warnings);
  }

  // If there are no native history features but embedded STEP bodies exist, wire them directly as `importStep` features.
  const blobs: Record<string, string> = {};
  if (acc.features.length === 0 && acc.stepBodies.length > 0) {
    for (const sb of acc.stepBodies) {
      const key = await sha256Hex(sb.step);
      blobs[key] = sb.step;
      const id = `F${acc.seq++}`;
      const featName = sb.design ? `${sb.design} - ${sb.name}` : sb.name;
      acc.features.push({
        type: 'importStep',
        id,
        name: featName,
        blob: key,
        heal: true,
      });
      acc.steps.push({ f3d: featName, type: 'ImportedSTEP', features: [id] });
    }
  }

  const variables = acc.parameters.map((p) => ({ name: p.name, expr: p.expr }));
  const part: F3dImportResult['part'] = {
    format: 'ck-part',
    version: 1,
    name: top.name,
    features: acc.features,
    seq: acc.seq,
    ...(variables.length ? { variables } : {}),
    ...(Object.keys(blobs).length ? { blobs } : {}),
  };

  if (acc.features.length === 0 && acc.satBodies.length === 0 && acc.stepBodies.length === 0 && acc.warnings.length === 0) {
    acc.warnings.push({
      object: top.name,
      code: 'noGeometry',
      message: 'no readable Fusion 360 timeline features, SAT bodies, or STEP geometry were found in this archive',
    });
  }

  return {
    name: top.name,
    kind,
    part,
    satBodies: acc.satBodies,
    stepBodies: acc.stepBodies,
    binaryBodies: acc.binaryBodies,
    parameters: acc.parameters,
    steps: acc.steps,
    skipped: acc.skipped,
    designs: acc.designs,
    warnings: acc.warnings,
  };
}
