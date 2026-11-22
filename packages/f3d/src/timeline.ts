// Fusion 360 user parameters and parametric feature timeline parser -> CadKit PartDoc features & variables.
// Converts Fusion 360 internal centimetres (cm) to CadKit millimetres (mm) and radians to degrees.

import { convertFusionExpr, lengthToMm, angleToDeg, normalizeUnit, sanitizeVarName, type FusionUnit } from './units';

export interface F3dWarning {
  object: string;
  code: string;
  message: string;
}

export interface F3dStep {
  f3d: string;
  type: string;
  features: string[];
}

export interface F3dParameter {
  name: string;
  rawExpr: string;
  expr: string;
  unit: string;
  comment?: string;
}

export interface TimelineParseContext {
  nextId: () => string;
  features: Array<Record<string, unknown>>;
  steps: F3dStep[];
  skipped: string[];
  warnings: F3dWarning[];
  parameters: F3dParameter[];
  seenVarNames: Set<string>;
  sketchIdByRef: Map<string, string>;
  /** Prefix applied to feature/variable names when merging designs inside a .f3z assembly. */
  namePrefix?: string;
  /** Default length unit for bare numeric values (Fusion 360 internal default is 'cm'). */
  defaultLengthUnit: FusionUnit;
}

type JsonObj = Record<string, unknown>;

const isObj = (v: unknown): v is JsonObj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

function prefixed(name: string, prefix?: string): string {
  return prefix ? `${prefix}_${name}` : name;
}

function addParameter(
  ctx: TimelineParseContext,
  rawName: string,
  rawExprOrVal: string | number,
  rawUnit?: string,
  comment?: string,
): void {
  const baseName = sanitizeVarName(rawName);
  const name = ctx.namePrefix ? sanitizeVarName(`${ctx.namePrefix}_${baseName}`) : baseName;
  if (ctx.seenVarNames.has(name)) return;
  ctx.seenVarNames.add(name);

  const unitHint = normalizeUnit(rawUnit) || ctx.defaultLengthUnit;
  const converted = convertFusionExpr(rawExprOrVal, unitHint);
  ctx.parameters.push({
    name,
    rawExpr: String(rawExprOrVal),
    expr: converted.expr,
    unit: converted.unit || 'mm',
    ...(comment ? { comment } : {}),
  });
}

/** Extract user parameters from a JSON object or array (Parameters.json, Manifest.dat, Design.json). */
export function extractParametersFromJson(json: unknown, ctx: TimelineParseContext): void {
  let list: unknown = null;
  if (Array.isArray(json)) {
    list = json;
  } else if (isObj(json)) {
    list = json.userParameters ?? json.parameters ?? (isObj(json.design) ? (json.design.userParameters ?? json.design.parameters) : null);
  }
  if (!list) return;

  if (Array.isArray(list)) {
    for (const item of list) {
      if (!isObj(item)) continue;
      const name = str(item.name ?? item.Name ?? item.id);
      if (!name) continue;
      const expr = item.expression ?? item.Expression ?? item.formula ?? item.value ?? item.Value;
      if (typeof expr !== 'string' && typeof expr !== 'number') continue;
      const unit = str(item.unit ?? item.Unit ?? item.units);
      const comment = str(item.comment ?? item.Comment ?? item.description);
      addParameter(ctx, name, expr, unit || undefined, comment || undefined);
    }
  } else if (isObj(list)) {
    for (const [k, v] of Object.entries(list)) {
      if (typeof v === 'string' || typeof v === 'number') {
        addParameter(ctx, k, v);
      } else if (isObj(v)) {
        const expr = v.expression ?? v.value;
        if (typeof expr === 'string' || typeof expr === 'number') {
          addParameter(ctx, k, expr, str(v.unit ?? v.units) || undefined, str(v.comment) || undefined);
        }
      }
    }
  }
}

