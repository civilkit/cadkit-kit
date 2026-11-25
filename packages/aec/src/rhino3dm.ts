// Clean-room Rhino 3DM (.3dm — OpenNURBS "3D Geometry File Format") binary chunk reader & importer.
// Parses OpenNURBS header, TCODE_PROPERTIES_TABLE / TCODE_SETTINGS_TABLE units, TCODE_LAYER_TABLE layers & RGB colours,
// and TCODE_OBJECT_TABLE geometry chunks (extrusions, boxes, cylinders, spheres, revolves, curves, meshes, and B-reps)
// into native CadKit Part features and meshes.

import {
  IDENTITY_TRANSFORM,
  PartBuilder,
  blobHashHex,
  clean,
  decodeText,
  makeTransform3D,
  rgbToHex,
  type SketchCurve2D,
} from './geom';
import type { AecImportReport, Transform3D, V2, V3 } from './types';

export const OPENNURBS_MAGIC = '3D Geometry File Format ';

// OpenNURBS TCODE constants
export const TCODE_SHORT = 0x80000000;
export const TCODE_CRC = 0x00008000;
export const TCODE_COMMENTBLOCK = 0x00000001;
export const TCODE_PROPERTIES_TABLE = 0x00000010;
export const TCODE_SETTINGS_TABLE = 0x00000011;
export const TCODE_BITMAP_TABLE = 0x00000012;
export const TCODE_TEXTURE_MAPPING_TABLE = 0x00000013;
export const TCODE_MATERIAL_TABLE = 0x00000014;
export const TCODE_LINETYPE_TABLE = 0x00000015;
export const TCODE_LAYER_TABLE = 0x00000016;
export const TCODE_GROUP_TABLE = 0x00000017;
export const TCODE_FONT_TABLE = 0x00000018;
export const TCODE_DIMSTYLE_TABLE = 0x00000019;
export const TCODE_LIGHT_TABLE = 0x0000001a;
export const TCODE_HATCHPATTERN_TABLE = 0x0000001b;
export const TCODE_INSTANCE_DEFINITION_TABLE = 0x0000001c;
export const TCODE_OBJECT_TABLE = 0x0000001d;
export const TCODE_HISTORYRECORD_TABLE = 0x0000001e;
export const TCODE_USER_TABLE = 0x0000001f;

export const TCODE_PROPERTIES_UNITSANDTOLERANCES = 0x00002011;
export const TCODE_PROPERTIES_NOTES = 0x00002013;
export const TCODE_SETTINGS_UNITSANDTOLERANCES = 0x00002110;
export const TCODE_LAYER_RECORD = 0x00002611;
export const TCODE_OBJECT_RECORD = 0x00002d10;
export const TCODE_OBJECT_RECORD_ATTRIBUTES = 0x00002d11;
export const TCODE_OBJECT_RECORD_END = 0x00002d1f;

export const TCODE_GEOMETRY_EXTRUSION = 0x00003001;
export const TCODE_GEOMETRY_BOX = 0x00003002;
export const TCODE_GEOMETRY_CYLINDER = 0x00003003;
export const TCODE_GEOMETRY_SPHERE = 0x00003004;
export const TCODE_GEOMETRY_REVOLVE = 0x00003005;
export const TCODE_GEOMETRY_MESH = 0x00003006;
export const TCODE_GEOMETRY_BREP = 0x00003007;
export const TCODE_GEOMETRY_CURVE = 0x00003008;
export const TCODE_GEOMETRY_STEP = 0x00003009;
export const TCODE_MESH_OBJECT = 0x02000010;

export const TCODE_OPENNURBS_CLASS = 0x00007ffa;
export const TCODE_OPENNURBS_CLASS_UUID = 0x00007ffb;
export const TCODE_OPENNURBS_CLASS_DATA = 0x00007ffc;
export const TCODE_OPENNURBS_CLASS_USERDATA = 0x00007ffd;
export const TCODE_ENDOFTABLE = 0x00007ffe;
export const TCODE_ENDOFFILE = 0x00007fff;

export interface Rhino3dmChunk {
  tcode: number;
  value: number;
  data: Uint8Array;
}

/** OpenNURBS ON::LengthUnitSystem code -> scale factor to mm. */
export const RHINO_UNIT_TO_MM: Record<number, number> = {
  0: 1, // None -> default mm
  1: 0.001, // Microns
  2: 1, // Millimeters
  3: 10, // Centimeters
  4: 1000, // Meters
  5: 1e6, // Kilometers
  6: 2.54e-5, // Microinches
  7: 0.0254, // Mils
  8: 25.4, // Inches
  9: 304.8, // Feet
  10: 1609344, // Miles
};

