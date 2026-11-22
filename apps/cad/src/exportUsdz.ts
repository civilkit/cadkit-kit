// Pure-TypeScript USDZ (Apple Quick Look / Pixar Universal Scene Description) exporter.
// Produces an uncompressed, 64-byte-aligned ZIP archive (.usdz) containing a valid ASCII .usda
// scene with per-body Mesh prims (Y-up, centimetres, metersPerUnit = 0.01) and UsdPreviewSurface
// PBR materials derived from each body's appearance. Zero external dependencies.

import { crc32, facetNormal, parseHexColor, type MeshBody, type ZipFile } from '@kit/io';
import { fileStem, type ExportNotice, type ExportResult } from './exportFiles';

export interface UsdaResult {
  usda: string;
  triangles: number;
  vertices: number;
  bodies: number;
}

export interface UsdzResult extends UsdaResult {
  data: Uint8Array;
}

const USDZ_ALIGN = 64;
/** Pixar USDZ ZIP extra field header ID for alignment padding. */
const USDZ_EXTRA_HEADER_ID = 0x1986;

const srgbToLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Format a number cleanly for USDA (no -0, no NaN/Infinity, compact precision). */
function fmt(n: number, digits = 6): string {
  if (!Number.isFinite(n)) return '0';
  const v = Math.abs(n) < 1e-12 ? 0 : n;
  return Number(v.toFixed(digits)).toString();
}

/** Escape a string literal for USDA double-quoted strings. */
function escapeUsdString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

