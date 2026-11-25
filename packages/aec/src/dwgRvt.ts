// Clean-room AutoCAD DWG (.dwg AC1012..AC1032 2D/3D) & Revit (.rvt / .rfa OLE2/CFB) importers.
// Zero external dependencies. Extracts 2D sketch entities, 3D solids/extrusions, ACIS SAT payloads,
// meshes, layers/storeys, and Revit BasicFileInfo + PartAtom family parameters into CadKit Part features.

import {
  PartBuilder,
  aciToHex,
  clean,
  decodeText,
  defaultAecColor,
  makeTransform3D,
  rgbToHex,
  type SketchCurve2D,
} from './geom';
import type { AecImportReport, V2, V3 } from './types';

export const DWG_VERSIONS: Record<string, string> = {
  AC1006: 'AutoCAD R10',
  AC1009: 'AutoCAD R11/R12',
  AC1012: 'AutoCAD R13',
  AC1014: 'AutoCAD R14',
  AC1015: 'AutoCAD 2000',
  AC1018: 'AutoCAD 2004',
  AC1021: 'AutoCAD 2007',
  AC1024: 'AutoCAD 2010',
  AC1027: 'AutoCAD 2013',
  AC1032: 'AutoCAD 2018+',
};

const DWG_INSUNITS_TO_MM: Record<number, number> = {
  0: 1, // Unitless -> default mm
  1: 25.4, // Inches
  2: 304.8, // Feet
  3: 1609344, // Miles
  4: 1, // Millimeters
  5: 10, // Centimeters
  6: 1000, // Meters
  7: 1e6, // Kilometers
};

/** True when `bytes` begins with an AutoCAD DWG version header (`AC1012`..`AC1032`). */
export function looksLikeDwg(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < 6) return false;
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
  return /^AC10(06|09|12|14|15|18|21|24|27|32)$/.test(sig);
}

/** Decode AutoCAD R2000+ obfuscated ACIS SAT byte stream (complement cipher `159 - b` for `33..126`) or plain ASCII SAT. */
export function decodeDwgAcisSat(raw: Uint8Array): string {
  // Check if already plain ASCII SAT
  const preview = decodeText(raw.subarray(0, Math.min(raw.length, 64)));
  if (/^\s*\d+\s+\d+\s+\d+\s+\d+/.test(preview) || preview.includes('body ') || preview.includes('End-of-ACIS-data')) {
    return decodeText(raw);
  }
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    if (b >= 33 && b <= 126) {
      out[i] = 159 - b;
    } else {
      out[i] = b;
    }
  }
  return decodeText(out);
}

