// Fusion 360 unit conversion helpers.
// Fusion 360 stores internal linear dimensions in centimetres (cm) and internal angles in radians,
// while CadKit stores all linear dimensions in millimetres (mm) and angles in degrees.

export type FusionUnit = 'cm' | 'mm' | 'm' | 'in' | 'ft' | 'deg' | 'rad' | '';

const LENGTH_SCALE_TO_MM: Record<string, number> = {
  mm: 1,
  millimeter: 1,
  millimeters: 1,
  millimetre: 1,
  millimetres: 1,
  cm: 10,
  centimeter: 10,
  centimeters: 10,
  centimetre: 10,
  centimetres: 10,
  m: 1000,
  meter: 1000,
  meters: 1000,
  metre: 1000,
  metres: 1000,
  in: 25.4,
  inch: 25.4,
  inches: 25.4,
  '"': 25.4,
  ft: 304.8,
  foot: 304.8,
  feet: 304.8,
};

const ANGLE_SCALE_TO_DEG: Record<string, number> = {
  deg: 1,
  degree: 1,
  degrees: 1,
  '°': 1,
  rad: 180 / Math.PI,
  radian: 180 / Math.PI,
  radians: 180 / Math.PI,
};

/** Round floating-point conversion noise (e.g. 2.5 * 10 = 25, 0.3 * 10 = 3). */
export function cleanNum(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}

/** Convert a Fusion 360 internal length (cm) to CadKit millimetres (mm). */
export function cmToMm(cm: number): number {
  return cleanNum(cm * 10);
}

/** Normalize a unit string to a canonical FusionUnit. */
export function normalizeUnit(raw: string | undefined | null): FusionUnit {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s in LENGTH_SCALE_TO_MM) {
    if (s.startsWith('mm') || s.startsWith('millimet')) return 'mm';
    if (s.startsWith('cm') || s.startsWith('centimet')) return 'cm';
    if (s === 'm' || s.startsWith('met')) return 'm';
    if (s === 'in' || s.startsWith('inch') || s === '"') return 'in';
    if (s === 'ft' || s === 'foot' || s === 'feet') return 'ft';
  }
  if (s in ANGLE_SCALE_TO_DEG) {
    if (s.startsWith('rad')) return 'rad';
    return 'deg';
  }
  return '';
}

/** Convert a numeric value with an explicit or default length unit to mm. Defaults to Fusion internal cm. */
export function lengthToMm(value: number, unit?: string | null): number {
  const key = (unit ?? 'cm').trim().toLowerCase();
  const scale = LENGTH_SCALE_TO_MM[key] ?? 10; // Fusion default is cm
  return cleanNum(value * scale);
}

/** Convert a numeric value with an explicit or default angle unit to degrees. Defaults to radians (Fusion internal). */
export function angleToDeg(value: number, unit?: string | null): number {
  const key = (unit ?? 'rad').trim().toLowerCase();
  const scale = ANGLE_SCALE_TO_DEG[key] ?? (180 / Math.PI);
  return cleanNum(value * scale);
}

/** Format a clean number as a compact string for CadKit expressions. */
export function fmtNum(v: number): string {
  return String(cleanNum(v));
}

export interface ConvertedExpr {
  /** CadKit expression string (linear lengths in mm, angles in deg, identifiers preserved). */
  expr: string;
  /** Numeric value in mm (or deg for angular values) when the expression is a simple scalar literal. */
  numeric?: number;
  /** Canonical unit detected or applied. */
  unit: FusionUnit;
}

const SIMPLE_NUM_UNIT = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(mm|cm|m|in|ft|deg|rad|°|")?\s*$/i;
const INLINE_NUM_UNIT = /([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(mm|cm|m|in|ft|deg|rad)\b/gi;

/**
 * Convert a Fusion 360 parameter or feature expression into CadKit's mm / deg expression format.
 * - Bare numeric values use `defaultUnit` (defaulting to `'cm'`, Fusion's internal length unit).
 * - Inline suffixed numbers like `2.5 cm + 5 mm` become `25 + 5`.
 * - Variable references like `width * 2` are preserved intact.
 */
export function convertFusionExpr(raw: string | number, defaultUnit: FusionUnit = 'cm'): ConvertedExpr {
  if (typeof raw === 'number') {
    if (defaultUnit === 'deg' || defaultUnit === 'rad') {
      const deg = angleToDeg(raw, defaultUnit);
      return { expr: fmtNum(deg), numeric: deg, unit: 'deg' };
    }
    if (defaultUnit === '') {
      const n = cleanNum(raw);
      return { expr: fmtNum(n), numeric: n, unit: '' };
    }
    const mm = lengthToMm(raw, defaultUnit);
    return { expr: fmtNum(mm), numeric: mm, unit: 'mm' };
  }

  const trimmed = raw.trim();
  if (!trimmed) return { expr: '0', numeric: 0, unit: defaultUnit || 'mm' };

  const simple = SIMPLE_NUM_UNIT.exec(trimmed);
  if (simple) {
    const num = Number(simple[1]);
    const u = normalizeUnit(simple[2]) || defaultUnit;
    if (u === 'deg' || u === 'rad') {
      const deg = angleToDeg(num, u);
      return { expr: fmtNum(deg), numeric: deg, unit: 'deg' };
    }
    if (u === '') {
      const n = cleanNum(num);
      return { expr: fmtNum(n), numeric: n, unit: '' };
    }
    const mm = lengthToMm(num, u);
    return { expr: fmtNum(mm), numeric: mm, unit: 'mm' };
  }

  // Compound expression: convert any explicit unit literals inline while preserving identifiers.
  let detected: FusionUnit = defaultUnit;
  const converted = trimmed.replace(INLINE_NUM_UNIT, (_m, nStr: string, uStr: string) => {
    const n = Number(nStr);
    const u = normalizeUnit(uStr);
    if (u === 'deg' || u === 'rad') {
      detected = 'deg';
      return fmtNum(angleToDeg(n, u));
    }
    if (u) {
      detected = 'mm';
      return fmtNum(lengthToMm(n, u));
    }
    return nStr;
  });

  return { expr: converted, unit: detected === 'cm' ? 'mm' : detected };
}

/** Sanitize a Fusion 360 parameter name into a safe CadKit variable identifier. */
export function sanitizeVarName(raw: string): string {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!cleaned) return 'param';
  return /^[0-9]/.test(cleaned) ? `p_${cleaned}` : cleaned;
}
