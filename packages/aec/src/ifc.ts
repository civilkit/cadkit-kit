// Clean-room ISO 10303-21 STEP Physical File (.ifc) BIM/AEC Importer (IFC2x3 & IFC4).
// Zero external dependencies. Parses spatial structure, unit scaling, nested IfcLocalPlacement
// transforms, IfcExtrudedAreaSolid profiles, tessellated/B-rep meshes, and IfcStyledItem RGB colours.

import {
  IDENTITY_TRANSFORM,
  PartBuilder,
  clean,
  composeTransform,
  decodeText,
  defaultAecColor,
  makeTransform3D,
  norm3,
  rgbToHex,
  transformPoint,
  transformPoints2D,
  type SketchCurve2D,
} from './geom';
import type { AecImportReport, Transform3D, V2, V3 } from './types';

export type StepValue =
  | { kind: 'ref'; id: number }
  | { kind: 'str'; value: string }
  | { kind: 'num'; value: number }
  | { kind: 'enum'; value: string }
  | { kind: 'list'; items: StepValue[] }
  | { kind: 'typed'; type: string; args: StepValue[] }
  | { kind: 'null' };

export interface IfcEntity {
  id: number;
  type: string;
  args: StepValue[];
}

const IFC_ELEMENT_TYPES = new Set([
  'IFCWALL',
  'IFCWALLSTANDARDCASE',
  'IFCWALLELEMENTEDCASE',
  'IFCSLAB',
  'IFCSLABSTANDARDCASE',
  'IFCCOLUMN',
  'IFCCOLUMNSTANDARDCASE',
  'IFCBEAM',
  'IFCBEAMSTANDARDCASE',
  'IFCDOOR',
  'IFCDOORSTANDARDCASE',
  'IFCWINDOW',
  'IFCWINDOWSTANDARDCASE',
  'IFCMEMBER',
  'IFCMEMBERSTANDARDCASE',
  'IFCPLATE',
  'IFCPLATESTANDARDCASE',
  'IFCFOOTING',
  'IFCROOF',
  'IFCSTAIR',
  'IFCSTAIRFLIGHT',
  'IFCRAMP',
  'IFCRAMPFLIGHT',
  'IFCRAILING',
  'IFCCURTAINWALL',
  'IFCCOVERING',
  'IFCFURNISHINGELEMENT',
  'IFCPROXY',
  'IFCBUILDINGELEMENTPROXY',
]);