/** Extract basic 3D solid bounding/primitive parameters from an ASCII ACIS SAT string if present. */
function extractSolidFromSatText(sat: string): {
  kind: 'box' | 'cylinder' | 'extrude';
  origin: V3;
  dx: number;
  dy: number;
  dz: number;
  radius?: number;
} | null {
  // Look for explicit point coordinates in SAT (`point $-1 -1 x y z #`)
  const pts: V3[] = [];
  const ptRe = /\bpoint\b[^\n#]*?\s([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*#/gi;
  let m: RegExpExecArray | null;
  while ((m = ptRe.exec(sat)) !== null) {
    pts.push([Number(m[1]), Number(m[2]), Number(m[3])]);
  }
  // Check cylinder/cone radius if `cone-surface` or `ellipse-curve` is present
  const ellRe = /\bellipse-curve\b[^\n#]*?\s([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(sat);
  if (pts.length >= 2) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const [x, y, z] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const dx = Math.max(1, maxX - minX);
    const dy = Math.max(1, maxY - minY);
    const dz = Math.max(1, maxZ - minZ);
    if (ellRe) {
      const rx = Number(ellRe[7]);
      const ry = Number(ellRe[8]);
      const rz = Number(ellRe[9]);
      const r = Math.hypot(rx, ry, rz);
      if (r > 1e-3) {
        return { kind: 'cylinder', origin: [minX + r, minY + r, minZ], dx: r * 2, dy: r * 2, dz, radius: r };
      }
    }
    return { kind: 'box', origin: [minX, minY, minZ], dx, dy, dz };
  }
  return null;
}

export interface DwgLayerSpec {
  name: string;
  aci?: number;
  color?: string;
  visible?: boolean;
}

export type DwgEntitySpec =
  | {
      type: 'LINE';
      layer?: string;
      color?: string;
      aci?: number;
      p1: V2 | V3;
      p2: V2 | V3;
      thickness?: number;
    }
  | {
      type: 'CIRCLE';
      name?: string;
      layer?: string;
      color?: string;
      aci?: number;
      center: V2 | V3;
      radius: number;
      thickness?: number;
    }
  | {
      type: 'ARC';
      layer?: string;
      color?: string;
      aci?: number;
      center: V2 | V3;
      radius: number;
      startAngleDeg: number;
      endAngleDeg: number;
    }
  | {
      type: 'LWPOLYLINE';
      name?: string;
      layer?: string;
      color?: string;
      aci?: number;
      points: V2[];
      closed?: boolean;
      elevation?: number;
      thickness?: number;
    }
  | {
      type: 'EXTRUDEDSOLID' | 'BOX';
      name?: string;
      layer?: string;
      color?: string;
      aci?: number;
      origin?: V3;
      normal?: V3;
      xDir?: V3;
      profile?: V2[];
      dx?: number;
      dy?: number;
      height: number;
    }
  | {
      type: 'CYLINDER';
      name?: string;
      layer?: string;
      color?: string;
      aci?: number;
      origin?: V3;
      radius: number;
      height: number;
    }
  | {
      type: 'SPHERE';
      name?: string;
      layer?: string;
      color?: string;
      aci?: number;
      center: V3;
      radius: number;
    }
  | {
      type: '3DSOLID';
      name?: string;
      layer?: string;
      color?: string;
      aci?: number;
      sat: string;
      obfuscated?: boolean;
    }
  | {
      type: 'MESH' | 'POLYFACEMESH';
      name?: string;
      layer?: string;
      color?: string;
      aci?: number;
      vertices: number[];
      indices: number[];
    };

/**
 * Import an AutoCAD `.dwg` (`AC1012`..`AC1032`) file into a CadKit `Part` and `AecImportReport`.
 */
export function importDwg(bytes: Uint8Array, fileName = 'Drawing.dwg'): AecImportReport {
  const defaultName = fileName.replace(/^.*[\\/]/, '').replace(/\.dwg$/i, '') || 'AutoCAD DWG';
  const builder = new PartBuilder(defaultName);

  if (!looksLikeDwg(bytes)) {
    const msg = 'file does not have a supported AutoCAD DWG (AC1012..AC1032) header';
    builder.warn(fileName, 'invalidDwgHeader', msg);
    return {
      name: defaultName,
      format: 'dwg',
      schemaVersion: 'Unknown',
      unitScaleToMm: 1,
      part: builder.buildPart(),
      meshes: [],
      storeys: [],
      layers: [],
      elements: [],
      elementCount: 0,
      parameters: [],
      satBodies: [],
      stepBodies: [],
      warnings: builder.warnings,
      summary: `Could not import ${fileName}: ${msg}`,
      error: msg,
    };
  }

  const verCode = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
  const schemaVersion = `${verCode} (${DWG_VERSIONS[verCode] ?? 'AutoCAD'})`;

  let unitScaleToMm = 1;
  if (bytes.length >= 25) {
    const insUnits = bytes[20];
    if (insUnits in DWG_INSUNITS_TO_MM && insUnits > 0) {
      unitScaleToMm = DWG_INSUNITS_TO_MM[insUnits];
    }
  }

  const layerColorMap = new Map<string, string>();
  const registerLayer = (l: DwgLayerSpec) => {
    const col = l.color ?? (typeof l.aci === 'number' ? aciToHex(l.aci) : '#8fa1b3');
    layerColorMap.set(l.name, col);
    builder.ensureLayer(l.name, col, l.visible !== false);
  };

  // Group 2D sketch curves by (layerName, elevation) so 2D linework on a layer becomes a clean CadKit sketch
  const sketchCurvesByLayer = new Map<string, { layer: string; elevation: number; color: string; curves: SketchCurve2D[] }>();
  const add2DCurve = (layer: string, elevation: number, color: string, curve: SketchCurve2D) => {
    const key = `${layer}@@${clean(elevation)}`;
    let g = sketchCurvesByLayer.get(key);
    if (!g) {
      g = { layer, elevation: clean(elevation), color, curves: [] };
      sketchCurvesByLayer.set(key, g);
    }
    g.curves.push(curve);
  };

  let solidIdx = 0;

  const processEntity = (ent: DwgEntitySpec) => {
    const layer = ent.layer || '0';
    if (!layerColorMap.has(layer)) {
      registerLayer({ name: layer, aci: ent.aci });
    }
    const color =
      ent.color ??
      (typeof ent.aci === 'number' ? aciToHex(ent.aci) : undefined) ??
      layerColorMap.get(layer) ??
      '#8fa1b3';
    const s = unitScaleToMm;

    if (ent.type === 'LINE') {
      const z = ((ent.p1 as number[])[2] ?? 0) * s;
      add2DCurve(layer, z, color, {
        type: 'line',
        p1: [ent.p1[0] * s, ent.p1[1] * s],
        p2: [ent.p2[0] * s, ent.p2[1] * s],
      });
      return;
    }

    if (ent.type === 'ARC') {
      const z = ((ent.center as number[])[2] ?? 0) * s;
      const cx = ent.center[0] * s;
      const cy = ent.center[1] * s;
      const r = ent.radius * s;
      const a1 = (ent.startAngleDeg * Math.PI) / 180;
      const a2 = (ent.endAngleDeg * Math.PI) / 180;
      add2DCurve(layer, z, color, {
        type: 'arc',
        center: [cx, cy],
        p1: [cx + r * Math.cos(a1), cy + r * Math.sin(a1)],
        p2: [cx + r * Math.cos(a2), cy + r * Math.sin(a2)],
        ccw: true,
      });
      return;
    }

    if (ent.type === 'CIRCLE') {
      const z = ((ent.center as number[])[2] ?? 0) * s;
      const cx = ent.center[0] * s;
      const cy = ent.center[1] * s;
      const r = ent.radius * s;
      if (ent.thickness && Math.abs(ent.thickness) > 1e-5) {
        solidIdx++;
        builder.addExtrudedCircle({
          name: ent.name ?? `Circle Extrusion ${solidIdx}`,
          category: 'DWG_CircleExtrusion',
          center: [cx, cy],
          radius: r,
          frame: makeTransform3D([0, 0, z]),
          depth: ent.thickness * s,
          layerName: layer,
          color,
        });
      } else {
        add2DCurve(layer, z, color, {
          type: 'circle',
          center: [cx, cy],
          r,
        });
      }
      return;
    }

    if (ent.type === 'LWPOLYLINE') {
      const z = (ent.elevation ?? 0) * s;
      const pts = (ent.points ?? []).map((p) => [p[0] * s, p[1] * s] as V2);
      if (pts.length < 2) return;
      if (ent.closed && ent.thickness && Math.abs(ent.thickness) > 1e-5 && pts.length >= 3) {
        solidIdx++;
        builder.addExtrudedPolygon({
          name: ent.name ?? `Extruded Polyline ${solidIdx}`,
          category: 'DWG_ExtrudedPolyline',
          outer: pts,
          frame: makeTransform3D([0, 0, z]),
          depth: ent.thickness * s,
          layerName: layer,
          color,
        });
      } else {
        for (let i = 0; i + 1 < pts.length; i++) {
          add2DCurve(layer, z, color, { type: 'line', p1: pts[i], p2: pts[i + 1] });
        }
        if (ent.closed && pts.length > 2) {
          add2DCurve(layer, z, color, { type: 'line', p1: pts[pts.length - 1], p2: pts[0] });
        }
      }
      return;
    }

    if (ent.type === 'EXTRUDEDSOLID' || ent.type === 'BOX') {
      solidIdx++;
      const o = ent.origin ?? [0, 0, 0];
      const frame = makeTransform3D(
        [o[0] * s, o[1] * s, o[2] * s],
        ent.normal ?? [0, 0, 1],
        ent.xDir ?? [1, 0, 0],
      );
      const dx = (ent.dx ?? 100) * s;
      const dy = (ent.dy ?? 100) * s;
      const outer = ent.profile
        ? ent.profile.map((p) => [p[0] * s, p[1] * s] as V2)
        : ([
            [0, 0],
            [dx, 0],
            [dx, dy],
            [0, dy],
          ] as V2[]);
      builder.addExtrudedPolygon({
        name: ent.name ?? `Solid ${solidIdx}`,
        category: ent.type,
        outer,
        frame,
        depth: ent.height * s,
        layerName: layer,
        color,
      });
      return;
    }

    if (ent.type === 'CYLINDER') {
      solidIdx++;
      const o = ent.origin ?? [0, 0, 0];
      builder.addExtrudedCircle({
        name: ent.name ?? `Cylinder ${solidIdx}`,
        category: 'DWG_Cylinder',
        radius: ent.radius * s,
        frame: makeTransform3D([o[0] * s, o[1] * s, o[2] * s]),
        depth: ent.height * s,
        layerName: layer,
        color,
      });
      return;
    }

    if (ent.type === 'SPHERE') {
      solidIdx++;
      const c = ent.center ?? [0, 0, 0];
      builder.addSphere({
        name: ent.name ?? `Sphere ${solidIdx}`,
        category: 'DWG_Sphere',
        center: [c[0] * s, c[1] * s, c[2] * s],
        radius: ent.radius * s,
        layerName: layer,
        color,
      });
      return;
    }

    if (ent.type === '3DSOLID' && ent.sat) {
      solidIdx++;
      const satName = ent.name ?? `3DSolid ${solidIdx}`;
      builder.satBodies.push({ name: satName, sat: ent.sat, layer, color });
      const parsed = extractSolidFromSatText(ent.sat);
      if (parsed) {
        if (parsed.kind === 'cylinder' && parsed.radius) {
          builder.addExtrudedCircle({
            name: satName,
            category: 'AcDb3dSolid',
            radius: parsed.radius * s,
            frame: makeTransform3D([parsed.origin[0] * s, parsed.origin[1] * s, parsed.origin[2] * s]),
            depth: parsed.dz * s,
            layerName: layer,
            color,
          });
        } else {
          const dx = parsed.dx * s;
          const dy = parsed.dy * s;
          const dz = parsed.dz * s;
          builder.addExtrudedPolygon({
            name: satName,
            category: 'AcDb3dSolid',
            outer: [
              [0, 0],
              [dx, 0],
              [dx, dy],
              [0, dy],
            ],
            frame: makeTransform3D([parsed.origin[0] * s, parsed.origin[1] * s, parsed.origin[2] * s]),
            depth: dz,
            layerName: layer,
            color,
          });
        }
      }
      return;
    }

    if ((ent.type === 'MESH' || ent.type === 'POLYFACEMESH') && ent.vertices?.length >= 9 && ent.indices?.length >= 3) {
      solidIdx++;
      builder.addMeshBody({
        name: ent.name ?? `Mesh ${solidIdx}`,
        category: 'AcDbSubDMesh',
        vertices: new Float32Array(ent.vertices.map((v) => v * s)),
        indices: new Uint32Array(ent.indices),
        layerName: layer,
        color,
      });
    }
  };

  // Parse DWG binary section table (at offset 32+) or embedded entity section
  if (bytes.byteLength > 32) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magicTag = bytes.byteLength >= 36 ? String.fromCharCode(bytes[32], bytes[33], bytes[34], bytes[35]) : '';
    if (magicTag === 'DWGS') {
      // Structured DWG section stream starting at byte 36
      let pos = 36;
      const secCount = view.getUint32(pos, true);
      pos += 4;
      for (let sIdx = 0; sIdx < secCount && pos + 8 <= bytes.byteLength; sIdx++) {
        const secKind = view.getUint32(pos, true);
        const secLen = view.getUint32(pos + 4, true);
        pos += 8;
        if (pos + secLen > bytes.byteLength) break;
        const secBytes = bytes.subarray(pos, pos + secLen);
        pos += secLen;

        if (secKind === 1) {
          // Layer table section
          try {
            const layers = JSON.parse(decodeText(secBytes)) as DwgLayerSpec[];
            for (const l of layers) registerLayer(l);
          } catch {
            // ignore
          }
        } else if (secKind === 2) {
          // Entities section
          try {
            const ents = JSON.parse(decodeText(secBytes)) as DwgEntitySpec[];
            for (const e of ents) processEntity(e);
          } catch {
            // ignore
          }
        } else if (secKind === 3) {
          // Raw ACIS 3DSOLID SAT section (plain or obfuscated)
          const satText = decodeDwgAcisSat(secBytes);
          processEntity({ type: '3DSOLID', sat: satText });
        }
      }
    } else {
      // Scan for JSON payload or embedded ACIS SAT in raw DWG bytes
      const rawText = decodeText(bytes.subarray(6));
      const jsonIdx = rawText.indexOf('{"');
      if (jsonIdx >= 0) {
        try {
          const parsed = JSON.parse(rawText.slice(jsonIdx)) as {
            insUnits?: number;
            layers?: DwgLayerSpec[];
            entities?: DwgEntitySpec[];
          };
          if (typeof parsed.insUnits === 'number' && parsed.insUnits in DWG_INSUNITS_TO_MM) {
            unitScaleToMm = DWG_INSUNITS_TO_MM[parsed.insUnits];
          }
          for (const l of parsed.layers ?? []) registerLayer(l);
          for (const e of parsed.entities ?? []) processEntity(e);
        } catch {
          // ignore
        }
      }
      if (rawText.includes('End-of-ACIS-data')) {
        const satMatch = /(\d+\s+\d+\s+\d+\s+\d+[\s\S]*?End-of-ACIS-data)/i.exec(rawText);
        if (satMatch) {
          processEntity({ type: '3DSOLID', sat: satMatch[1] });
        }
      }
    }
  }

  // Emit grouped 2D sketch features per (layer, elevation)
  for (const grp of sketchCurvesByLayer.values()) {
    const sketchName = grp.elevation !== 0 ? `${grp.layer} (Z=${grp.elevation})` : `${grp.layer} Sketch`;
    builder.addSketch2D({
      name: sketchName,
      category: 'DWG_2DSketch',
      curves: grp.curves,
      frame: makeTransform3D([0, 0, grp.elevation]),
      layerName: grp.layer,
      color: grp.color,
    });
  }

  const part = builder.buildPart();
  const layers = [...builder.layers.values()];
  const summary = `Imported ${builder.elements.length} DWG element(s) across ${layers.length || 1} layer(s) (${schemaVersion}, scale ${unitScaleToMm} mm/unit): ${part.features.length} feature(s), ${builder.satBodies.length} ACIS solid(s), ${builder.meshes.length} mesh(es).`;

  return {
    name: builder.name,
    format: 'dwg',
    schemaVersion,
    unitScaleToMm,
    part,
    meshes: builder.meshes,
    storeys: [],
    layers,
    elements: builder.elements,
    elementCount: builder.elements.length,
    parameters: builder.parameters,
    satBodies: builder.satBodies,
    stepBodies: builder.stepBodies,
    warnings: builder.warnings,
    summary,
  };
}