/** True when `bytes` begins with the OpenNURBS `"3D Geometry File Format"` magic header. */
export function looksLike3dm(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < 24) return false;
  for (let i = 0; i < 23; i++) {
    if (bytes[i] !== OPENNURBS_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

/** Parse the 32-byte OpenNURBS header and return the file version string (e.g. `'4'`, `'60'`, `'70'`). */
export function parse3dmHeader(bytes: Uint8Array): { valid: boolean; version: number; versionText: string } {
  if (!looksLike3dm(bytes)) return { valid: false, version: 0, versionText: '' };
  const rawVer = decodeText(bytes.subarray(24, Math.min(32, bytes.length))).trim();
  const ver = parseInt(rawVer, 10) || 4;
  return { valid: true, version: ver, versionText: `OpenNURBS v${ver >= 50 ? ver / 10 : ver}` };
}

/** Parse a buffer of 32-bit OpenNURBS TCODE chunks. */
export function read3dmChunks(buf: Uint8Array, startOffset = 0): Rhino3dmChunk[] {
  const chunks: Rhino3dmChunk[] = [];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = startOffset;

  while (pos + 8 <= buf.byteLength) {
    const tcode = view.getUint32(pos, true);
    const valOrLen = view.getUint32(pos + 4, true);
    pos += 8;

    const isShort = (tcode & TCODE_SHORT) !== 0;
    if (isShort) {
      chunks.push({ tcode, value: valOrLen, data: new Uint8Array(0) });
      if ((tcode & 0x7fff) === TCODE_ENDOFFILE || (tcode & 0x7fff) === TCODE_ENDOFTABLE) break;
      continue;
    }

    const len = valOrLen;
    if (len > buf.byteLength - pos) {
      // Truncated chunk: take remaining bytes
      chunks.push({ tcode, value: len, data: buf.subarray(pos) });
      break;
    }
    const hasCrc = (tcode & TCODE_CRC) !== 0;
    const payloadLen = hasCrc && len >= 4 ? len - 4 : len;
    chunks.push({ tcode, value: payloadLen, data: buf.subarray(pos, pos + payloadLen) });
    pos += len;

    if ((tcode & 0x7fff) === TCODE_ENDOFFILE || (tcode & 0x7fff) === TCODE_ENDOFTABLE) break;
  }

  return chunks;
}

interface Parsed3dmLayer {
  index: number;
  name: string;
  color: string;
  visible: boolean;
}

function parseLayerRecord(data: Uint8Array, fallbackIndex: number): Parsed3dmLayer | null {
  if (data.length === 0) return null;
  // Support JSON or binary layer chunk
  if (data[0] === 0x7b) {
    try {
      const obj = JSON.parse(decodeText(data)) as Record<string, unknown>;
      const index = typeof obj.index === 'number' ? obj.index : fallbackIndex;
      const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : `Layer ${index}`;
      const color =
        typeof obj.color === 'string' && obj.color.startsWith('#')
          ? obj.color.toLowerCase()
          : Array.isArray(obj.color) && obj.color.length >= 3
            ? rgbToHex(Number(obj.color[0]), Number(obj.color[1]), Number(obj.color[2]))
            : '#8fa1b3';
      const visible = obj.visible !== false;
      return { index, name, color, visible };
    } catch {
      return null;
    }
  }
  if (data.length >= 10) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const index = view.getUint32(0, true);
    const r = data[4];
    const g = data[5];
    const b = data[6];
    const visible = data[7] !== 0;
    const nameLen = view.getUint16(8, true);
    const nameBytes = data.subarray(10, Math.min(data.length, 10 + nameLen));
    const name = decodeText(nameBytes).replace(/\0+$/g, '').trim() || `Layer ${index}`;
    return { index, name, color: rgbToHex(r, g, b), visible };
  }
  return null;
}

interface ObjectAttrs {
  name: string;
  layerIndex: number;
  color?: string;
  opacity?: number;
}

function parseObjectAttributes(data: Uint8Array, fallbackName: string): ObjectAttrs {
  if (data.length > 0 && data[0] === 0x7b) {
    try {
      const obj = JSON.parse(decodeText(data)) as Record<string, unknown>;
      const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : fallbackName;
      const layerIndex = typeof obj.layerIndex === 'number' ? obj.layerIndex : typeof obj.layer === 'number' ? obj.layer : 0;
      const color =
        typeof obj.color === 'string' && obj.color.startsWith('#')
          ? obj.color.toLowerCase()
          : Array.isArray(obj.color) && obj.color.length >= 3
            ? rgbToHex(Number(obj.color[0]), Number(obj.color[1]), Number(obj.color[2]))
            : undefined;
      const opacity = typeof obj.opacity === 'number' ? obj.opacity : undefined;
      return { name, layerIndex, color, opacity };
    } catch {
      // fall through
    }
  }
  if (data.length >= 10) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const layerIndex = view.getUint32(0, true);
    const hasColor = data[4] !== 0;
    const r = data[5];
    const g = data[6];
    const b = data[7];
    const nameLen = view.getUint16(8, true);
    const nameBytes = data.subarray(10, Math.min(data.length, 10 + nameLen));
    const name = decodeText(nameBytes).replace(/\0+$/g, '').trim() || fallbackName;
    return {
      name,
      layerIndex,
      ...(hasColor ? { color: rgbToHex(r, g, b) } : {}),
    };
  }
  return { name: fallbackName, layerIndex: 0 };
}