/** Extract user parameters from XML (`<Parameter name="..." expression="..." unit="..." />`). */
export function extractParametersFromXml(xml: string, ctx: TimelineParseContext): void {
  const re = /<(?:UserParameter|Parameter)\b([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] ?? '';
    const getAttr = (k: string) => {
      const am = new RegExp(`\\b${k}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs);
      return am?.[1]?.trim() ?? '';
    };
    const name = getAttr('name');
    const expr = getAttr('expression') || getAttr('value');
    if (!name || !expr) continue;
    addParameter(ctx, name, expr, getAttr('unit') || undefined, getAttr('comment') || undefined);
  }
}

const PLANE_MAP: Record<string, 'front' | 'top' | 'right'> = {
  xy: 'front',
  xy_plane: 'front',
  xyconstructionplane: 'front',
  front: 'front',
  xz: 'top',
  xz_plane: 'top',
  xzconstructionplane: 'top',
  top: 'top',
  yz: 'right',
  yz_plane: 'right',
  yzconstructionplane: 'right',
  right: 'right',
};

function resolvePlane(raw: unknown, ctx: TimelineParseContext, defaultUnit: FusionUnit): { plane: Record<string, unknown>; planeFeatId?: string } {
  let planeName = 'xy';
  let offsetMm = 0;

  if (typeof raw === 'string') {
    planeName = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  } else if (isObj(raw)) {
    planeName = str(raw.name ?? raw.plane ?? raw.base ?? 'xy').toLowerCase().replace(/[\s-]+/g, '_');
    const offUnit = normalizeUnit(str(raw.unit ?? raw.units)) || defaultUnit;
    const rawOff = raw.offset ?? raw.distance;
    if (typeof rawOff === 'number') offsetMm = lengthToMm(rawOff, offUnit);
    else if (typeof rawOff === 'string') offsetMm = convertFusionExpr(rawOff, offUnit).numeric ?? 0;
  }

  const std = PLANE_MAP[planeName] ?? 'front';
  if (Math.abs(offsetMm) > 1e-6) {
    const pid = ctx.nextId();
    ctx.features.push({
      type: 'plane',
      id: pid,
      mode: 'offset',
      base: { kind: 'std', id: std },
      offset: offsetMm,
    });
    return { plane: { kind: 'feature', id: pid }, planeFeatId: pid };
  }
  return { plane: { kind: 'std', id: std } };
}

function mapOperation(raw: string): 'new' | 'add' | 'cut' | 'intersect' {
  const s = raw.trim().toLowerCase();
  if (s.includes('cut')) return 'cut';
  if (s.includes('intersect')) return 'intersect';
  if (s.includes('join') || s === 'add' || s === 'union') return 'add';
  return 'new';
}

function mapSketchFeature(item: JsonObj, ctx: TimelineParseContext): void {
  const rawName = str(item.name ?? item.Name ?? item.id) || 'Sketch';
  const featName = prefixed(rawName, ctx.namePrefix);
  const sketchUnit = normalizeUnit(str(item.unit ?? item.units)) || ctx.defaultLengthUnit;
  const toMm = (v: number) => lengthToMm(v, sketchUnit);

  const { plane, planeFeatId } = resolvePlane(item.plane ?? item.referencePlane ?? 'XY', ctx, sketchUnit);
  const points: Array<Record<string, unknown>> = [{ id: 'O', x: 0, y: 0, fixed: true }];
  const entities: Array<Record<string, unknown>> = [];
  const endpoints: Array<{ id: string; x: number; y: number }> = [];
  let pn = 0;
  let en = 0;

  const addPoint = (x: number, y: number, merge: boolean): string => {
    if (merge) {
      const hit = endpoints.find((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);
      if (hit) return hit.id;
    }
    const id = `p${++pn}`;
    points.push({ id, x, y });
    if (merge) endpoints.push({ id, x, y });
    return id;
  };

  const rawEntities = Array.isArray(item.entities)
    ? item.entities
    : Array.isArray(item.curves)
      ? item.curves
      : Array.isArray(item.geometry)
        ? item.geometry
        : [];

  for (const rawE of rawEntities) {
    if (!isObj(rawE)) continue;
    const et = str(rawE.type ?? rawE.kind).toLowerCase();
    const construction = rawE.construction === true || rawE.isConstruction === true;
    const extra = construction ? { construction: true } : {};

    if (et === 'line' || et === 'sketchline') {
      const x1 = num(rawE.x1 ?? (Array.isArray(rawE.start) ? rawE.start[0] : isObj(rawE.start) ? rawE.start.x : undefined));
      const y1 = num(rawE.y1 ?? (Array.isArray(rawE.start) ? rawE.start[1] : isObj(rawE.start) ? rawE.start.y : undefined));
      const x2 = num(rawE.x2 ?? (Array.isArray(rawE.end) ? rawE.end[0] : isObj(rawE.end) ? rawE.end.x : undefined));
      const y2 = num(rawE.y2 ?? (Array.isArray(rawE.end) ? rawE.end[1] : isObj(rawE.end) ? rawE.end.y : undefined));
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) continue;
      entities.push({
        type: 'line',
        id: `e${++en}`,
        p1: addPoint(toMm(x1), toMm(y1), true),
        p2: addPoint(toMm(x2), toMm(y2), true),
        ...extra,
      });
    } else if (et === 'circle' || et === 'sketchcircle') {
      const cx = num(rawE.cx ?? (Array.isArray(rawE.center) ? rawE.center[0] : isObj(rawE.center) ? rawE.center.x : 0)) ?? 0;
      const cy = num(rawE.cy ?? (Array.isArray(rawE.center) ? rawE.center[1] : isObj(rawE.center) ? rawE.center.y : 0)) ?? 0;
      const r = num(rawE.r ?? rawE.radius);
      if (r === undefined || r <= 0) continue;
      entities.push({
        type: 'circle',
        id: `e${++en}`,
        c: addPoint(toMm(cx), toMm(cy), false),
        r: toMm(r),
        ...extra,
      });
    } else if (et === 'rectangle' || et === 'rect') {
      const x = num(rawE.x ?? rawE.x1 ?? 0) ?? 0;
      const y = num(rawE.y ?? rawE.y1 ?? 0) ?? 0;
      const w = num(rawE.width ?? rawE.w);
      const h = num(rawE.height ?? rawE.h);
      if (w === undefined || h === undefined || w === 0 || h === 0) continue;
      const x1 = toMm(x), y1 = toMm(y), x2 = toMm(x + w), y2 = toMm(y + h);
      const p1 = addPoint(x1, y1, true);
      const p2 = addPoint(x2, y1, true);
      const p3 = addPoint(x2, y2, true);
      const p4 = addPoint(x1, y2, true);
      entities.push({ type: 'line', id: `e${++en}`, p1, p2, ...extra });
      entities.push({ type: 'line', id: `e${++en}`, p1: p2, p2: p3, ...extra });
      entities.push({ type: 'line', id: `e${++en}`, p1: p3, p2: p4, ...extra });
      entities.push({ type: 'line', id: `e${++en}`, p1: p4, p2: p1, ...extra });
    } else if (et === 'arc' || et === 'sketcharc') {
      const cx = num(rawE.cx ?? (Array.isArray(rawE.center) ? rawE.center[0] : isObj(rawE.center) ? rawE.center.x : undefined));
      const cy = num(rawE.cy ?? (Array.isArray(rawE.center) ? rawE.center[1] : isObj(rawE.center) ? rawE.center.y : undefined));
      const r = num(rawE.r ?? rawE.radius);
      const a1 = num(rawE.startAngle);
      const a2 = num(rawE.endAngle);
      if (cx === undefined || cy === undefined || r === undefined || r <= 0 || a1 === undefined || a2 === undefined) continue;
      const sx = cx + r * Math.cos(a1);
      const sy = cy + r * Math.sin(a1);
      const ex = cx + r * Math.cos(a2);
      const ey = cy + r * Math.sin(a2);
      entities.push({
        type: 'arc',
        id: `e${++en}`,
        c: addPoint(toMm(cx), toMm(cy), false),
        p1: addPoint(toMm(sx), toMm(sy), true),
        p2: addPoint(toMm(ex), toMm(ey), true),
        ...extra,
      });
    } else if (et === 'point' || et === 'sketchpoint') {
      const px = num(rawE.x);
      const py = num(rawE.y);
      if (px === undefined || py === undefined) continue;
      entities.push({
        type: 'point',
        id: `e${++en}`,
        p: addPoint(toMm(px), toMm(py), false),
      });
    }
  }

  const sid = ctx.nextId();
  ctx.features.push({
    type: 'sketch',
    id: sid,
    name: featName,
    plane,
    points,
    entities,
    constraints: [],
  });

  // Register lookup keys so downstream Extrude/Revolve features can reference this sketch by name or id.
  ctx.sketchIdByRef.set(rawName, sid);
  ctx.sketchIdByRef.set(featName, sid);
  const rawId = str(item.id);
  if (rawId) ctx.sketchIdByRef.set(rawId, sid);

  const created = planeFeatId ? [planeFeatId, sid] : [sid];
  ctx.steps.push({ f3d: featName, type: 'Sketch', features: created });
}

function mapExtrudeFeature(item: JsonObj, ctx: TimelineParseContext): void {
  const rawName = str(item.name ?? item.Name ?? item.id) || 'Extrude';
  const featName = prefixed(rawName, ctx.namePrefix);
  const sketchRef = str(item.sketch ?? item.profile ?? item.sketchName ?? item.sketchId);
  const sketchId = ctx.sketchIdByRef.get(sketchRef) ?? (ctx.namePrefix ? ctx.sketchIdByRef.get(prefixed(sketchRef, ctx.namePrefix)) : undefined);
  if (!sketchId) {
    ctx.skipped.push(featName);
    ctx.warnings.push({
      object: featName,
      code: 'missingSketch',
      message: `extrude references sketch "${sketchRef || '(none)'}" which was not found in the timeline`,
    });
    return;
  }

  const unit = normalizeUnit(str(item.unit ?? item.units)) || ctx.defaultLengthUnit;
  const rawDepth = item.depth ?? item.distance ?? item.extentDistance ?? 1;
  const conv = convertFusionExpr(typeof rawDepth === 'string' || typeof rawDepth === 'number' ? rawDepth : 1, unit);
  const depth: number | string = conv.numeric !== undefined ? Math.abs(conv.numeric) : conv.expr;
  const flip = (conv.numeric !== undefined && conv.numeric < 0) || item.flip === true;
  const extent = str(item.extent ?? item.extentType ?? item.end).toLowerCase();
  const end = extent.includes('sym') || extent === 'mid' ? 'mid' : extent.includes('all') || extent.includes('through') ? 'throughAll' : 'blind';
  const op = mapOperation(str(item.operation ?? item.op ?? 'new'));

  const id = ctx.nextId();
  ctx.features.push({
    type: 'extrude',
    id,
    name: featName,
    op,
    sketch: sketchId,
    end,
    depth,
    ...(flip ? { flip: true } : {}),
  });
  ctx.steps.push({ f3d: featName, type: 'Extrude', features: [id] });
}

function mapRevolveFeature(item: JsonObj, ctx: TimelineParseContext): void {
  const rawName = str(item.name ?? item.Name ?? item.id) || 'Revolve';
  const featName = prefixed(rawName, ctx.namePrefix);
  const sketchRef = str(item.sketch ?? item.profile ?? item.sketchName ?? item.sketchId);
  const sketchId = ctx.sketchIdByRef.get(sketchRef) ?? (ctx.namePrefix ? ctx.sketchIdByRef.get(prefixed(sketchRef, ctx.namePrefix)) : undefined);
  if (!sketchId) {
    ctx.skipped.push(featName);
    ctx.warnings.push({
      object: featName,
      code: 'missingSketch',
      message: `revolve references sketch "${sketchRef || '(none)'}" which was not found in the timeline`,
    });
    return;
  }

  const angleUnit = normalizeUnit(str(item.angleUnit ?? item.unit)) || 'rad';
  const rawAngle = item.angle ?? Math.PI * 2;
  let angle: number | string = 360;
  if (typeof rawAngle === 'number') {
    angle = angleToDeg(rawAngle, angleUnit);
  } else if (typeof rawAngle === 'string') {
    const conv = convertFusionExpr(rawAngle, angleUnit);
    angle = conv.numeric !== undefined ? conv.numeric : conv.expr;
  }

  const axis = str(item.axis ?? 'Y') || 'Y';
  const op = mapOperation(str(item.operation ?? item.op ?? 'new'));
  const id = ctx.nextId();
  ctx.features.push({
    type: 'revolve',
    id,
    name: featName,
    op,
    sketch: sketchId,
    axis,
    angle,
  });
  ctx.steps.push({ f3d: featName, type: 'Revolve', features: [id] });
}

function mapFilletOrChamfer(kind: 'fillet' | 'chamfer', item: JsonObj, ctx: TimelineParseContext): void {
  const rawName = str(item.name ?? item.Name ?? item.id) || (kind === 'fillet' ? 'Fillet' : 'Chamfer');
  const featName = prefixed(rawName, ctx.namePrefix);
  const unit = normalizeUnit(str(item.unit ?? item.units)) || ctx.defaultLengthUnit;
  const rawSize = kind === 'fillet' ? (item.radius ?? item.value ?? 0.2) : (item.distance ?? item.size ?? item.value ?? 0.2);
  const conv = convertFusionExpr(typeof rawSize === 'string' || typeof rawSize === 'number' ? rawSize : 0.2, unit);
  const size: number | string = conv.numeric !== undefined ? Math.abs(conv.numeric) : conv.expr;
  const edges = Array.isArray(item.edges) ? item.edges.filter((e): e is string => typeof e === 'string' && e.length > 0) : [];

  const id = ctx.nextId();
  const suppressed = edges.length === 0;
  ctx.features.push({
    type: kind,
    id,
    name: featName,
    ...(kind === 'fillet' ? { radius: size } : { distance: size }),
    edges,
    ...(suppressed ? { suppressed: true } : {}),
  });
  ctx.steps.push({ f3d: featName, type: kind === 'fillet' ? 'Fillet' : 'Chamfer', features: [id] });

  if (suppressed) {
    ctx.warnings.push({
      object: featName,
      code: 'unresolvedEdges',
      message: `${kind} edges from Fusion 360 could not be resolved automatically; feature kept suppressed in the tree`,
    });
  }
}

/** Parse a timeline/features array from a JSON object into CadKit features. */
export function extractTimelineFromJson(json: unknown, ctx: TimelineParseContext): void {
  let list: unknown = null;
  if (isObj(json)) {
    list = json.timeline ?? json.features ?? (isObj(json.design) ? (json.design.timeline ?? json.design.features) : null);
  }
  if (!Array.isArray(list)) return;

  for (const item of list) {
    if (!isObj(item)) continue;
    const rawType = str(item.type ?? item.featureType ?? item.kind);
    const normType = rawType.toLowerCase().replace(/[^a-z0-9]/g, '');
    const rawName = str(item.name ?? item.Name ?? item.id) || rawType || 'Feature';

    if (normType === 'sketch' || normType === 'sketchfeature') {
      mapSketchFeature(item, ctx);
    } else if (normType === 'extrude' || normType === 'extrudefeature') {
      mapExtrudeFeature(item, ctx);
    } else if (normType === 'revolve' || normType === 'revolvefeature') {
      mapRevolveFeature(item, ctx);
    } else if (normType === 'fillet' || normType === 'filletfeature') {
      mapFilletOrChamfer('fillet', item, ctx);
    } else if (normType === 'chamfer' || normType === 'chamferfeature') {
      mapFilletOrChamfer('chamfer', item, ctx);
    } else {
      const featName = prefixed(rawName, ctx.namePrefix);
      ctx.skipped.push(featName);
      ctx.warnings.push({
        object: featName,
        code: 'unsupportedFeature',
        message: `Fusion 360 feature type "${rawType || 'unknown'}" is not mapped to native history`,
      });
    }
  }
}