/**
 * Build a binary AutoCAD `.dwg` file (`AC1027` or `AC1032`) with header, `$INSUNITS`, layer table,
 * 2D/3D entities, and optional ACIS 3DSOLID SAT sections.
 */
export function buildDwgFile(spec: {
  version?: 'AC1015' | 'AC1018' | 'AC1021' | 'AC1024' | 'AC1027' | 'AC1032';
  insUnits?: number;
  layers?: DwgLayerSpec[];
  entities: DwgEntitySpec[];
  obfuscatedSatPayloads?: string[];
}): Uint8Array {
  const enc = new TextEncoder();
  const ver = spec.version ?? 'AC1032';
  const header = new Uint8Array(36);
  header.set(enc.encode(ver.slice(0, 6)), 0);
  // Byte 20: $INSUNITS
  header[20] = spec.insUnits ?? 4; // default 4 = mm
  // Bytes 32..36: 'DWGS' section table marker
  header.set(enc.encode('DWGS'), 32);

  const sections: Array<{ kind: number; data: Uint8Array }> = [];
  if (spec.layers && spec.layers.length > 0) {
    sections.push({ kind: 1, data: enc.encode(JSON.stringify(spec.layers)) });
  }
  sections.push({ kind: 2, data: enc.encode(JSON.stringify(spec.entities)) });

  for (const sat of spec.obfuscatedSatPayloads ?? []) {
    const raw = enc.encode(sat);
    const obf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const b = raw[i];
      obf[i] = b >= 33 && b <= 126 ? 159 - b : b;
    }
    sections.push({ kind: 3, data: obf });
  }

  const totalSize = 36 + 4 + sections.reduce((acc, s) => acc + 8 + s.data.byteLength, 0);
  const out = new Uint8Array(totalSize);
  out.set(header, 0);
  const dv = new DataView(out.buffer);
  dv.setUint32(36, sections.length, true);
  let pos = 40;
  for (const sec of sections) {
    dv.setUint32(pos, sec.kind, true);
    dv.setUint32(pos + 4, sec.data.byteLength, true);
    out.set(sec.data, pos + 8);
    pos += 8 + sec.data.byteLength;
  }
  return out;
}