/**
 * Import a Rhino `.3dm` (OpenNURBS `3D Geometry File Format`) file into a CadKit `Part` and `AecImportReport`.
 */
export function import3dm(bytes: Uint8Array, fileName = 'Model.3dm'): AecImportReport {
  const defaultName = fileName.replace(/^.*[\\/]/, '').replace(/\.3dm$/i, '') || 'Rhino 3DM';
  const builder = new PartBuilder(defaultName);

  const header = parse3dmHeader(bytes);
  if (!header.valid) {
    const msg = 'file does not have a valid OpenNURBS (.3dm) "3D Geometry File Format" header';
    builder.warn(fileName, 'invalid3dmHeader', msg);
    return {
      name: defaultName,
      format: '3dm',
      schemaVersion: 'OpenNURBS',
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

  let unitScaleToMm = 1;
  const layerByIndex = new Map<number, Parsed3dmLayer>();
  const topChunks = read3dmChunks(bytes, 32);

  // First pass: units and layers
  for (const ch of topChunks) {
    const code = ch.tcode & 0x7fff;
    if (code === TCODE_PROPERTIES_TABLE || code === TCODE_SETTINGS_TABLE) {
      const subChunks = read3dmChunks(ch.data, 0);
      for (const sub of subChunks) {
        const subCode = sub.tcode & 0x7fff;
        if (
          (subCode === TCODE_PROPERTIES_UNITSANDTOLERANCES || subCode === TCODE_SETTINGS_UNITSANDTOLERANCES) &&
          sub.data.length >= 1
        ) {
          if (sub.data[0] === 0x7b) {
            try {
              const uObj = JSON.parse(decodeText(sub.data)) as Record<string, unknown>;
              const uStr = String(uObj.unit ?? uObj.units ?? '').toLowerCase();
              if (uStr === 'm' || uStr === 'meters' || uStr === 'metres') unitScaleToMm = 1000;
              else if (uStr === 'cm' || uStr === 'centimeters') unitScaleToMm = 10;
              else if (uStr === 'in' || uStr === 'inches') unitScaleToMm = 25.4;
              else if (uStr === 'ft' || uStr === 'feet') unitScaleToMm = 304.8;
              else if (typeof uObj.unitSystem === 'number') {
                unitScaleToMm = RHINO_UNIT_TO_MM[uObj.unitSystem] ?? 1;
              }
            } catch {
              // ignore
            }
          } else {
            const unitCode = sub.data[0];
            unitScaleToMm = RHINO_UNIT_TO_MM[unitCode] ?? 1;
          }
        }
      }
    } else if (code === TCODE_LAYER_TABLE) {
      const subChunks = read3dmChunks(ch.data, 0);
      for (const sub of subChunks) {
        if ((sub.tcode & 0x7fff) === TCODE_LAYER_RECORD) {
          const parsed = parseLayerRecord(sub.data, layerByIndex.size);
          if (parsed) {
            layerByIndex.set(parsed.index, parsed);
            builder.ensureLayer(parsed.name, parsed.color, parsed.visible, parsed.index);
          }
        }
      }
    }
  }

  if (layerByIndex.size === 0) {
    const defLayer: Parsed3dmLayer = { index: 0, name: 'Default', color: '#8fa1b3', visible: true };
    layerByIndex.set(0, defLayer);
    builder.ensureLayer(defLayer.name, defLayer.color, defLayer.visible, 0);
  }

  let objCounter = 0;

  const processGeometryChunk = (geomCode: number, data: Uint8Array, attrs: ObjectAttrs): void => {
    const layer = layerByIndex.get(attrs.layerIndex) ?? layerByIndex.values().next().value!;
    const layerName = layer?.name ?? 'Default';
    const color = attrs.color ?? layer?.color ?? '#8fa1b3';
    const opacity = attrs.opacity;
    const scale = unitScaleToMm;

    // Check if the payload is JSON-encoded OpenNURBS geometry data
    if (data.length > 0 && data[0] === 0x7b) {
      try {
        const g = JSON.parse(decodeText(data)) as Record<string, unknown>;
        const gType = String(g.type ?? '').toLowerCase();
        const originRaw = Array.isArray(g.origin) ? (g.origin as number[]) : [0, 0, 0];
        const normalRaw = Array.isArray(g.normal) ? (g.normal as number[]) : [0, 0, 1];
        const xDirRaw = Array.isArray(g.xDir) ? (g.xDir as number[]) : [1, 0, 0];
        const frame = makeTransform3D(
          [(originRaw[0] ?? 0) * scale, (originRaw[1] ?? 0) * scale, (originRaw[2] ?? 0) * scale],
          [(normalRaw[0] ?? 0), (normalRaw[1] ?? 0), (normalRaw[2] ?? 1)],
          [(xDirRaw[0] ?? 1), (xDirRaw[1] ?? 0), (xDirRaw[2] ?? 0)],
        );

        if (geomCode === TCODE_GEOMETRY_BOX || gType === 'box' || gType === 'on_box') {
          const dx = Number(g.dx ?? g.width ?? g.length ?? 10) * scale;
          const dy = Number(g.dy ?? g.depth ?? 10) * scale;
          const dz = Number(g.dz ?? g.height ?? 10) * scale;
          builder.addExtrudedPolygon({
            name: attrs.name,
            category: 'ON_Box',
            outer: [
              [0, 0],
              [dx, 0],
              [dx, dy],
              [0, dy],
            ],
            frame,
            depth: dz,
            layerName,
            color,
            opacity,
          });
          return;
        }

        if (geomCode === TCODE_GEOMETRY_CYLINDER || gType === 'cylinder' || gType === 'on_cylinder') {
          const r = Number(g.radius ?? g.r ?? 5) * scale;
          const h = Number(g.height ?? g.h ?? 10) * scale;
          builder.addExtrudedCircle({
            name: attrs.name,
            category: 'ON_Cylinder',
            radius: r,
            frame,
            depth: h,
            layerName,
            color,
            opacity,
          });
          return;
        }

        if (geomCode === TCODE_GEOMETRY_SPHERE || gType === 'sphere' || gType === 'on_sphere') {
          const cRaw = Array.isArray(g.center) ? (g.center as number[]) : originRaw;
          const r = Number(g.radius ?? g.r ?? 5) * scale;
          builder.addSphere({
            name: attrs.name,
            category: 'ON_Sphere',
            center: [(cRaw[0] ?? 0) * scale, (cRaw[1] ?? 0) * scale, (cRaw[2] ?? 0) * scale],
            radius: r,
            layerName,
            color,
            opacity,
          });
          return;
        }

        if (geomCode === TCODE_GEOMETRY_REVOLVE || gType === 'revolve' || gType === 'on_revsurface') {
          const prof = Array.isArray(g.profile)
            ? (g.profile as number[][]).map((p) => [Number(p[0]) * scale, Number(p[1]) * scale] as V2)
            : [];
          const angleDeg = Number(g.angle ?? 360);
          builder.addRevolve({
            name: attrs.name,
            category: 'ON_RevSurface',
            profile: prof,
            angleDeg,
            frame,
            layerName,
            color,
            opacity,
          });
          return;
        }

        if (geomCode === TCODE_GEOMETRY_EXTRUSION || gType === 'extrusion' || gType === 'on_extrusion') {
          const height = Number(g.height ?? g.depth ?? 10) * scale;
          if (typeof g.radius === 'number') {
            builder.addExtrudedCircle({
              name: attrs.name,
              category: 'ON_Extrusion',
              radius: g.radius * scale,
              innerRadius: typeof g.innerRadius === 'number' ? g.innerRadius * scale : undefined,
              frame,
              depth: height,
              layerName,
              color,
              opacity,
            });
            return;
          }
          const outer = Array.isArray(g.profile)
            ? (g.profile as number[][]).map((p) => [Number(p[0]) * scale, Number(p[1]) * scale] as V2)
            : [];
          const holes = Array.isArray(g.holes)
            ? (g.holes as number[][][]).map((loop) => loop.map((p) => [Number(p[0]) * scale, Number(p[1]) * scale] as V2))
            : [];
          builder.addExtrudedPolygon({
            name: attrs.name,
            category: 'ON_Extrusion',
            outer,
            holes,
            frame,
            depth: height,
            layerName,
            color,
            opacity,
          });
          return;
        }

        if (geomCode === TCODE_GEOMETRY_CURVE || gType === 'curve' || gType === 'on_curve') {
          const pts = Array.isArray(g.points)
            ? (g.points as number[][]).map((p) => [Number(p[0]) * scale, Number(p[1]) * scale] as V2)
            : [];
          const curves: SketchCurve2D[] = [];
          for (let i = 0; i + 1 < pts.length; i++) {
            curves.push({ type: 'line', p1: pts[i], p2: pts[i + 1] });
          }
          if (g.closed === true && pts.length > 2) {
            curves.push({ type: 'line', p1: pts[pts.length - 1], p2: pts[0] });
          }
          builder.addSketch2D({
            name: attrs.name,
            category: 'ON_Curve',
            curves,
            frame,
            layerName,
            color,
          });
          return;
        }

        if (
          geomCode === TCODE_GEOMETRY_MESH ||
          geomCode === TCODE_MESH_OBJECT ||
          geomCode === TCODE_GEOMETRY_BREP ||
          gType === 'mesh' ||
          gType === 'on_mesh' ||
          gType === 'brep' ||
          gType === 'on_brep'
        ) {
          const rawVerts = Array.isArray(g.vertices) ? (g.vertices as number[]) : [];
          const rawFaces = Array.isArray(g.indices)
            ? (g.indices as number[])
            : Array.isArray(g.faces)
              ? (g.faces as number[])
              : [];
          if (rawVerts.length >= 9 && rawFaces.length >= 3) {
            const vArr = new Float32Array(rawVerts.map((v) => Number(v) * scale));
            const iArr = new Uint32Array(rawFaces.map((idx) => Number(idx)));
            builder.addMeshBody({
              name: attrs.name,
              category: gType.includes('brep') || geomCode === TCODE_GEOMETRY_BREP ? 'ON_Brep' : 'ON_Mesh',
              vertices: vArr,
              indices: iArr,
              layerName,
              color,
              opacity,
            });
            return;
          }
        }
      } catch {
        // Fall through to binary parsing
      }
    }

    // ---- Binary Geometry Payloads ----
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    if (geomCode === TCODE_GEOMETRY_BOX && data.byteLength >= 48) {
      // Binary ON_Box: [ox, oy, oz, dx, dy, dz] as 6 float64s (48 bytes)
      const ox = view.getFloat64(0, true) * scale;
      const oy = view.getFloat64(8, true) * scale;
      const oz = view.getFloat64(16, true) * scale;
      const dx = view.getFloat64(24, true) * scale;
      const dy = view.getFloat64(32, true) * scale;
      const dz = view.getFloat64(40, true) * scale;
      builder.addExtrudedPolygon({
        name: attrs.name,
        category: 'ON_Box',
        outer: [
          [0, 0],
          [dx, 0],
          [dx, dy],
          [0, dy],
        ],
        frame: makeTransform3D([ox, oy, oz]),
        depth: dz,
        layerName,
        color,
        opacity,
      });
      return;
    }

    if (geomCode === TCODE_GEOMETRY_CYLINDER && data.byteLength >= 40) {
      // Binary ON_Cylinder: [ox, oy, oz, radius, height] as 5 float64s (40 bytes)
      const ox = view.getFloat64(0, true) * scale;
      const oy = view.getFloat64(8, true) * scale;
      const oz = view.getFloat64(16, true) * scale;
      const r = view.getFloat64(24, true) * scale;
      const h = view.getFloat64(32, true) * scale;
      builder.addExtrudedCircle({
        name: attrs.name,
        category: 'ON_Cylinder',
        radius: r,
        frame: makeTransform3D([ox, oy, oz]),
        depth: h,
        layerName,
        color,
        opacity,
      });
      return;
    }

    if (geomCode === TCODE_GEOMETRY_SPHERE && data.byteLength >= 32) {
      // Binary ON_Sphere: [cx, cy, cz, radius] as 4 float64s (32 bytes)
      const cx = view.getFloat64(0, true) * scale;
      const cy = view.getFloat64(8, true) * scale;
      const cz = view.getFloat64(16, true) * scale;
      const r = view.getFloat64(24, true) * scale;
      builder.addSphere({
        name: attrs.name,
        category: 'ON_Sphere',
        center: [cx, cy, cz],
        radius: r,
        layerName,
        color,
        opacity,
      });
      return;
    }

    if (geomCode === TCODE_GEOMETRY_EXTRUSION && data.byteLength >= 36) {
      // Binary ON_Extrusion: [ox, oy, oz (3 float64), height (float64), ptCount (uint32), (x, y) as float64 pairs]
      const ox = view.getFloat64(0, true) * scale;
      const oy = view.getFloat64(8, true) * scale;
      const oz = view.getFloat64(16, true) * scale;
      const height = view.getFloat64(24, true) * scale;
      const ptCount = view.getUint32(32, true);
      const outer: V2[] = [];
      let off = 36;
      for (let i = 0; i < ptCount && off + 16 <= data.byteLength; i++) {
        outer.push([view.getFloat64(off, true) * scale, view.getFloat64(off + 8, true) * scale]);
        off += 16;
      }
      if (outer.length >= 3) {
        builder.addExtrudedPolygon({
          name: attrs.name,
          category: 'ON_Extrusion',
          outer,
          frame: makeTransform3D([ox, oy, oz]),
          depth: height,
          layerName,
          color,
          opacity,
        });
      }
      return;
    }

    if ((geomCode === TCODE_GEOMETRY_MESH || geomCode === TCODE_MESH_OBJECT) && data.byteLength >= 8) {
      // Binary ON_Mesh: [vertCount: uint32, triCount: uint32, vertices: Float32[vertCount*3], indices: Uint32[triCount*3]]
      const vertCount = view.getUint32(0, true);
      const triCount = view.getUint32(4, true);
      const needed = 8 + vertCount * 12 + triCount * 12;
      if (vertCount >= 3 && triCount >= 1 && data.byteLength >= needed) {
        const verts = new Float32Array(vertCount * 3);
        let off = 8;
        for (let i = 0; i < vertCount * 3; i++) {
          verts[i] = clean(view.getFloat32(off, true) * scale);
          off += 4;
        }
        const indices = new Uint32Array(triCount * 3);
        for (let i = 0; i < triCount * 3; i++) {
          indices[i] = view.getUint32(off, true);
          off += 4;
        }
        builder.addMeshBody({
          name: attrs.name,
          category: 'ON_Mesh',
          vertices: verts,
          indices,
          layerName,
          color,
          opacity,
        });
      }
      return;
    }

    if (geomCode === TCODE_GEOMETRY_STEP && data.byteLength > 10) {
      const stepText = decodeText(data);
      const hash = blobHashHex(stepText);
      builder.blobs[hash] = stepText;
      builder.stepBodies.push({ name: attrs.name, step: stepText, layer: layerName, color });
      const fid = builder.nextId();
      const bodyName = builder.uniqueBodyName(attrs.name);
      builder.features.push({
        type: 'importStep',
        id: fid,
        name: attrs.name,
        blob: hash,
        body: bodyName,
        heal: true,
        group: layerName,
      });
      builder.appearance[fid] = { color };
      builder.bodyNames[fid] = bodyName;
    }
  };

  // Second pass: walk TCODE_OBJECT_TABLE
  for (const ch of topChunks) {
    const code = ch.tcode & 0x7fff;
    if (code === TCODE_OBJECT_TABLE) {
      const objChunks = read3dmChunks(ch.data, 0);
      for (const rec of objChunks) {
        const recCode = rec.tcode & 0x7fff;
        if (recCode === TCODE_OBJECT_RECORD) {
          objCounter++;
          let attrs: ObjectAttrs = { name: `Object ${objCounter}`, layerIndex: 0 };
          let geomChunk: { code: number; data: Uint8Array } | null = null;

          const subChunks = read3dmChunks(rec.data, 0);
          for (const sub of subChunks) {
            const subCode = sub.tcode & 0x7fff;
            if (subCode === TCODE_OBJECT_RECORD_ATTRIBUTES) {
              attrs = parseObjectAttributes(sub.data, attrs.name);
            } else if (subCode === TCODE_OPENNURBS_CLASS) {
              const clsChunks = read3dmChunks(sub.data, 0);
              for (const c of clsChunks) {
                const cCode = c.tcode & 0x7fff;
                if (cCode === TCODE_OPENNURBS_CLASS_DATA || (cCode >= 0x3001 && cCode <= 0x3009)) {
                  geomChunk = { code: cCode, data: c.data };
                }
              }
            } else if (subCode >= 0x3001 && subCode <= 0x3009) {
              geomChunk = { code: subCode, data: sub.data };
            } else if (sub.tcode === TCODE_MESH_OBJECT) {
              geomChunk = { code: TCODE_GEOMETRY_MESH, data: sub.data };
            }
          }

          if (geomChunk) {
            processGeometryChunk(geomChunk.code, geomChunk.data, attrs);
          }
        }
      }
    }
  }

  const part = builder.buildPart();
  const layers = [...builder.layers.values()];
  const summary = `Imported ${builder.elements.length} Rhino 3DM object(s) across ${layers.length} layer(s) (${header.versionText}, scale ${unitScaleToMm} mm/unit): ${part.features.length} feature(s), ${builder.meshes.length} mesh body(s).`;

  return {
    name: builder.name,
    format: '3dm',
    schemaVersion: header.versionText,
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

// ---- Binary OpenNURBS .3dm Chunk Builder Helper ----

export interface Rhino3dmLayerSpec {
  index: number;
  name: string;
  color: [number, number, number] | string;
  visible?: boolean;
}

export type Rhino3dmObjectSpec =
  | {
      kind: 'extrusion';
      name: string;
      layerIndex: number;
      color?: [number, number, number] | string;
      origin?: V3;
      normal?: V3;
      xDir?: V3;
      height: number;
      profile?: V2[];
      holes?: V2[][];
      radius?: number;
      innerRadius?: number;
    }
  | {
      kind: 'box';
      name: string;
      layerIndex: number;
      color?: [number, number, number] | string;
      origin?: V3;
      dx: number;
      dy: number;
      dz: number;
    }
  | {
      kind: 'cylinder';
      name: string;
      layerIndex: number;
      color?: [number, number, number] | string;
      origin?: V3;
      radius: number;
      height: number;
    }
  | {
      kind: 'sphere';
      name: string;
      layerIndex: number;
      color?: [number, number, number] | string;
      center: V3;
      radius: number;
    }
  | {
      kind: 'revolve';
      name: string;
      layerIndex: number;
      color?: [number, number, number] | string;
      origin?: V3;
      profile: V2[];
      angle?: number;
    }
  | {
      kind: 'mesh';
      name: string;
      layerIndex: number;
      color?: [number, number, number] | string;
      vertices: Float32Array | number[];
      indices: Uint32Array | number[];
    };

function packChunk(tcode: number, payload: Uint8Array): Uint8Array {
  const isShort = (tcode & TCODE_SHORT) !== 0;
  if (isShort) {
    const out = new Uint8Array(8);
    const v = new DataView(out.buffer);
    v.setUint32(0, tcode, true);
    v.setUint32(4, 0, true);
    return out;
  }
  const out = new Uint8Array(8 + payload.byteLength);
  const v = new DataView(out.buffer);
  v.setUint32(0, tcode, true);
  v.setUint32(4, payload.byteLength, true);
  out.set(payload, 8);
  return out;
}

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, a) => acc + a.byteLength, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const a of arrays) {
    out.set(a, pos);
    pos += a.byteLength;
  }
  return out;
}

function parseRgbTuple(c: [number, number, number] | string | undefined): [number, number, number] | null {
  if (!c) return null;
  if (Array.isArray(c)) return [c[0] & 0xff, c[1] & 0xff, c[2] & 0xff];
  if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) {
    return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  }
  return null;
}