/** True when the input bytes or string look like an ISO-10303-21 IFC file. */
export function looksLikeIfc(input: Uint8Array | string): boolean {
  const head =
    typeof input === 'string'
      ? input.slice(0, 4096)
      : decodeText(input.subarray(0, Math.min(input.length, 4096)));
  if (/FILE_SCHEMA\s*\(\s*\(\s*'IFC/i.test(head)) return true;
  if (/ISO-10303-21\s*;/i.test(head) && /#\d+\s*=\s*IFC[A-Z0-9_]+\s*\(/i.test(head)) return true;
  return /#\d+\s*=\s*IFCPROJECT\s*\(/i.test(head);
}

/** Decode STEP Part-21 string escapes (`''`, `\X\..`, `\X2\....\X0\`). */
function decodeStepString(raw: string): string {
  let s = raw.replace(/''/g, "'");
  s = s.replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_, hex: string) => {
    let out = '';
    for (let i = 0; i + 3 < hex.length; i += 4) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    }
    return out;
  });
  s = s.replace(/\\X\\([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return s;
}

/** Strip `/* ... * /` comments while keeping string literals intact. */
function stripStepComments(text: string): string {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const ch = text[i];
    if (inStr) {
      out += ch;
      if (ch === "'") {
        if (text[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        inStr = false;
      }
      i++;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function parseStepArgList(src: string, startPos: number): { items: StepValue[]; nextPos: number } {
  const items: StepValue[] = [];
  let i = startPos;
  const len = src.length;

  const skipWs = () => {
    while (i < len && src.charCodeAt(i) <= 32) i++;
  };

  while (i < len) {
    skipWs();
    if (i >= len) break;
    const ch = src[i];
    if (ch === ')') {
      i++;
      break;
    }
    if (ch === ',') {
      i++;
      continue;
    }
    const { val, nextPos } = parseStepValue(src, i);
    items.push(val);
    i = nextPos;
    skipWs();
    if (src[i] === ',') i++;
  }
  return { items, nextPos: i };
}

function parseStepValue(src: string, pos: number): { val: StepValue; nextPos: number } {
  let i = pos;
  const len = src.length;
  while (i < len && src.charCodeAt(i) <= 32) i++;
  if (i >= len) return { val: { kind: 'null' }, nextPos: i };

  const ch = src[i];
  if (ch === '$' || ch === '*') {
    return { val: { kind: 'null' }, nextPos: i + 1 };
  }
  if (ch === '(') {
    const { items, nextPos } = parseStepArgList(src, i + 1);
    return { val: { kind: 'list', items }, nextPos };
  }
  if (ch === '#') {
    i++;
    const start = i;
    while (i < len && src.charCodeAt(i) >= 48 && src.charCodeAt(i) <= 57) i++;
    return { val: { kind: 'ref', id: parseInt(src.slice(start, i), 10) || 0 }, nextPos: i };
  }
  if (ch === "'") {
    i++;
    let raw = '';
    while (i < len) {
      if (src[i] === "'") {
        if (src[i + 1] === "'") {
          raw += "''";
          i += 2;
          continue;
        }
        i++;
        break;
      }
      raw += src[i++];
    }
    return { val: { kind: 'str', value: decodeStepString(raw) }, nextPos: i };
  }
  if (ch === '.') {
    i++;
    const start = i;
    while (i < len && src[i] !== '.') i++;
    const val = src.slice(start, i).toUpperCase();
    if (src[i] === '.') i++;
    return { val: { kind: 'enum', value: val }, nextPos: i };
  }
  // Number or typed keyword `IFCTYPE(...)`
  if ((ch >= '0' && ch <= '9') || ch === '+' || ch === '-') {
    const start = i;
    i++;
    while (i < len && /[0-9.eE+-]/.test(src[i])) i++;
    const n = Number(src.slice(start, i));
    return { val: Number.isFinite(n) ? { kind: 'num', value: n } : { kind: 'null' }, nextPos: i };
  }
  if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_') {
    const start = i;
    while (i < len && /[A-Za-z0-9_]/.test(src[i])) i++;
    const kw = src.slice(start, i).toUpperCase();
    while (i < len && src.charCodeAt(i) <= 32) i++;
    if (src[i] === '(') {
      const { items, nextPos } = parseStepArgList(src, i + 1);
      return { val: { kind: 'typed', type: kw, args: items }, nextPos };
    }
    return { val: { kind: 'enum', value: kw }, nextPos: i };
  }
  return { val: { kind: 'null' }, nextPos: i + 1 };
}

export function parseIfcFile(text: string): {
  schemaVersion: string;
  entities: Map<number, IfcEntity>;
} {
  const cleaned = stripStepComments(text);
  const schemaMatch = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(cleaned);
  const schemaVersion = schemaMatch ? schemaMatch[1].trim().toUpperCase() : 'IFC4';

  const entities = new Map<number, IfcEntity>();
  const re = /#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const id = parseInt(m[1], 10);
    const type = m[2].toUpperCase();
    const argStart = m.index + m[0].length;
    const { items, nextPos } = parseStepArgList(cleaned, argStart);
    entities.set(id, { id, type, args: items });
    re.lastIndex = nextPos;
  }

  return { schemaVersion, entities };
}

const asRef = (v: StepValue | undefined): number | null => (v?.kind === 'ref' ? v.id : null);
const asStr = (v: StepValue | undefined): string => {
  if (!v) return '';
  if (v.kind === 'str') return v.value.trim();
  if (v.kind === 'typed' && v.args[0]) return asStr(v.args[0]);
  return '';
};
const asNum = (v: StepValue | undefined): number | null => {
  if (!v) return null;
  if (v.kind === 'num') return v.value;
  if (v.kind === 'typed' && v.args[0]) return asNum(v.args[0]);
  return null;
};
const asEnum = (v: StepValue | undefined): string => (v?.kind === 'enum' ? v.value : '');
const asList = (v: StepValue | undefined): StepValue[] => {
  if (!v) return [];
  if (v.kind === 'list') return v.items;
  if (v.kind === 'typed' && v.args[0]?.kind === 'list') return v.args[0].items;
  return [];
};
const asRefList = (v: StepValue | undefined): number[] =>
  asList(v)
    .map((item) => (item.kind === 'ref' ? item.id : null))
    .filter((id): id is number => id !== null);
const asNumList = (v: StepValue | undefined): number[] =>
  asList(v)
    .map((item) => asNum(item))
    .filter((n): n is number => n !== null);

const SI_PREFIX_SCALE: Record<string, number> = {
  EXA: 1e18,
  PETA: 1e15,
  TERA: 1e12,
  GIGA: 1e9,
  MEGA: 1e6,
  KILO: 1e3,
  HECTO: 1e2,
  DECA: 1e1,
  DECI: 1e-1,
  CENTI: 1e-2,
  MILLI: 1e-3,
  MICRO: 1e-6,
  NANO: 1e-9,
};

function resolveIfcUnits(entities: Map<number, IfcEntity>): { lengthToMm: number; angleToDeg: number; projectName: string } {
  let lengthToMm = 1;
  let angleToDeg = 1;
  let projectName = '';

  const evalSiLengthToMm = (e: IfcEntity): number | null => {
    // IFCSIUNIT(Dimensions, UnitType, Prefix, Name)
    if (e.type !== 'IFCSIUNIT') return null;
    const unitType = asEnum(e.args[1]);
    if (unitType !== 'LENGTHUNIT') return null;
    const prefix = asEnum(e.args[2]);
    const name = asEnum(e.args[3]);
    if (name !== 'METRE' && name !== 'METER') return null;
    const prefixFactor = prefix ? (SI_PREFIX_SCALE[prefix] ?? 1) : 1;
    // 1 metre = 1000 mm
    return prefixFactor * 1000;
  };

  const evalUnitToMm = (id: number): number | null => {
    const e = entities.get(id);
    if (!e) return null;
    if (e.type === 'IFCSIUNIT') return evalSiLengthToMm(e);
    if (e.type === 'IFCCONVERSIONBASEDUNIT') {
      // IFCCONVERSIONBASEDUNIT(Dimensions, UnitType, Name, ConversionFactor)
      if (asEnum(e.args[1]) !== 'LENGTHUNIT') return null;
      const uName = asStr(e.args[2]).toUpperCase();
      if (uName.includes('INCH')) return 25.4;
      if (uName.includes('FOOT') || uName.includes('FEET')) return 304.8;
      const factorRef = asRef(e.args[3]);
      const factorEnt = factorRef ? entities.get(factorRef) : undefined;
      if (factorEnt?.type === 'IFCMEASUREWITHUNIT') {
        const val = asNum(factorEnt.args[0]) ?? 1;
        const baseRef = asRef(factorEnt.args[1]);
        const baseMm = baseRef ? (evalUnitToMm(baseRef) ?? 1) : 1;
        return val * baseMm;
      }
    }
    return null;
  };

  const evalAngleToDeg = (id: number): number | null => {
    const e = entities.get(id);
    if (!e) return null;
    if (e.type === 'IFCSIUNIT' && asEnum(e.args[1]) === 'PLANEANGLEUNIT') {
      const name = asEnum(e.args[3]);
      if (name === 'RADIAN') return 180 / Math.PI;
    }
    if (e.type === 'IFCCONVERSIONBASEDUNIT' && asEnum(e.args[1]) === 'PLANEANGLEUNIT') {
      const uName = asStr(e.args[2]).toUpperCase();
      if (uName.includes('DEG')) return 1;
      const factorRef = asRef(e.args[3]);
      const factorEnt = factorRef ? entities.get(factorRef) : undefined;
      if (factorEnt?.type === 'IFCMEASUREWITHUNIT') {
        const val = asNum(factorEnt.args[0]);
        if (val !== null) return val * (180 / Math.PI);
      }
    }
    return null;
  };

  let foundLength = false;
  for (const e of entities.values()) {
    if (e.type === 'IFCPROJECT') {
      projectName = asStr(e.args[2]) || asStr(e.args[7]) || '';
      const unitAssignRef = asRef(e.args[8]);
      const ua = unitAssignRef ? entities.get(unitAssignRef) : undefined;
      if (ua?.type === 'IFCUNITASSIGNMENT') {
        for (const uId of asRefList(ua.args[0])) {
          const l = evalUnitToMm(uId);
          if (l !== null) {
            lengthToMm = l;
            foundLength = true;
          }
          const a = evalAngleToDeg(uId);
          if (a !== null) angleToDeg = a;
        }
      }
    }
  }

  if (!foundLength) {
    for (const e of entities.values()) {
      const l = evalUnitToMm(e.id);
      if (l !== null) {
        lengthToMm = l;
        break;
      }
    }
  }

  return { lengthToMm, angleToDeg, projectName };
}

/**
 * Import an ISO 10303-21 IFC (`.ifc`, IFC2x3 or IFC4) model into a CadKit `Part` and `AecImportReport`.
 */
export function importIfc(input: Uint8Array | string, fileName = 'Model.ifc'): AecImportReport {
  const defaultName = fileName.replace(/^.*[\\/]/, '').replace(/\.ifc$/i, '') || 'IFC Building';
  const text = typeof input === 'string' ? input : decodeText(input);
  const { schemaVersion, entities } = parseIfcFile(text);
  const { lengthToMm, angleToDeg, projectName } = resolveIfcUnits(entities);
  const builder = new PartBuilder(projectName || defaultName);

  if (entities.size === 0) {
    const msg = 'file contains no readable ISO-10303-21 IFC entities';
    builder.warn(fileName, 'emptyIfc', msg);
    return {
      name: builder.name,
      format: 'ifc',
      schemaVersion,
      unitScaleToMm: lengthToMm,
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

  // ---- Coordinate & Placement Resolvers ----
  const readPoint3D = (id: number | null): V3 => {
    if (!id) return [0, 0, 0];
    const e = entities.get(id);
    if (!e || e.type !== 'IFCCARTESIANPOINT') return [0, 0, 0];
    const coords = asNumList(e.args[0]);
    return [
      clean((coords[0] ?? 0) * lengthToMm),
      clean((coords[1] ?? 0) * lengthToMm),
      clean((coords[2] ?? 0) * lengthToMm),
    ];
  };

  const readPoint2D = (id: number | null): V2 => {
    if (!id) return [0, 0];
    const e = entities.get(id);
    if (!e || e.type !== 'IFCCARTESIANPOINT') return [0, 0];
    const coords = asNumList(e.args[0]);
    return [clean((coords[0] ?? 0) * lengthToMm), clean((coords[1] ?? 0) * lengthToMm)];
  };

  const readDirection3D = (id: number | null, fallback: V3): V3 => {
    if (!id) return [...fallback] as V3;
    const e = entities.get(id);
    if (!e || e.type !== 'IFCDIRECTION') return [...fallback] as V3;
    const d = asNumList(e.args[0]);
    return norm3([d[0] ?? fallback[0], d[1] ?? fallback[1], d[2] ?? fallback[2]], fallback);
  };

  const readDirection2D = (id: number | null, fallback: V2 = [1, 0]): V2 => {
    if (!id) return [...fallback] as V2;
    const e = entities.get(id);
    if (!e || e.type !== 'IFCDIRECTION') return [...fallback] as V2;
    const d = asNumList(e.args[0]);
    const dx = d[0] ?? fallback[0];
    const dy = d[1] ?? fallback[1];
    const len = Math.hypot(dx, dy);
    return len > 1e-12 ? [dx / len, dy / len] : [...fallback] as V2;
  };

  const readAxis2Placement3D = (id: number | null): Transform3D => {
    if (!id) return IDENTITY_TRANSFORM;
    const e = entities.get(id);
    if (!e) return IDENTITY_TRANSFORM;
    if (e.type === 'IFCAXIS2PLACEMENT3D') {
      const loc = readPoint3D(asRef(e.args[0]));
      const axis = readDirection3D(asRef(e.args[1]), [0, 0, 1]);
      const refDir = readDirection3D(asRef(e.args[2]), [1, 0, 0]);
      return makeTransform3D(loc, axis, refDir);
    }
    if (e.type === 'IFCAXIS2PLACEMENT2D') {
      const loc2 = readPoint2D(asRef(e.args[0]));
      const ref2 = readDirection2D(asRef(e.args[1]), [1, 0]);
      return makeTransform3D([loc2[0], loc2[1], 0], [0, 0, 1], [ref2[0], ref2[1], 0]);
    }
    if (e.type === 'IFCCARTESIANTRANSFORMATIONOPERATOR3D' || e.type === 'IFCCARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM') {
      // IFCCARTESIANTRANSFORMATIONOPERATOR3D(Axis1, Axis2, LocalOrigin, Scale, Axis3)
      const xDir = readDirection3D(asRef(e.args[0]), [1, 0, 0]);
      const loc = readPoint3D(asRef(e.args[2]));
      const zDir = readDirection3D(asRef(e.args[4]), [0, 0, 1]);
      return makeTransform3D(loc, zDir, xDir);
    }
    return IDENTITY_TRANSFORM;
  };

  const readAxis2Placement2D = (id: number | null): { origin: V2; xDir: V2 } => {
    if (!id) return { origin: [0, 0], xDir: [1, 0] };
    const e = entities.get(id);
    if (!e || e.type !== 'IFCAXIS2PLACEMENT2D') return { origin: [0, 0], xDir: [1, 0] };
    return {
      origin: readPoint2D(asRef(e.args[0])),
      xDir: readDirection2D(asRef(e.args[1]), [1, 0]),
    };
  };

  const placementCache = new Map<number, Transform3D>();
  const resolveLocalPlacement = (id: number | null, visited = new Set<number>()): Transform3D => {
    if (!id) return IDENTITY_TRANSFORM;
    if (placementCache.has(id)) return placementCache.get(id)!;
    if (visited.has(id)) return IDENTITY_TRANSFORM;
    visited.add(id);

    const e = entities.get(id);
    if (!e) return IDENTITY_TRANSFORM;
    if (e.type === 'IFCLOCALPLACEMENT') {
      const parentId = asRef(e.args[0]);
      const relId = asRef(e.args[1]);
      const parentT = resolveLocalPlacement(parentId, visited);
      const localT = readAxis2Placement3D(relId);
      const worldT = composeTransform(parentT, localT);
      placementCache.set(id, worldT);
      return worldT;
    }
    const direct = readAxis2Placement3D(id);
    placementCache.set(id, direct);
    return direct;
  };

  // ---- Styling & RGB Color Resolution ----
  const styleByItem = new Map<number, { color: string; opacity?: number }>();

  const extractColorFromStyleTree = (id: number, visited = new Set<number>()): { color: string; opacity?: number } | null => {
    if (visited.has(id)) return null;
    visited.add(id);
    const e = entities.get(id);
    if (!e) return null;

    if (e.type === 'IFCCOLOURRGB') {
      // IFCCOLOURRGB(Name, Red, Green, Blue)
      const r = asNum(e.args[1]) ?? 0.7;
      const g = asNum(e.args[2]) ?? 0.7;
      const b = asNum(e.args[3]) ?? 0.7;
      return { color: rgbToHex(r, g, b) };
    }
    if (e.type === 'IFCSURFACESTYLERENDERING' || e.type === 'IFCSURFACESTYLESHADING') {
      const colRef = asRef(e.args[0]);
      const base = colRef ? extractColorFromStyleTree(colRef, visited) : null;
      if (!base) return null;
      const transp = asNum(e.args[1]);
      if (transp !== null && transp > 0 && transp < 1) {
        return { color: base.color, opacity: clean(1 - transp) };
      }
      return base;
    }
    // Walk all reference and list arguments recursively
    for (const arg of e.args) {
      if (arg.kind === 'ref') {
        const hit = extractColorFromStyleTree(arg.id, visited);
        if (hit) return hit;
      } else if (arg.kind === 'list') {
        for (const sub of arg.items) {
          if (sub.kind === 'ref') {
            const hit = extractColorFromStyleTree(sub.id, visited);
            if (hit) return hit;
          } else if (sub.kind === 'typed') {
            for (const ta of sub.args) {
              if (ta.kind === 'ref') {
                const hit = extractColorFromStyleTree(ta.id, visited);
                if (hit) return hit;
              }
            }
          }
        }
      }
    }
    return null;
  };

  for (const e of entities.values()) {
    if (e.type === 'IFCSTYLEDITEM') {
      // IFCSTYLEDITEM(Item, Styles, Name)
      const itemId = asRef(e.args[0]);
      if (!itemId) continue;
      for (const sId of asRefList(e.args[1])) {
        const found = extractColorFromStyleTree(sId);
        if (found) {
          styleByItem.set(itemId, found);
          break;
        }
      }
    } else if (e.type === 'IFCINDEXEDCOLOURMAP') {
      // IFCINDEXEDCOLOURMAP(MappedTo, Opacity, Colours, ColourIndex)
      const itemId = asRef(e.args[0]);
      const opacity = asNum(e.args[1]) ?? undefined;
      const colListId = asRef(e.args[2]);
      const colList = colListId ? entities.get(colListId) : undefined;
      if (itemId && colList?.type === 'IFCCOLOURRGBLIST') {
        const firstTuple = asList(colList.args[0])[0];
        if (firstTuple) {
          const rgb = asNumList(firstTuple);
          if (rgb.length >= 3) {
            styleByItem.set(itemId, {
              color: rgbToHex(rgb[0], rgb[1], rgb[2]),
              ...(opacity !== undefined && opacity < 1 ? { opacity } : {}),
            });
          }
        }
      }
    }
  }

  // ---- Spatial Structure & Storey Resolution ----
  const storeyInfoById = new Map<number, { id: string; name: string; elevationMm: number; placementId: number | null }>();
  const storeyByPlacementId = new Map<number, number>();
  const elementToStorey = new Map<number, number>();
  const parentAggregate = new Map<number, number>();

  for (const e of entities.values()) {
    if (e.type === 'IFCBUILDINGSTOREY') {
      // IFCBUILDINGSTOREY(GlobalId, OwnerHistory, Name, Description, ObjectType, ObjectPlacement, Representation, LongName, CompositionType, Elevation)
      const name = asStr(e.args[2]) || asStr(e.args[7]) || `Storey #${e.id}`;
      const plId = asRef(e.args[5]);
      const pl = resolveLocalPlacement(plId);
      const rawElev = asNum(e.args[9]);
      const elevationMm = Math.abs(pl.o[2]) > 1e-5 ? pl.o[2] : rawElev !== null ? clean(rawElev * lengthToMm) : 0;
      const sKey = `#${e.id}`;
      storeyInfoById.set(e.id, { id: sKey, name, elevationMm, placementId: plId });
      builder.ensureStorey(sKey, name, elevationMm);
      if (plId) storeyByPlacementId.set(plId, e.id);
    } else if (e.type === 'IFCRELAGGREGATES') {
      // IFCRELAGGREGATES(GlobalId, OwnerHistory, Name, Description, RelatingObject, RelatedObjects)
      const parentId = asRef(e.args[4]);
      if (parentId) {
        for (const childId of asRefList(e.args[5])) {
          parentAggregate.set(childId, parentId);
        }
      }
    }
  }

  for (const e of entities.values()) {
    if (e.type === 'IFCRELCONTAINEDINSPATIALSTRUCTURE') {
      // IFCRELCONTAINEDINSPATIALSTRUCTURE(GlobalId, OwnerHistory, Name, Description, RelatedElements, RelatingStructure)
      let structId = asRef(e.args[5]);
      while (structId && !storeyInfoById.has(structId) && parentAggregate.has(structId)) {
        structId = parentAggregate.get(structId)!;
      }
      if (structId && storeyInfoById.has(structId)) {
        for (const elId of asRefList(e.args[4])) {
          elementToStorey.set(elId, structId);
        }
      }
    }
  }

  const findStoreyForElement = (elId: number, plId: number | null, worldZ: number): { id?: string; name?: string } => {
    let curr: number | undefined = elId;
    while (curr !== undefined) {
      const stId = elementToStorey.get(curr);
      if (stId && storeyInfoById.has(stId)) {
        const st = storeyInfoById.get(stId)!;
        return { id: st.id, name: st.name };
      }
      if (storeyInfoById.has(curr)) {
        const st = storeyInfoById.get(curr)!;
        return { id: st.id, name: st.name };
      }
      curr = parentAggregate.get(curr);
    }
    // Check placement chain ancestry
    let pCurr = plId;
    const seen = new Set<number>();
    while (pCurr && !seen.has(pCurr)) {
      seen.add(pCurr);
      const hitStorey = storeyByPlacementId.get(pCurr);
      if (hitStorey && storeyInfoById.has(hitStorey)) {
        const st = storeyInfoById.get(hitStorey)!;
        return { id: st.id, name: st.name };
      }
      const pe = entities.get(pCurr);
      pCurr = pe?.type === 'IFCLOCALPLACEMENT' ? asRef(pe.args[0]) : null;
    }
    // Fallback: closest storey at or below worldZ
    if (storeyInfoById.size > 0) {
      let best: { id: string; name: string; elevationMm: number } | null = null;
      for (const st of storeyInfoById.values()) {
        if (!best || Math.abs(worldZ - st.elevationMm) < Math.abs(worldZ - best.elevationMm)) {
          best = st;
        }
      }
      if (best) return { id: best.id, name: best.name };
    }
    return {};
  };

  // ---- 2D Curve & Profile Extraction ----
  const extractCurve2DPoints = (curveId: number): V2[] => {
    const c = entities.get(curveId);
    if (!c) return [];

    if (c.type === 'IFCPOLYLINE' || c.type === 'IFCPOLYLOOP') {
      return asRefList(c.args[0]).map((ptId) => readPoint2D(ptId));
    }
    if (c.type === 'IFCINDEXEDPOLYCURVE') {
      // IFCINDEXEDPOLYCURVE(Points, Segments, SelfIntersect)
      const ptListId = asRef(c.args[0]);
      const ptListEnt = ptListId ? entities.get(ptListId) : undefined;
      if (!ptListEnt) return [];
      const coords = asList(ptListEnt.args[0]).map((tuple) => {
        const xy = asNumList(tuple);
        return [clean((xy[0] ?? 0) * lengthToMm), clean((xy[1] ?? 0) * lengthToMm)] as V2;
      });
      const segs = asList(c.args[1]);
      if (!segs.length) return coords;
      const out: V2[] = [];
      for (const seg of segs) {
        if (seg.kind === 'typed') {
          const idxs = asNumList(seg.args[0]);
          for (const idx1 of idxs) {
            const pt = coords[idx1 - 1];
            if (pt) out.push(pt);
          }
        }
      }
      return out.length ? out : coords;
    }
    if (c.type === 'IFCCOMPOSITECURVE') {
      // IFCCOMPOSITECURVE(Segments, SelfIntersect)
      const out: V2[] = [];
      for (const segId of asRefList(c.args[0])) {
        const seg = entities.get(segId);
        if (!seg) continue;
        // IFCCOMPOSITECURVESEGMENT(Transition, SameSense, ParentCurve)
        const sameSense = asEnum(seg.args[1]) !== 'F';
        const parentId = asRef(seg.args[2]);
        if (!parentId) continue;
        const pts = extractCurve2DPoints(parentId);
        if (!sameSense) pts.reverse();
        for (const p of pts) {
          if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > 1e-5) {
            out.push(p);
          }
        }
      }
      return out;
    }
    if (c.type === 'IFCTRIMMEDCURVE') {
      // IFCTRIMMEDCURVE(BasisCurve, Trim1, Trim2, SenseAgreement, MasterRepresentation)
      const basisId = asRef(c.args[0]);
      const basis = basisId ? entities.get(basisId) : undefined;
      if (!basis) return [];
      const extractTrimPt = (v: StepValue | undefined): V2 | null => {
        for (const item of asList(v)) {
          if (item.kind === 'ref') return readPoint2D(item.id);
        }
        return null;
      };
      const extractTrimParam = (v: StepValue | undefined): number | null => {
        for (const item of asList(v)) {
          const n = asNum(item);
          if (n !== null) return n;
        }
        return null;
      };
      if (basis.type === 'IFCLINE') {
        const p1 = extractTrimPt(c.args[1]);
        const p2 = extractTrimPt(c.args[2]);
        if (p1 && p2) return [p1, p2];
      }
      if (basis.type === 'IFCCIRCLE') {
        const pl2 = readAxis2Placement2D(asRef(basis.args[0]));
        const r = clean((asNum(basis.args[1]) ?? 0) * lengthToMm);
        const a1 = (extractTrimParam(c.args[1]) ?? 0) * angleToDeg * (Math.PI / 180);
        const a2 = (extractTrimParam(c.args[2]) ?? 90) * angleToDeg * (Math.PI / 180);
        const steps = 8;
        const pts: V2[] = [];
        for (let k = 0; k <= steps; k++) {
          const a = a1 + ((a2 - a1) * k) / steps;
          pts.push([r * Math.cos(a), r * Math.sin(a)]);
        }
        return transformPoints2D(pts, pl2.origin, pl2.xDir);
      }
    }
    return [];
  };

  type ProfileShape =
    | { kind: 'circle'; center: V2; radius: number; innerRadius?: number }
    | { kind: 'polygon'; outer: V2[]; holes: V2[][] };

  const extractProfileDef = (profId: number | null): ProfileShape | null => {
    if (!profId) return null;
    const p = entities.get(profId);
    if (!p) return null;

    if (p.type === 'IFCRECTANGLEPROFILEDEF') {
      // IFCRECTANGLEPROFILEDEF(ProfileType, ProfileName, Position, XDim, YDim)
      const pl2 = readAxis2Placement2D(asRef(p.args[2]));
      const xDim = (asNum(p.args[3]) ?? 0) * lengthToMm;
      const yDim = (asNum(p.args[4]) ?? 0) * lengthToMm;
      if (!(xDim > 0 && yDim > 0)) return null;
      const hx = xDim / 2;
      const hy = yDim / 2;
      const outer = transformPoints2D(
        [
          [-hx, -hy],
          [hx, -hy],
          [hx, hy],
          [-hx, hy],
        ],
        pl2.origin,
        pl2.xDir,
      );
      return { kind: 'polygon', outer, holes: [] };
    }

    if (p.type === 'IFCRECTANGLEHOLLOWPROFILEDEF') {
      // IFCRECTANGLEHOLLOWPROFILEDEF(ProfileType, ProfileName, Position, XDim, YDim, WallThickness, ...)
      const pl2 = readAxis2Placement2D(asRef(p.args[2]));
      const xDim = (asNum(p.args[3]) ?? 0) * lengthToMm;
      const yDim = (asNum(p.args[4]) ?? 0) * lengthToMm;
      const t = (asNum(p.args[5]) ?? 0) * lengthToMm;
      if (!(xDim > 0 && yDim > 0)) return null;
      const hx = xDim / 2;
      const hy = yDim / 2;
      const outer = transformPoints2D(
        [
          [-hx, -hy],
          [hx, -hy],
          [hx, hy],
          [-hx, hy],
        ],
        pl2.origin,
        pl2.xDir,
      );
      const holes: V2[][] = [];
      if (t > 0 && xDim > 2 * t && yDim > 2 * t) {
        const ihx = hx - t;
        const ihy = hy - t;
        holes.push(
          transformPoints2D(
            [
              [-ihx, -ihy],
              [ihx, -ihy],
              [ihx, ihy],
              [-ihx, ihy],
            ],
            pl2.origin,
            pl2.xDir,
          ),
        );
      }
      return { kind: 'polygon', outer, holes };
    }

    if (p.type === 'IFCCIRCLEPROFILEDEF') {
      // IFCCIRCLEPROFILEDEF(ProfileType, ProfileName, Position, Radius)
      const pl2 = readAxis2Placement2D(asRef(p.args[2]));
      const r = (asNum(p.args[3]) ?? 0) * lengthToMm;
      if (!(r > 0)) return null;
      return { kind: 'circle', center: pl2.origin, radius: clean(r) };
    }

    if (p.type === 'IFCCIRCLEHOLLOWPROFILEDEF') {
      // IFCCIRCLEHOLLOWPROFILEDEF(ProfileType, ProfileName, Position, Radius, WallThickness)
      const pl2 = readAxis2Placement2D(asRef(p.args[2]));
      const r = (asNum(p.args[3]) ?? 0) * lengthToMm;
      const t = (asNum(p.args[4]) ?? 0) * lengthToMm;
      if (!(r > 0)) return null;
      const innerRadius = t > 0 && t < r ? clean(r - t) : undefined;
      return { kind: 'circle', center: pl2.origin, radius: clean(r), ...(innerRadius ? { innerRadius } : {}) };
    }

    if (p.type === 'IFCISHAPEPROFILEDEF') {
      // IFCISHAPEPROFILEDEF(ProfileType, ProfileName, Position, OverallWidth, OverallDepth, WebThickness, FlangeThickness, ...)
      const pl2 = readAxis2Placement2D(asRef(p.args[2]));
      const w = (asNum(p.args[3]) ?? 0) * lengthToMm;
      const d = (asNum(p.args[4]) ?? 0) * lengthToMm;
      const tw = (asNum(p.args[5]) ?? w * 0.1) * lengthToMm;
      const tf = (asNum(p.args[6]) ?? d * 0.1) * lengthToMm;
      if (!(w > 0 && d > 0)) return null;
      const hw = w / 2;
      const hd = d / 2;
      const htw = Math.min(tw / 2, hw * 0.9);
      const ftf = Math.min(tf, hd * 0.45);
      const outer = transformPoints2D(
        [
          [-hw, -hd],
          [hw, -hd],
          [hw, -hd + ftf],
          [htw, -hd + ftf],
          [htw, hd - ftf],
          [hw, hd - ftf],
          [hw, hd],
          [-hw, hd],
          [-hw, hd - ftf],
          [-htw, hd - ftf],
          [-htw, -hd + ftf],
          [-hw, -hd + ftf],
        ],
        pl2.origin,
        pl2.xDir,
      );
      return { kind: 'polygon', outer, holes: [] };
    }

    if (p.type === 'IFCLSHAPEPROFILEDEF') {
      // IFCLSHAPEPROFILEDEF(ProfileType, ProfileName, Position, Depth, Width, Thickness, ...)
      const pl2 = readAxis2Placement2D(asRef(p.args[2]));
      const d = (asNum(p.args[3]) ?? 0) * lengthToMm;
      const w = ((asNum(p.args[4]) ?? asNum(p.args[3])) ?? 0) * lengthToMm;
      const t = (asNum(p.args[5]) ?? Math.min(d, w) * 0.15) * lengthToMm;
      if (!(w > 0 && d > 0)) return null;
      const hw = w / 2;
      const hd = d / 2;
      const outer = transformPoints2D(
        [
          [-hw, -hd],
          [hw, -hd],
          [hw, -hd + t],
          [-hw + t, -hd + t],
          [-hw + t, hd],
          [-hw, hd],
        ],
        pl2.origin,
        pl2.xDir,
      );
      return { kind: 'polygon', outer, holes: [] };
    }

    if (p.type === 'IFCTSHAPEPROFILEDEF') {
      // IFCTSHAPEPROFILEDEF(ProfileType, ProfileName, Position, Depth, FlangeWidth, WebThickness, FlangeThickness, ...)
      const pl2 = readAxis2Placement2D(asRef(p.args[2]));
      const d = (asNum(p.args[3]) ?? 0) * lengthToMm;
      const w = (asNum(p.args[4]) ?? 0) * lengthToMm;
      const tw = (asNum(p.args[5]) ?? w * 0.15) * lengthToMm;
      const tf = (asNum(p.args[6]) ?? d * 0.15) * lengthToMm;
      if (!(w > 0 && d > 0)) return null;
      const hw = w / 2;
      const hd = d / 2;
      const htw = tw / 2;
      const outer = transformPoints2D(
        [
          [-htw, -hd],
          [htw, -hd],
          [htw, hd - tf],
          [hw, hd - tf],
          [hw, hd],
          [-hw, hd],
          [-hw, hd - tf],
          [-htw, hd - tf],
        ],
        pl2.origin,
        pl2.xDir,
      );
      return { kind: 'polygon', outer, holes: [] };
    }

    if (p.type === 'IFCCSHAPEPROFILEDEF') {
      // IFCCSHAPEPROFILEDEF(ProfileType, ProfileName, Position, Depth, Width, WallThickness, Girth, ...)
      const pl2 = readAxis2Placement2D(asRef(p.args[2]));
      const d = (asNum(p.args[3]) ?? 0) * lengthToMm;
      const w = (asNum(p.args[4]) ?? 0) * lengthToMm;
      const t = (asNum(p.args[5]) ?? Math.min(d, w) * 0.15) * lengthToMm;
      if (!(w > 0 && d > 0)) return null;
      const hw = w / 2;
      const hd = d / 2;
      const outer = transformPoints2D(
        [
          [-hw, -hd],
          [hw, -hd],
          [hw, -hd + t],
          [-hw + t, -hd + t],
          [-hw + t, hd - t],
          [hw, hd - t],
          [hw, hd],
          [-hw, hd],
        ],
        pl2.origin,
        pl2.xDir,
      );
      return { kind: 'polygon', outer, holes: [] };
    }

    if (p.type === 'IFCARBITRARYCLOSEDPROFILEDEF' || p.type === 'IFCARBITRARYPROFILEDEFWITHVOIDS') {
      // IFCARBITRARYCLOSEDPROFILEDEF(ProfileType, ProfileName, OuterCurve)
      const outerId = asRef(p.args[2]);
      if (!outerId) return null;
      const outerEnt = entities.get(outerId);
      if (outerEnt?.type === 'IFCCIRCLE') {
        const pl2 = readAxis2Placement2D(asRef(outerEnt.args[0]));
        const r = (asNum(outerEnt.args[1]) ?? 0) * lengthToMm;
        if (r > 0) return { kind: 'circle', center: pl2.origin, radius: clean(r) };
      }
      const outer = extractCurve2DPoints(outerId);
      if (outer.length < 3) return null;
      const holes: V2[][] = [];
      if (p.type === 'IFCARBITRARYPROFILEDEFWITHVOIDS') {
        for (const hId of asRefList(p.args[3])) {
          const hPts = extractCurve2DPoints(hId);
          if (hPts.length >= 3) holes.push(hPts);
        }
      }
      return { kind: 'polygon', outer, holes };
    }

    return null;
  };

  // ---- 3D Tessellated & Faceted B-rep Extraction ----
  const extractFacePolygon3D = (faceId: number, worldT: Transform3D): V3[] => {
    const face = entities.get(faceId);
    if (!face) return [];
    const bounds = asRefList(face.args[0]);
    for (const bId of bounds) {
      const b = entities.get(bId);
      if (!b) continue;
      const loopId = asRef(b.args[0]);
      const orientation = asEnum(b.args[1]) !== 'F';
      const loop = loopId ? entities.get(loopId) : undefined;
      if (!loop) continue;
      if (loop.type === 'IFCPOLYLOOP') {
        const pts = asRefList(loop.args[0]).map((ptId) => transformPoint(worldT, readPoint3D(ptId)));
        if (!orientation) pts.reverse();
        return pts;
      }
      if (loop.type === 'IFCEDGELOOP') {
        const pts: V3[] = [];
        for (const oeId of asRefList(loop.args[0])) {
          const oe = entities.get(oeId);
          if (!oe) continue;
          const edgeId = asRef(oe.args[2]);
          const sense = asEnum(oe.args[3]) !== 'F';
          const edge = edgeId ? entities.get(edgeId) : undefined;
          if (!edge) continue;
          const vRef = asRef(sense ? edge.args[0] : edge.args[1]);
          const vEnt = vRef ? entities.get(vRef) : undefined;
          const ptId = vEnt?.type === 'IFCVERTEXPOINT' ? asRef(vEnt.args[0]) : vRef;
          if (ptId) pts.push(transformPoint(worldT, readPoint3D(ptId)));
        }
        if (!orientation) pts.reverse();
        return pts;
      }
    }
    return [];
  };

  const extractMeshFromBrepOrFaceSet = (
    itemId: number,
    worldT: Transform3D,
  ): { vertices: Float32Array; indices: Uint32Array } | null => {
    const item = entities.get(itemId);
    if (!item) return null;

    if (item.type === 'IFCTRIANGULATEDFACESET') {
      // IFCTRIANGULATEDFACESET(Coordinates, Normals, Closed, CoordIndex, PnIndex)
      const coordListId = asRef(item.args[0]);
      const coordListEnt = coordListId ? entities.get(coordListId) : undefined;
      if (!coordListEnt || coordListEnt.type !== 'IFCCARTESIANPOINTLIST3D') return null;
      const rawCoords = asList(coordListEnt.args[0]);
      const pnIndex = asNumList(item.args[4]);

      const verts: number[] = [];
      for (const tuple of rawCoords) {
        const xyz = asNumList(tuple);
        const p = transformPoint(worldT, [
          (xyz[0] ?? 0) * lengthToMm,
          (xyz[1] ?? 0) * lengthToMm,
          (xyz[2] ?? 0) * lengthToMm,
        ]);
        verts.push(p[0], p[1], p[2]);
      }

      const tris: number[] = [];
      const vertCount = rawCoords.length;
      for (const triTuple of asList(item.args[3])) {
        const idx = asNumList(triTuple);
        if (idx.length < 3) continue;
        const mapIdx = (oneBased: number): number => {
          const mapped = pnIndex.length >= oneBased ? pnIndex[oneBased - 1] : oneBased;
          return mapped - 1;
        };
        const a = mapIdx(idx[0]);
        const b = mapIdx(idx[1]);
        const c = mapIdx(idx[2]);
        if (a >= 0 && a < vertCount && b >= 0 && b < vertCount && c >= 0 && c < vertCount) {
          tris.push(a, b, c);
        }
      }
      if (verts.length >= 9 && tris.length >= 3) {
        return {
          vertices: new Float32Array(verts),
          indices: new Uint32Array(tris),
        };
      }
      return null;
    }

    if (item.type === 'IFCPOLYGONALFACESET') {
      // IFCPOLYGONALFACESET(Coordinates, Closed, Faces, PnIndex)
      const coordListId = asRef(item.args[0]);
      const coordListEnt = coordListId ? entities.get(coordListId) : undefined;
      if (!coordListEnt || coordListEnt.type !== 'IFCCARTESIANPOINTLIST3D') return null;
      const rawCoords = asList(coordListEnt.args[0]);
      const pnIndex = asNumList(item.args[3]);

      const verts: number[] = [];
      for (const tuple of rawCoords) {
        const xyz = asNumList(tuple);
        const p = transformPoint(worldT, [
          (xyz[0] ?? 0) * lengthToMm,
          (xyz[1] ?? 0) * lengthToMm,
          (xyz[2] ?? 0) * lengthToMm,
        ]);
        verts.push(p[0], p[1], p[2]);
      }
      const vertCount = rawCoords.length;
      const mapIdx = (oneBased: number): number => {
        const mapped = pnIndex.length >= oneBased ? pnIndex[oneBased - 1] : oneBased;
        return mapped - 1;
      };

      const tris: number[] = [];
      for (const faceRefId of asRefList(item.args[2])) {
        const fEnt = entities.get(faceRefId);
        if (!fEnt) continue;
        // IFCINDEXEDPOLYGONALFACE((i1, i2, i3, ...))
        const polyIdx = asNumList(fEnt.args[0]).map(mapIdx);
        for (let k = 1; k + 1 < polyIdx.length; k++) {
          const a = polyIdx[0];
          const b = polyIdx[k];
          const c = polyIdx[k + 1];
          if (a >= 0 && a < vertCount && b >= 0 && b < vertCount && c >= 0 && c < vertCount) {
            tris.push(a, b, c);
          }
        }
      }
      if (verts.length >= 9 && tris.length >= 3) {
        return {
          vertices: new Float32Array(verts),
          indices: new Uint32Array(tris),
        };
      }
      return null;
    }

    if (
      item.type === 'IFCFACETEDBREP' ||
      item.type === 'IFCFACETEDBREPWITHVOIDS' ||
      item.type === 'IFCSHELLBASEDSURFACEMODEL' ||
      item.type === 'IFCFACEBASEDSURFACEMODEL'
    ) {
      const shellIds =
        item.type === 'IFCFACETEDBREP' || item.type === 'IFCFACETEDBREPWITHVOIDS'
          ? [asRef(item.args[0])].filter((x): x is number => x !== null)
          : asRefList(item.args[0]);

      const verts: number[] = [];
      const tris: number[] = [];
      const vMap = new Map<string, number>();

      const addVertex = (p: V3): number => {
        const key = `${p[0].toFixed(4)}:${p[1].toFixed(4)}:${p[2].toFixed(4)}`;
        const hit = vMap.get(key);
        if (hit !== undefined) return hit;
        const idx = verts.length / 3;
        verts.push(p[0], p[1], p[2]);
        vMap.set(key, idx);
        return idx;
      };

      for (const shId of shellIds) {
        const shell = entities.get(shId);
        if (!shell) continue;
        for (const fId of asRefList(shell.args[0])) {
          const poly = extractFacePolygon3D(fId, worldT);
          if (poly.length < 3) continue;
          const vIdxs = poly.map(addVertex);
          for (let k = 1; k + 1 < vIdxs.length; k++) {
            tris.push(vIdxs[0], vIdxs[k], vIdxs[k + 1]);
          }
        }
      }

      if (verts.length >= 9 && tris.length >= 3) {
        return {
          vertices: new Float32Array(verts),
          indices: new Uint32Array(tris),
        };
      }
      return null;
    }

    return null;
  };

  // ---- Process Representation Items for a Building Element ----
  const processRepresentationItem = (
    itemId: number,
    elInfo: {
      id: string;
      name: string;
      category: string;
      worldT: Transform3D;
      storeyId?: string;
      storeyName?: string;
      color?: string;
      opacity?: number;
    },
    visited = new Set<number>(),
  ): boolean => {
    if (visited.has(itemId)) return false;
    visited.add(itemId);
    const item = entities.get(itemId);
    if (!item) return false;

    const itemStyle = styleByItem.get(itemId);
    const color = itemStyle?.color ?? elInfo.color;
    const opacity = itemStyle?.opacity ?? elInfo.opacity;

    if (item.type === 'IFCEXTRUDEDAREASOLID') {
      // IFCEXTRUDEDAREASOLID(SweptArea, Position, ExtrudedDirection, Depth)
      const profId = asRef(item.args[0]);
      const posId = asRef(item.args[1]);
      const dirId = asRef(item.args[2]);
      const rawDepth = asNum(item.args[3]) ?? 0;
      const depth = clean(rawDepth * lengthToMm);
      if (!(depth > 1e-5)) return false;

      const solidT = posId ? composeTransform(elInfo.worldT, readAxis2Placement3D(posId)) : elInfo.worldT;
      const extrudeDir = readDirection3D(dirId, [0, 0, 1]);
      const profile = extractProfileDef(profId);
      if (!profile) return false;

      if (profile.kind === 'circle') {
        const created = builder.addExtrudedCircle({
          id: elInfo.id,
          name: elInfo.name,
          category: elInfo.category,
          center: profile.center,
          radius: profile.radius,
          innerRadius: profile.innerRadius,
          frame: solidT,
          extrudeDir,
          depth,
          storeyId: elInfo.storeyId,
          storeyName: elInfo.storeyName,
          color,
          opacity,
        });
        return created.length > 0;
      }

      const created = builder.addExtrudedPolygon({
        id: elInfo.id,
        name: elInfo.name,
        category: elInfo.category,
        outer: profile.outer,
        holes: profile.holes,
        frame: solidT,
        extrudeDir,
        depth,
        storeyId: elInfo.storeyId,
        storeyName: elInfo.storeyName,
        color,
        opacity,
      });
      return created.length > 0;
    }

    if (item.type === 'IFCREVOLVEDAREASOLID') {
      // IFCREVOLVEDAREASOLID(SweptArea, Position, Axis, Angle)
      const profId = asRef(item.args[0]);
      const posId = asRef(item.args[1]);
      const axisId = asRef(item.args[2]);
      const rawAngle = asNum(item.args[3]) ?? 360;
      const angleDeg = clean(rawAngle * angleToDeg);

      const solidT = posId ? composeTransform(elInfo.worldT, readAxis2Placement3D(posId)) : elInfo.worldT;
      const profile = extractProfileDef(profId);
      if (!profile || profile.kind !== 'polygon') return false;

      let axisOrigin: V2 = [0, 0];
      let axisDir: V2 = [0, 1];
      const axEnt = axisId ? entities.get(axisId) : undefined;
      if (axEnt?.type === 'IFCAXIS1PLACEMENT') {
        axisOrigin = readPoint2D(asRef(axEnt.args[0]));
        axisDir = readDirection2D(asRef(axEnt.args[1]), [0, 1]);
      }

      const created = builder.addRevolve({
        id: elInfo.id,
        name: elInfo.name,
        category: elInfo.category,
        profile: profile.outer,
        axisOrigin,
        axisDir,
        angleDeg,
        frame: solidT,
        storeyId: elInfo.storeyId,
        storeyName: elInfo.storeyName,
        color,
        opacity,
      });
      return created.length > 0;
    }

    if (item.type === 'IFCBOOLEANCLIPPINGRESULT' || item.type === 'IFCBOOLEANRESULT') {
      // IFCBOOLEANRESULT(Operator, FirstOperand, SecondOperand)
      const firstOp = asRef(item.args[1]);
      if (firstOp) {
        return processRepresentationItem(firstOp, { ...elInfo, color, opacity }, visited);
      }
      return false;
    }

    if (item.type === 'IFCMAPPEDITEM') {
      // IFCMAPPEDITEM(MappingSource, MappingTarget)
      const srcId = asRef(item.args[0]);
      const targetId = asRef(item.args[1]);
      const srcEnt = srcId ? entities.get(srcId) : undefined;
      if (srcEnt?.type === 'IFCREPRESENTATIONMAP') {
        const originT = readAxis2Placement3D(asRef(srcEnt.args[0]));
        const targetT = readAxis2Placement3D(targetId);
        const mappedRepId = asRef(srcEnt.args[1]);
        const mappedRep = mappedRepId ? entities.get(mappedRepId) : undefined;
        const combinedT = composeTransform(composeTransform(elInfo.worldT, targetT), originT);
        if (mappedRep?.type === 'IFCSHAPEREPRESENTATION') {
          let any = false;
          for (const subId of asRefList(mappedRep.args[3])) {
            if (processRepresentationItem(subId, { ...elInfo, worldT: combinedT, color, opacity }, visited)) {
              any = true;
            }
          }
          return any;
        }
      }
      return false;
    }

    if (item.type === 'IFCBLOCK') {
      // IFCBLOCK(Position, XLength, YLength, ZLength)
      const posT = composeTransform(elInfo.worldT, readAxis2Placement3D(asRef(item.args[0])));
      const lx = (asNum(item.args[1]) ?? 0) * lengthToMm;
      const ly = (asNum(item.args[2]) ?? 0) * lengthToMm;
      const lz = (asNum(item.args[3]) ?? 0) * lengthToMm;
      if (lx > 0 && ly > 0 && lz > 0) {
        return (
          builder.addExtrudedPolygon({
            id: elInfo.id,
            name: elInfo.name,
            category: elInfo.category,
            outer: [
              [0, 0],
              [lx, 0],
              [lx, ly],
              [0, ly],
            ],
            frame: posT,
            depth: lz,
            storeyId: elInfo.storeyId,
            storeyName: elInfo.storeyName,
            color,
            opacity,
          }).length > 0
        );
      }
      return false;
    }

    if (item.type === 'IFCRIGHTCIRCULARCYLINDER') {
      // IFCRIGHTCIRCULARCYLINDER(Position, Height, Radius)
      const posT = composeTransform(elInfo.worldT, readAxis2Placement3D(asRef(item.args[0])));
      const h = (asNum(item.args[1]) ?? 0) * lengthToMm;
      const r = (asNum(item.args[2]) ?? 0) * lengthToMm;
      if (h > 0 && r > 0) {
        return (
          builder.addExtrudedCircle({
            id: elInfo.id,
            name: elInfo.name,
            category: elInfo.category,
            radius: r,
            frame: posT,
            depth: h,
            storeyId: elInfo.storeyId,
            storeyName: elInfo.storeyName,
            color,
            opacity,
          }).length > 0
        );
      }
      return false;
    }

    if (item.type === 'IFCSPHERE') {
      // IFCSPHERE(Position, Radius)
      const posT = composeTransform(elInfo.worldT, readAxis2Placement3D(asRef(item.args[0])));
      const r = (asNum(item.args[1]) ?? 0) * lengthToMm;
      if (r > 0) {
        return (
          builder.addSphere({
            id: elInfo.id,
            name: elInfo.name,
            category: elInfo.category,
            center: posT.o,
            radius: r,
            storeyId: elInfo.storeyId,
            storeyName: elInfo.storeyName,
            color,
            opacity,
          }).length > 0
        );
      }
      return false;
    }

    // Check tessellated / faceted B-rep representations
    const mesh = extractMeshFromBrepOrFaceSet(itemId, elInfo.worldT);
    if (mesh) {
      return (
        builder.addMeshBody({
          id: elInfo.id,
          name: elInfo.name,
          category: elInfo.category,
          vertices: mesh.vertices,
          indices: mesh.indices,
          placement: elInfo.worldT,
          storeyId: elInfo.storeyId,
          storeyName: elInfo.storeyName,
          color,
          opacity,
        }) !== null
      );
    }

    return false;
  };

  // ---- Walk Building Elements ----
  for (const e of entities.values()) {
    if (!IFC_ELEMENT_TYPES.has(e.type)) continue;
    // Standard IfcProduct layout:
    // (0: GlobalId, 1: OwnerHistory, 2: Name, 3: Description, 4: ObjectType, 5: ObjectPlacement, 6: Representation, 7: Tag)
    const rawName = asStr(e.args[2]) || asStr(e.args[4]) || `${e.type.replace(/^IFC/, '')} #${e.id}`;
    const plId = asRef(e.args[5]);
    const repId = asRef(e.args[6]);
    const worldT = resolveLocalPlacement(plId);
    const storey = findStoreyForElement(e.id, plId, worldT.o[2]);
    const elStyle = styleByItem.get(e.id);
    const defaultLook = defaultAecColor(e.type);

    if (!repId) continue;
    const prodShape = entities.get(repId);
    if (!prodShape) continue;

    // Collect ShapeRepresentations from IfcProductDefinitionShape(Name, Description, Representations)
    const shapeReps =
      prodShape.type === 'IFCPRODUCTDEFINITIONSHAPE'
        ? asRefList(prodShape.args[2])
            .map((id) => entities.get(id))
            .filter((sr): sr is IfcEntity => !!sr && sr.type === 'IFCSHAPEREPRESENTATION')
        : prodShape.type === 'IFCSHAPEREPRESENTATION'
          ? [prodShape]
          : [];

    // Prefer 3D Body / SweptSolid / Tessellation / Brep over 2D Axis / Curve2D / Box
    const bodyReps = shapeReps.filter((sr) => {
      const ident = asStr(sr.args[1]).toUpperCase();
      const rType = asStr(sr.args[2]).toUpperCase();
      return ident !== 'AXIS' && ident !== 'FOOTPRINT' && rType !== 'CURVE2D' && rType !== 'BOUNDINGBOX';
    });
    const chosenReps = bodyReps.length > 0 ? bodyReps : shapeReps;

    let itemIndex = 0;
    let importedAny = false;
    for (const sr of chosenReps) {
      const items = asRefList(sr.args[3]);
      for (const itemId of items) {
        const itemName = items.length > 1 && itemIndex > 0 ? `${rawName} (${itemIndex + 1})` : rawName;
        if (
          processRepresentationItem(itemId, {
            id: `#${e.id}`,
            name: itemName,
            category: e.type,
            worldT,
            storeyId: storey.id,
            storeyName: storey.name,
            color: elStyle?.color ?? defaultLook.color,
            opacity: elStyle?.opacity ?? defaultLook.opacity,
          })
        ) {
          itemIndex++;
          importedAny = true;
        }
      }
      if (importedAny) break;
    }

    if (!importedAny) {
      builder.warn(rawName, 'unsupportedRepresentation', `${e.type} (#${e.id}) had no supported 3D solid or mesh representation`);
    }
  }

  const part = builder.buildPart();
  const storeys = [...builder.storeys.values()].sort((a, b) => a.elevationMm - b.elevationMm);
  const summary = `Imported ${builder.elements.length} IFC element(s) across ${storeys.length || 1} storey(s) (${schemaVersion}, scale ${lengthToMm} mm/unit): ${part.features.length} feature(s), ${builder.meshes.length} mesh body(s).`;

  return {
    name: builder.name,
    format: 'ifc',
    schemaVersion,
    unitScaleToMm: lengthToMm,
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