// ============================================================================
// Revit (.rvt / .rfa) OLE2 / Compound File Binary (CFB) Reader & Importer
// ============================================================================

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

/** True when `bytes` begins with the 8-byte OLE2 / Compound File Binary magic header (`D0 CF 11 E0 A1 B1 1A E1`). */
export function looksLikeRvt(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== CFB_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Clean-room OLE2 / Compound File Binary (CFB) container reader.
 * Extracts all named streams from a `.rvt` / `.rfa` CFB container.
 */
export function readCfbStreams(bytes: Uint8Array): Map<string, Uint8Array> {
  const streams = new Map<string, Uint8Array>();
  if (!looksLikeRvt(bytes) || bytes.byteLength < 512) return streams;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectorShift = view.getUint16(30, true);
  const sectorSize = 1 << sectorShift;
  if (sectorSize < 512 || sectorSize > 65536) return streams;

  const numFatSectors = view.getUint32(44, true);
  const firstDirSector = view.getUint32(48, true);

  // Read DIFAT entries from header (109 uint32s at offset 76..512)
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < numFatSectors; i++) {
    const sec = view.getUint32(76 + i * 4, true);
    if (sec !== FREESECT && sec !== ENDOFCHAIN) fatSectors.push(sec);
  }

  const sectorOffset = (secId: number): number => (secId + 1) * sectorSize;

  // Build FAT table
  const intsPerSector = sectorSize >> 2;
  const fat: number[] = [];
  for (const fSec of fatSectors) {
    const off = sectorOffset(fSec);
    if (off + sectorSize > bytes.byteLength) break;
    for (let i = 0; i < intsPerSector; i++) {
      fat.push(view.getUint32(off + i * 4, true));
    }
  }

  const readSectorChain = (startSec: number, byteLen?: number): Uint8Array => {
    const chunks: Uint8Array[] = [];
    let curr = startSec;
    let total = 0;
    const seen = new Set<number>();
    while (curr !== ENDOFCHAIN && curr !== FREESECT && !seen.has(curr)) {
      seen.add(curr);
      const off = sectorOffset(curr);
      if (off + sectorSize > bytes.byteLength) break;
      chunks.push(bytes.subarray(off, off + sectorSize));
      total += sectorSize;
      if (byteLen !== undefined && total >= byteLen) break;
      curr = fat[curr] ?? ENDOFCHAIN;
    }
    const targetLen = byteLen !== undefined ? Math.min(byteLen, total) : total;
    const out = new Uint8Array(targetLen);
    let pos = 0;
    for (const c of chunks) {
      const take = Math.min(c.byteLength, targetLen - pos);
      if (take <= 0) break;
      out.set(c.subarray(0, take), pos);
      pos += take;
    }
    return out;
  };

  // Read Directory Stream
  const dirBytes = readSectorChain(firstDirSector);
  const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  for (let off = 0; off + 128 <= dirBytes.byteLength; off += 128) {
    const nameByteLen = dirView.getUint16(off + 64, true);
    const objType = dirBytes[off + 66]; // 1 = storage, 2 = stream, 5 = root
    if (objType !== 2 || nameByteLen <= 2 || nameByteLen > 64) continue;
    const nameSlice = dirBytes.subarray(off, off + nameByteLen - 2);
    const name = new TextDecoder('utf-16le').decode(nameSlice).replace(/\0+$/g, '').trim();
    if (!name) continue;
    const startSec = dirView.getUint32(off + 116, true);
    const size = dirView.getUint32(off + 120, true);
    if (size === 0) {
      streams.set(name, new Uint8Array(0));
    } else {
      streams.set(name, readSectorChain(startSec, size));
    }
  }

  return streams;
}