/**
 * Build a binary OpenNURBS `.3dm` file with 32-byte magic header, `TCODE_SETTINGS_TABLE`,
 * `TCODE_LAYER_TABLE`, `TCODE_OBJECT_TABLE`, and `TCODE_ENDOFFILE`.
 */
export function build3dmFile(spec: {
  version?: number;
  unitSystem?: number;
  layers: Rhino3dmLayerSpec[];
  objects: Rhino3dmObjectSpec[];
}): Uint8Array {
  const enc = new TextEncoder();
  const ver = spec.version ?? 70;
  const headerStr = OPENNURBS_MAGIC + String(ver).padStart(8, ' ');
  const headerBytes = enc.encode(headerStr.slice(0, 32));

  // 1. Settings table chunk (unitSystem)
  const unitData = new Uint8Array([spec.unitSystem ?? 2]); // default 2 = millimeters
  const settingsTable = packChunk(
    TCODE_SETTINGS_TABLE,
    concatBytes([packChunk(TCODE_SETTINGS_UNITSANDTOLERANCES, unitData), packChunk(TCODE_SHORT | TCODE_ENDOFTABLE, new Uint8Array(0))]),
  );

  // 2. Layer table chunk
  const layerRecords: Uint8Array[] = [];
  for (const l of spec.layers) {
    const rgb = parseRgbTuple(l.color) ?? [143, 161, 179];
    const nameBytes = enc.encode(l.name);
    const rec = new Uint8Array(10 + nameBytes.byteLength);
    const dv = new DataView(rec.buffer);
    dv.setUint32(0, l.index, true);
    rec[4] = rgb[0];
    rec[5] = rgb[1];
    rec[6] = rgb[2];
    rec[7] = l.visible === false ? 0 : 1;
    dv.setUint16(8, nameBytes.byteLength, true);
    rec.set(nameBytes, 10);
    layerRecords.push(packChunk(TCODE_LAYER_RECORD, rec));
  }
  layerRecords.push(packChunk(TCODE_SHORT | TCODE_ENDOFTABLE, new Uint8Array(0)));
  const layerTable = packChunk(TCODE_LAYER_TABLE, concatBytes(layerRecords));

  // 3. Object table chunk
  const objectRecords: Uint8Array[] = [];
  for (const obj of spec.objects) {
    const rgb = parseRgbTuple(obj.color);
    const nameBytes = enc.encode(obj.name);
    const attrBuf = new Uint8Array(10 + nameBytes.byteLength);
    const attrDv = new DataView(attrBuf.buffer);
    attrDv.setUint32(0, obj.layerIndex, true);
    attrBuf[4] = rgb ? 1 : 0;
    attrBuf[5] = rgb ? rgb[0] : 0;
    attrBuf[6] = rgb ? rgb[1] : 0;
    attrBuf[7] = rgb ? rgb[2] : 0;
    attrDv.setUint16(8, nameBytes.byteLength, true);
    attrBuf.set(nameBytes, 10);
    const attrChunk = packChunk(TCODE_OBJECT_RECORD_ATTRIBUTES, attrBuf);

    let geomChunk: Uint8Array;
    if (obj.kind === 'box') {
      const o = obj.origin ?? [0, 0, 0];
      const buf = new Uint8Array(48);
      const dv = new DataView(buf.buffer);
      dv.setFloat64(0, o[0], true);
      dv.setFloat64(8, o[1], true);
      dv.setFloat64(16, o[2], true);
      dv.setFloat64(24, obj.dx, true);
      dv.setFloat64(32, obj.dy, true);
      dv.setFloat64(40, obj.dz, true);
      geomChunk = packChunk(TCODE_GEOMETRY_BOX, buf);
    } else if (obj.kind === 'cylinder') {
      const o = obj.origin ?? [0, 0, 0];
      const buf = new Uint8Array(40);
      const dv = new DataView(buf.buffer);
      dv.setFloat64(0, o[0], true);
      dv.setFloat64(8, o[1], true);
      dv.setFloat64(16, o[2], true);
      dv.setFloat64(24, obj.radius, true);
      dv.setFloat64(32, obj.height, true);
      geomChunk = packChunk(TCODE_GEOMETRY_CYLINDER, buf);
    } else if (obj.kind === 'sphere') {
      const buf = new Uint8Array(32);
      const dv = new DataView(buf.buffer);
      dv.setFloat64(0, obj.center[0], true);
      dv.setFloat64(8, obj.center[1], true);
      dv.setFloat64(16, obj.center[2], true);
      dv.setFloat64(24, obj.radius, true);
      geomChunk = packChunk(TCODE_GEOMETRY_SPHERE, buf);
    } else if (obj.kind === 'mesh') {
      const vArr = obj.vertices instanceof Float32Array ? obj.vertices : new Float32Array(obj.vertices);
      const iArr = obj.indices instanceof Uint32Array ? obj.indices : new Uint32Array(obj.indices);
      const vertCount = Math.floor(vArr.length / 3);
      const triCount = Math.floor(iArr.length / 3);
      const buf = new Uint8Array(8 + vertCount * 12 + triCount * 12);
      const dv = new DataView(buf.buffer);
      dv.setUint32(0, vertCount, true);
      dv.setUint32(4, triCount, true);
      let off = 8;
      for (let i = 0; i < vertCount * 3; i++) {
        dv.setFloat32(off, vArr[i], true);
        off += 4;
      }
      for (let i = 0; i < triCount * 3; i++) {
        dv.setUint32(off, iArr[i], true);
        off += 4;
      }
      geomChunk = packChunk(TCODE_GEOMETRY_MESH, buf);
    } else if (obj.kind === 'extrusion' && obj.profile && !obj.holes && !obj.normal && !obj.xDir) {
      const o = obj.origin ?? [0, 0, 0];
      const pts = obj.profile;
      const buf = new Uint8Array(36 + pts.length * 16);
      const dv = new DataView(buf.buffer);
      dv.setFloat64(0, o[0], true);
      dv.setFloat64(8, o[1], true);
      dv.setFloat64(16, o[2], true);
      dv.setFloat64(24, obj.height, true);
      dv.setUint32(32, pts.length, true);
      let off = 36;
      for (const [x, y] of pts) {
        dv.setFloat64(off, x, true);
        dv.setFloat64(off + 8, y, true);
        off += 16;
      }
      geomChunk = packChunk(TCODE_GEOMETRY_EXTRUSION, buf);
    } else {
      const code = obj.kind === 'revolve' ? TCODE_GEOMETRY_REVOLVE : TCODE_GEOMETRY_EXTRUSION;
      geomChunk = packChunk(code, enc.encode(JSON.stringify(obj)));
    }

    const endRec = packChunk(TCODE_SHORT | TCODE_OBJECT_RECORD_END, new Uint8Array(0));
    objectRecords.push(packChunk(TCODE_OBJECT_RECORD, concatBytes([attrChunk, geomChunk, endRec])));
  }
  objectRecords.push(packChunk(TCODE_SHORT | TCODE_ENDOFTABLE, new Uint8Array(0)));
  const objectTable = packChunk(TCODE_OBJECT_TABLE, concatBytes(objectRecords));

  const eofChunk = packChunk(TCODE_SHORT | TCODE_ENDOFFILE, new Uint8Array(0));
  return concatBytes([headerBytes, settingsTable, layerTable, objectTable, eofChunk]);
}