/** Convert an arbitrary body name into a valid, unique USD prim identifier ([A-Za-z_][A-Za-z0-9_]*). */
export function usdIdentifier(raw: string | undefined, used: Set<string>, fallback = 'Body'): string {
  let id = (raw ?? '').trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!id) id = fallback;
  if (/^[0-9]/.test(id)) id = `_${id}`;
  let candidate = id;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${id}_${n++}`;
  }
  used.add(candidate);
  return candidate;
}

/** Convert a CadKit point (Z-up, millimetres) to USD Quick Look space (Y-up, centimetres):
 *  (x, y, z) -> (x / 10, z / 10, -y / 10). Rotation about X has determinant +1, so CCW winding is preserved. */
export const toUsdPoint = (x: number, y: number, z: number): [number, number, number] => [x / 10, z / 10, -y / 10];
const toUsdNormal = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];

/**
 * Build an uncompressed ZIP archive whose entry payloads each start at a 64-byte aligned offset,
 * as required by the Pixar USDZ specification and Apple Quick Look.
 */
export function buildUsdzZip(files: readonly ZipFile[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const baseDataOffset = offset + 30 + name.length;
    const rem = baseDataOffset % USDZ_ALIGN;
    let padLen = rem === 0 ? 0 : USDZ_ALIGN - rem;
    // A valid ZIP extra field needs at least 4 bytes (2-byte header ID + 2-byte data length).
    if (padLen > 0 && padLen < 4) padLen += USDZ_ALIGN;

    const extra = new Uint8Array(padLen);
    if (padLen >= 4) {
      const ev = new DataView(extra.buffer);
      ev.setUint16(0, USDZ_EXTRA_HEADER_ID, true);
      ev.setUint16(2, padLen - 4, true);
    }

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); // Local file header signature
    lh.setUint16(4, 20, true);         // Version needed (2.0)
    lh.setUint16(6, 0x0800, true);     // UTF-8 filename flag
    lh.setUint16(8, 0, true);          // Compression method: 0 = Store (uncompressed)
    lh.setUint16(10, 0, true);         // Mod time: 00:00:00 (reproducible)
    lh.setUint16(12, 0x0021, true);    // Mod date: 1980-01-01
    lh.setUint32(14, crc, true);
    lh.setUint32(18, f.data.length, true);
    lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, extra.length, true);

    parts.push(new Uint8Array(lh.buffer), name, extra, f.data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); // Central directory header signature
    ch.setUint16(4, 20, true);         // Version made by
    ch.setUint16(6, 20, true);         // Version needed
    ch.setUint16(8, 0x0800, true);     // UTF-8 filename flag
    ch.setUint16(10, 0, true);         // Compression method: 0 = Store
    ch.setUint16(12, 0, true);
    ch.setUint16(14, 0x0021, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, f.data.length, true);
    ch.setUint32(24, f.data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true);         // Extra field length (padding lives in local header only)
    ch.setUint32(42, offset, true);    // Relative offset of local header

    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + extra.length + f.data.length;
  }

  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);

  const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
  const totalLen = all.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const chunk of all) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

/** Generate a valid ASCII `.usda` scene with per-body `Mesh` prims and `UsdPreviewSurface` materials. */
export function meshToUsda(bodies: readonly MeshBody[], opts: { name?: string } = {}): UsdaResult {
  const live = bodies.filter((b) => Math.floor(b.positions.length / 9) > 0);
  const rootName = 'Root';
  const usedPrims = new Set<string>(['Materials']);
  const usedMats = new Set<string>();
  const matBlocks: string[] = [];
  const meshBlocks: string[] = [];

  let totalTriangles = 0;
  let totalVertices = 0;

  live.forEach((b, bi) => {
    const p = b.positions;
    const nT = Math.floor(p.length / 9);
    const key = new Map<string, number>();
    const pts: number[] = [];
    const nrm: number[] = [];
    const idx: number[] = [];
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];

    for (let t = 0; t < nT; t++) {
      const fn = facetNormal(p, t);
      for (let k = 0; k < 3; k++) {
        const o = t * 9 + k * 3;
        let n: [number, number, number] = b.normals
          ? [b.normals[o], b.normals[o + 1], b.normals[o + 2]]
          : fn;
        const l = Math.hypot(n[0], n[1], n[2]);
        n = l > 0 ? [n[0] / l, n[1] / l, n[2] / l] : fn;

        const u = toUsdPoint(Math.fround(p[o]), Math.fround(p[o + 1]), Math.fround(p[o + 2]));
        const un = toUsdNormal(n[0], n[1], n[2]);
        const kk = `${u[0]},${u[1]},${u[2]}|${Math.round(un[0] * 1000)},${Math.round(un[1] * 1000)},${Math.round(un[2] * 1000)}`;
        let vi = key.get(kk);
        if (vi === undefined) {
          vi = pts.length / 3;
          key.set(kk, vi);
          pts.push(u[0], u[1], u[2]);
          nrm.push(un[0], un[1], un[2]);
          for (let a = 0; a < 3; a++) {
            if (u[a] < lo[a]) lo[a] = u[a];
            if (u[a] > hi[a]) hi[a] = u[a];
          }
        }
        idx.push(vi);
      }
    }

    const vertCount = pts.length / 3;
    const triCount = idx.length / 3;
    totalTriangles += triCount;
    totalVertices += vertCount;

    const rawName = b.name || `Body ${bi + 1}`;
    const meshId = usdIdentifier(rawName, usedPrims, `Body_${bi + 1}`);
    const matId = usdIdentifier(`Mat_${meshId}`, usedMats, `Mat_${bi}`);

    const rgb = parseHexColor(b.color) ?? [204, 204, 204];
    const lin = rgb.map(srgbToLinear);
    const metallic = clamp01(b.metallic ?? 0);
    const roughness = clamp01(b.roughness ?? 0.6);
    const opacity = clamp01(b.opacity ?? 1);

    matBlocks.push(
      `        def Material "${matId}"\n` +
      `        {\n` +
      `            token outputs:surface.connect = </${rootName}/Materials/${matId}/PreviewSurface.outputs:surface>\n` +
      `\n` +
      `            def Shader "PreviewSurface"\n` +
      `            {\n` +
      `                uniform token info:id = "UsdPreviewSurface"\n` +
      `                color3f inputs:diffuseColor = (${fmt(lin[0], 4)}, ${fmt(lin[1], 4)}, ${fmt(lin[2], 4)})\n` +
      `                float inputs:metallic = ${fmt(metallic, 4)}\n` +
      `                float inputs:opacity = ${fmt(opacity, 4)}\n` +
      `                float inputs:roughness = ${fmt(roughness, 4)}\n` +
      `                token outputs:surface\n` +
      `            }\n` +
      `        }`,
    );

    const pointStrs: string[] = new Array(vertCount);
    const normalStrs: string[] = new Array(vertCount);
    for (let i = 0; i < vertCount; i++) {
      const o = i * 3;
      pointStrs[i] = `(${fmt(pts[o])}, ${fmt(pts[o + 1])}, ${fmt(pts[o + 2])})`;
      normalStrs[i] = `(${fmt(nrm[o], 5)}, ${fmt(nrm[o + 1], 5)}, ${fmt(nrm[o + 2], 5)})`;
    }
    const countsStr = new Array(triCount).fill('3').join(', ');
    const indicesStr = idx.join(', ');
    const displayMeta = rawName !== meshId
      ? `\n        displayName = "${escapeUsdString(rawName)}"`
      : '';

    meshBlocks.push(
      `    def Mesh "${meshId}" (\n` +
      `        prepend apiSchemas = ["MaterialBindingAPI"]${displayMeta}\n` +
      `    )\n` +
      `    {\n` +
      `        float3[] extent = [(${fmt(lo[0])}, ${fmt(lo[1])}, ${fmt(lo[2])}), (${fmt(hi[0])}, ${fmt(hi[1])}, ${fmt(hi[2])})]\n` +
      `        int[] faceVertexCounts = [${countsStr}]\n` +
      `        int[] faceVertexIndices = [${indicesStr}]\n` +
      `        rel material:binding = </${rootName}/Materials/${matId}>\n` +
      `        normal3f[] normals = [${normalStrs.join(', ')}] (\n` +
      `            interpolation = "vertex"\n` +
      `        )\n` +
      `        point3f[] points = [${pointStrs.join(', ')}]\n` +
      `        uniform token subdivisionScheme = "none"\n` +
      `    }`,
    );
  });

  const docTitle = opts.name ? `Exported from CadKit: ${opts.name}` : 'Exported from CadKit';
  const usda =
    `#usda 1.0\n` +
    `(\n` +
    `    defaultPrim = "${rootName}"\n` +
    `    doc = "${escapeUsdString(docTitle)}"\n` +
    `    metersPerUnit = 0.01\n` +
    `    upAxis = "Y"\n` +
    `)\n` +
    `\n` +
    `def Xform "${rootName}" (\n` +
    `    kind = "component"\n` +
    `)\n` +
    `{\n` +
    `    def Scope "Materials"\n` +
    `    {\n` +
    `${matBlocks.join('\n\n')}\n` +
    `    }\n` +
    `\n` +
    `${meshBlocks.join('\n\n')}\n` +
    `}\n`;

  return { usda, triangles: totalTriangles, vertices: totalVertices, bodies: live.length };
}