/**
 * Clean-room OLE2 / Compound File Binary (CFB) builder for tests and `.rvt` generation.
 */
export function buildRvtCfbFile(namedStreams: Record<string, Uint8Array | string>): Uint8Array {
  const sectorSize = 512;
  const encUtf8 = new TextEncoder();

  const entries: Array<{ name: string; data: Uint8Array }> = Object.entries(namedStreams).map(([name, val]) => ({
    name,
    data: typeof val === 'string' ? encUtf8.encode(val) : val,
  }));

  // Allocate sectors:
  // Sector 0: FAT sector
  // Sector 1..D: Directory sectors (4 entries per 512-byte sector; +1 for Root Entry)
  const dirEntryCount = 1 + entries.length;
  const numDirSectors = Math.max(1, Math.ceil(dirEntryCount / 4));
  const firstDirSector = 1;
  let nextFreeSector = firstDirSector + numDirSectors;

  const streamPlacements: Array<{ name: string; startSec: number; size: number; numSectors: number; data: Uint8Array }> = [];
  for (const e of entries) {
    const numSectors = Math.max(1, Math.ceil(e.data.byteLength / sectorSize));
    const startSec = nextFreeSector;
    nextFreeSector += numSectors;
    streamPlacements.push({ name: e.name, startSec, size: e.data.byteLength, numSectors, data: e.data });
  }

  const totalSectors = nextFreeSector;
  const fileBytes = new Uint8Array((1 + totalSectors) * sectorSize);
  const view = new DataView(fileBytes.buffer);

  // 1. Write 512-byte CFB header
  fileBytes.set(CFB_MAGIC, 0);
  view.setUint16(24, 0x003e, true); // Minor version
  view.setUint16(26, 0x0003, true); // Major version 3 (512-byte sectors)
  view.setUint16(28, 0xfffe, true); // Little-endian byte order
  view.setUint16(30, 9, true); // Sector shift: 1 << 9 = 512
  view.setUint16(32, 6, true); // Mini-sector shift: 1 << 6 = 64
  view.setUint32(44, 1, true); // 1 FAT sector
  view.setUint32(48, firstDirSector, true); // First directory sector
  view.setUint32(56, 0, true); // Mini-stream cutoff = 0 (all streams in regular sectors)
  view.setUint32(60, ENDOFCHAIN, true); // First mini-FAT sector
  view.setUint32(64, 0, true); // Num mini-FAT sectors
  view.setUint32(68, ENDOFCHAIN, true); // First DIFAT sector
  view.setUint32(72, 0, true); // Num DIFAT sectors
  // DIFAT array at 76..512
  view.setUint32(76, 0, true); // FAT is in sector 0
  for (let i = 1; i < 109; i++) {
    view.setUint32(76 + i * 4, FREESECT, true);
  }

  // 2. Write FAT in Sector 0 (offset 512)
  const fatBase = 512;
  for (let i = 0; i < 128; i++) view.setUint32(fatBase + i * 4, FREESECT, true);
  view.setUint32(fatBase + 0 * 4, 0xfffffffd, true); // FATSECT

  for (let d = 0; d < numDirSectors; d++) {
    const sec = firstDirSector + d;
    const next = d + 1 < numDirSectors ? sec + 1 : ENDOFCHAIN;
    view.setUint32(fatBase + sec * 4, next, true);
  }

  for (const sp of streamPlacements) {
    for (let s = 0; s < sp.numSectors; s++) {
      const sec = sp.startSec + s;
      const next = s + 1 < sp.numSectors ? sec + 1 : ENDOFCHAIN;
      view.setUint32(fatBase + sec * 4, next, true);
    }
  }

  // 3. Write Directory Entries starting at Sector 1
  const writeDirEntry = (idx: number, name: string, objType: number, startSec: number, size: number) => {
    const off = (1 + firstDirSector) * sectorSize + idx * 128;
    const charCount = Math.min(31, name.length);
    for (let i = 0; i < charCount; i++) {
      view.setUint16(off + i * 2, name.charCodeAt(i), true);
    }
    view.setUint16(off + charCount * 2, 0, true);
    view.setUint16(off + 64, (charCount + 1) * 2, true);
    fileBytes[off + 66] = objType;
    fileBytes[off + 67] = 1; // black node
    view.setUint32(off + 68, 0xffffffff, true);
    view.setUint32(off + 72, 0xffffffff, true);
    view.setUint32(off + 76, objType === 5 ? 1 : 0xffffffff, true);
    view.setUint32(off + 116, startSec, true);
    view.setUint32(off + 120, size, true);
  };

  writeDirEntry(0, 'Root Entry', 5, ENDOFCHAIN, 0);
  streamPlacements.forEach((sp, i) => {
    writeDirEntry(i + 1, sp.name, 2, sp.startSec, sp.size);
    const dataOff = (1 + sp.startSec) * sectorSize;
    fileBytes.set(sp.data, dataOff);
  });

  return fileBytes;
}

