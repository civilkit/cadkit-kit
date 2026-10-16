/** Text for the status bar while sketching: cursor position in the display unit, the delta from the last point, zoom and grid spacing. Pure. */
export type DisplayUnit = 'mm' | 'cm' | 'm' | 'in';
const PER_MM: Record<DisplayUnit, number> = { mm: 1, cm: 0.1, m: 0.001, in: 1 / 25.4 };

/** Digits that make the last shown digit about a tenth of a pixel: 0.1 mm per pixel shows one decimal. */
export function decimalsFor(upp: number, unit: DisplayUnit = 'mm'): number {
  const u = Math.max(upp * PER_MM[unit], 1e-9);
  return Math.min(5, Math.max(0, Math.ceil(-Math.log10(u))));
}

export function formatLen(mm: number, decimals: number, unit: DisplayUnit = 'mm'): string {
  const v = Number((mm * PER_MM[unit]).toFixed(decimals));
  return `${(Object.is(v, -0) ? 0 : v).toFixed(decimals)} ${unit}`;
}

/** '232.1 mm, -5.1 mm' */
export function formatCursor(u: number, v: number, upp: number, unit: DisplayUnit = 'mm'): string {
  const d = decimalsFor(upp, unit);
  return `${formatLen(u, d, unit)}, ${formatLen(v, d, unit)}`;
}

/** 'dx 12.0  dy 3.5  len 12.5  angle 16°' (numbers in the unit, no unit suffix to keep it short). */
export function formatDelta(from: { x: number; y: number }, to: { x: number; y: number }, upp: number, unit: DisplayUnit = 'mm'): string {
  const d = decimalsFor(upp, unit);
  const n = (mm: number) => { const x = Number((mm * PER_MM[unit]).toFixed(d)); return (Object.is(x, -0) ? 0 : x).toFixed(d); };
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const ang = len < 1e-12 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI;
  return `dx ${n(dx)}  dy ${n(dy)}  len ${n(len)}  angle ${Math.round(ang)}°`;
}

/** Screen pixels per CSS inch at 100 % (real size at 96 dpi). */
const PX_PER_MM_100 = 96 / 25.4;
/** Zoom as a percentage of real size at 96 dpi: 100 % when one millimetre is about 3.78 px. */
export function zoomPercent(upp: number): number {
  return Math.round((100 / Math.max(upp, 1e-9) / PX_PER_MM_100));
}
export const formatZoom = (upp: number): string => `${zoomPercent(upp)}%`;

/** '10 mm', '0.5 mm', '1/4 in' is not attempted: decimals only. */
export function formatSpacing(mm: number, unit: DisplayUnit = 'mm'): string {
  const v = mm * PER_MM[unit];
  const s = Number(v.toPrecision(4)).toString();
  return `${s} ${unit}`;
}

/** '12.5 mm, 3.0 mm, -40.2 mm' for the point under the pointer in the 3D view (about 0.1 mm resolution). */
export function formatPoint3(p: readonly [number, number, number], unit: DisplayUnit = 'mm'): string {
  const d = unit === 'in' ? 3 : 1;
  return p.map((v) => formatLen(v, d, unit)).join(', ');
}