/** Package one or more bodies into a 64-byte-aligned uncompressed USDZ archive. */
export function meshToUsdz(bodies: readonly MeshBody[], opts: { name?: string } = {}): UsdzResult {
  const res = meshToUsda(bodies, opts);
  const safeStem = fileStem(opts.name).replace(/[^A-Za-z0-9_-]+/g, '_') || 'part';
  const usdaBytes = new TextEncoder().encode(res.usda);
  const data = buildUsdzZip([{ name: `${safeStem}.usda`, data: usdaBytes }]);
  return { ...res, data };
}

const noBody: ExportNotice = { level: 'error', key: 'io.noBody' };

function refNotices(refs: readonly MeshBody[], name: string): ExportNotice[] {
  if (!refs.length) return [];
  const triangles = refs.reduce((n, b) => n + Math.floor(b.positions.length / 9), 0);
  return [{ level: 'info', key: 'io.refMeshesIncluded', params: { name, count: refs.length, triangles } }];
}

/** USDZ (Apple Quick Look / Pixar USD): uncompressed 64-byte-aligned zip containing a .usda scene, Y up, centimetres. */
export function exportUsdz(
  bodies: readonly MeshBody[] | null,
  partName: string | undefined,
  refs: readonly MeshBody[] = [],
): ExportResult {
  const all = [...(bodies ?? []), ...refs];
  if (!all.length) return { notices: [noBody] };
  const stem = fileStem(partName);
  const r = meshToUsdz(all, { name: partName || stem });
  if (!r.triangles) return { notices: [noBody] };
  const name = `${stem}.usdz`;
  const notices: ExportNotice[] = [
    { level: 'info', key: 'io.doneUsdz', params: { name, triangles: r.triangles, bodies: r.bodies } },
    ...refNotices(refs, name),
  ];
  return { file: { name, data: r.data, mime: 'model/vnd.usdz+zip' }, notices };
}