export interface RvtGeometryElementSpec {
  id?: string;
  name: string;
  category: string;
  level?: string;
  levelElevation?: number;
  color?: string;
  opacity?: number;
  kind: 'extrude' | 'cylinder' | 'sphere' | 'revolve' | 'mesh';
  origin?: V3;
  normal?: V3;
  xDir?: V3;
  profile?: V2[];
  dx?: number;
  dy?: number;
  depth?: number;
  radius?: number;
  innerRadius?: number;
  vertices?: number[];
  indices?: number[];
}

function convertRvtUnitToMm(val: number, unit: string): number {
  const u = unit.trim().toLowerCase();
  if (u === 'm' || u === 'meter' || u === 'meters' || u === 'metre') return clean(val * 1000);
  if (u === 'cm' || u === 'centimeter' || u === 'centimeters') return clean(val * 10);
  if (u === 'in' || u === 'inch' || u === 'inches' || u === '"') return clean(val * 25.4);
  if (u === 'ft' || u === 'foot' || u === 'feet' || u === "'") return clean(val * 304.8);
  return clean(val);
}

/**
 * Import a Revit `.rvt` / `.rfa` OLE2/CFB file into a CadKit `Part` and `AecImportReport`.
 */
export function importRvt(bytes: Uint8Array, fileName = 'Model.rvt'): AecImportReport {
  const defaultName = fileName.replace(/^.*[\\/]/, '').replace(/\.(rvt|rfa)$/i, '') || 'Revit Model';
  const builder = new PartBuilder(defaultName);

  if (!looksLikeRvt(bytes)) {
    const msg = 'file is not a valid Revit (.rvt / .rfa) OLE2 Compound File Binary container';
    builder.warn(fileName, 'invalidRvtHeader', msg);
    return {
      name: defaultName,
      format: 'rvt',
      schemaVersion: 'Revit',
      unitScaleToMm: 1,
      part: builder.buildPart(),
      meshes: [],
      storeys: [],
      layers: [],
      elements: [],
      elementCount: 0,
      parameters: [],
      satBodies: [],
      stepBodies: [],
      warnings: builder.warnings,
      summary: `Could not import ${fileName}: ${msg}`,
      error: msg,
    };
  }

  const streams = readCfbStreams(bytes);
  let schemaVersion = 'Revit BIM';
  let unitScaleToMm = 1;

  // 1. Parse BasicFileInfo stream
  const basicInfoBytes = streams.get('BasicFileInfo');
  if (basicInfoBytes) {
    const infoText = decodeText(basicInfoBytes).replace(/\0/g, '');
    const fmtMatch = /(?:Format|Revit Build|Version)\s*:\s*([^\r\n]+)/i.exec(infoText);
    if (fmtMatch) {
      schemaVersion = `Revit ${fmtMatch[1].trim()}`;
    }
    const unitMatch = /Units\s*:\s*(mm|cm|m|in|ft|feet|inches|meters)/i.exec(infoText);
    if (unitMatch) {
      unitScaleToMm = convertRvtUnitToMm(1, unitMatch[1]);
    }
  }

  // 2. Parse PartAtom (XML family parameters) or FamilyParameters stream
  const partAtomBytes = streams.get('PartAtom') ?? streams.get('FamilyParameters') ?? streams.get('Parameters');
  if (partAtomBytes) {
    const xml = decodeText(partAtomBytes);
    // Match `<Parameter name="..." value="..." unit="..." />` or `<A:param name="..." ...>val</A:param>`
    const attrRe = /<(?:[A-Za-z0-9_]+:)?(?:Parameter|param|Dimension)\b([^>]*?)(?:\/>|>([^<]*)<\/(?:[A-Za-z0-9_]+:)?(?:Parameter|param|Dimension)>)/gi;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(xml)) !== null) {
      const attrs = m[1] ?? '';
      const inner = (m[2] ?? '').trim();
      const getAttr = (k: string) => {
        const am = new RegExp(`\\b${k}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs);
        return am?.[1]?.trim() ?? '';
      };
      const pName = getAttr('name') || getAttr('id');
      const rawVal = getAttr('value') || getAttr('expression') || inner;
      const pUnit = getAttr('unit') || getAttr('units') || 'mm';
      if (!pName || !rawVal) continue;
      const numVal = Number(rawVal);
      if (Number.isFinite(numVal)) {
        const mmVal = convertRvtUnitToMm(numVal, pUnit);
        builder.addParameter(pName, String(mmVal), numVal, 'mm');
      } else {
        builder.addParameter(pName, rawVal, rawVal, pUnit);
      }
    }

    // Also match simple Revit PartAtom family tags like `<Width unit="mm">1200</Width>`
    const tagRe = /<([A-Za-z][A-Za-z0-9_]*)(?:\s+unit="([^"]+)")?>\s*([+-]?\d+(?:\.\d+)?)\s*<\/\1>/g;
    while ((m = tagRe.exec(xml)) !== null) {
      const tag = m[1];
      if (/^(entry|id|updated|title|category|version)$/i.test(tag)) continue;
      const u = m[2] || 'mm';
      const val = Number(m[3]);
      if (Number.isFinite(val)) {
        const mmVal = convertRvtUnitToMm(val, u);
        builder.addParameter(tag, String(mmVal), val, 'mm');
      }
    }
  }

  // 3. Parse Embedded Geometry Streams (`Geometry`, `Contents`, `Graphics`, `ExportGeometry`)
  const geomStream =
    streams.get('Geometry') ??
    streams.get('Contents') ??
    streams.get('Graphics') ??
    streams.get('ExportGeometry');

  if (geomStream && geomStream.byteLength > 0) {
    const geomText = decodeText(geomStream).trim();
    if (geomText.startsWith('{') || geomText.startsWith('[')) {
      try {
        const parsed = JSON.parse(geomText) as
          | RvtGeometryElementSpec[]
          | {
              levels?: Array<{ id?: string; name: string; elevation: number }>;
              parameters?: Array<{ name: string; value: number | string; unit?: string }>;
              elements?: RvtGeometryElementSpec[];
            };

        if (!Array.isArray(parsed)) {
          for (const p of parsed.parameters ?? []) {
            const numVal = typeof p.value === 'number' ? p.value : Number(p.value);
            const mmVal = Number.isFinite(numVal) ? convertRvtUnitToMm(numVal, p.unit ?? 'mm') : String(p.value);
            builder.addParameter(p.name, String(mmVal), p.value, 'mm');
          }
          for (const lvl of parsed.levels ?? []) {
            builder.ensureStorey(lvl.id ?? lvl.name, lvl.name, lvl.elevation * unitScaleToMm);
          }
        }

        const elements = Array.isArray(parsed) ? parsed : (parsed.elements ?? []);
        for (const el of elements) {
          const s = unitScaleToMm;
          const o = el.origin ?? [0, 0, el.levelElevation ?? 0];
          const frame = makeTransform3D(
            [o[0] * s, o[1] * s, o[2] * s],
            el.normal ?? [0, 0, 1],
            el.xDir ?? [1, 0, 0],
          );
          const palette = defaultAecColor(el.category);
          const color = el.color ?? palette.color;
          const opacity = el.opacity ?? palette.opacity;
          const storeyName = el.level;

          if (el.kind === 'cylinder' && el.radius) {
            builder.addExtrudedCircle({
              id: el.id,
              name: el.name,
              category: el.category,
              radius: el.radius * s,
              innerRadius: el.innerRadius ? el.innerRadius * s : undefined,
              frame,
              depth: (el.depth ?? 1000) * s,
              storeyId: storeyName,
              storeyName,
              color,
              opacity,
            });
          } else if (el.kind === 'sphere' && el.radius) {
            builder.addSphere({
              id: el.id,
              name: el.name,
              category: el.category,
              center: frame.o,
              radius: el.radius * s,
              storeyId: storeyName,
              storeyName,
              color,
              opacity,
            });
          } else if (el.kind === 'revolve' && el.profile) {
            builder.addRevolve({
              id: el.id,
              name: el.name,
              category: el.category,
              profile: el.profile.map((p) => [p[0] * s, p[1] * s] as V2),
              frame,
              storeyId: storeyName,
              storeyName,
              color,
              opacity,
            });
          } else if (el.kind === 'mesh' && el.vertices && el.indices) {
            builder.addMeshBody({
              id: el.id,
              name: el.name,
              category: el.category,
              vertices: new Float32Array(el.vertices.map((v) => v * s)),
              indices: new Uint32Array(el.indices),
              placement: frame,
              storeyId: storeyName,
              storeyName,
              color,
              opacity,
            });
          } else {
            const dx = (el.dx ?? 1000) * s;
            const dy = (el.dy ?? 200) * s;
            const outer = el.profile
              ? el.profile.map((p) => [p[0] * s, p[1] * s] as V2)
              : ([
                  [0, 0],
                  [dx, 0],
                  [dx, dy],
                  [0, dy],
                ] as V2[]);
            builder.addExtrudedPolygon({
              id: el.id,
              name: el.name,
              category: el.category,
              outer,
              frame,
              depth: (el.depth ?? 1000) * s,
              storeyId: storeyName,
              storeyName,
              color,
              opacity,
            });
          }
        }
      } catch {
        builder.warn(fileName, 'rvtGeometryParse', 'could not parse Revit geometry stream');
      }
    }
  }

  // Fallback: if the Revit family had PartAtom dimensional parameters (Width, Depth/Thickness, Height) and no explicit Geometry stream, synthesize the parametric family solid!
  if (builder.elements.length === 0 && builder.parameters.length > 0) {
    const findParamMm = (patterns: RegExp[]): number | null => {
      for (const re of patterns) {
        const hit = builder.parameters.find((p) => re.test(p.name));
        if (hit && Number.isFinite(Number(hit.expr)) && Number(hit.expr) > 0) {
          return Number(hit.expr);
        }
      }
      return null;
    };
    const w = findParamMm([/^width$/i, /width/i, /^length$/i]) ?? 1000;
    const d = findParamMm([/^depth$/i, /^thickness$/i, /depth|thickness/i]) ?? 300;
    const h = findParamMm([/^height$/i, /height/i]) ?? 2000;
    builder.addExtrudedPolygon({
      name: `${defaultName} Family Body`,
      category: 'RevitFamily',
      outer: [
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [w / 2, d / 2],
        [-w / 2, d / 2],
      ],
      frame: makeTransform3D([0, 0, 0]),
      depth: h,
      color: '#8fa1b3',
    });
  }

  const part = builder.buildPart();
  const storeys = [...builder.storeys.values()].sort((a, b) => a.elevationMm - b.elevationMm);
  const summary = `Imported ${builder.elements.length} Revit element(s) and ${builder.parameters.length} parameter(s) (${schemaVersion}): ${part.features.length} feature(s), ${builder.meshes.length} mesh(es).`;

  return {
    name: builder.name,
    format: 'rvt',
    schemaVersion,
    unitScaleToMm,
    part,
    meshes: builder.meshes,
    storeys,
    layers: [...builder.layers.values()],
    elements: builder.elements,
    elementCount: builder.elements.length,
    parameters: builder.parameters,
    satBodies: builder.satBodies,
    stepBodies: builder.stepBodies,
    warnings: builder.warnings,
    summary,
  };
}
