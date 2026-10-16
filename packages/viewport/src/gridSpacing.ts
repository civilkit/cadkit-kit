/**
 * Adaptive grid: the minor spacing subdivides and merges with the zoom so neighbouring lines stay 8 to 80 px apart,
 * with every 5th or 10th line stronger. Pure; plane units per pixel in, spacing in plane units out.
 */
export const GRID_MIN_PX = 8;
export const GRID_MAX_PX = 80;

export interface GridSpec { minor: number; /** every nth minor line is a major line */ majorEvery: 5 | 10; major: number }

/** Nice steps 1, 2, 5 times a power of ten within [minPx, maxPx] of `upp` (plane units per pixel); the smallest fitting one, so lines are as dense as allowed up to ~20 px. */
export function niceStep(upp: number, targetPx = 20): number {
  const raw = Math.max(upp, 1e-9) * targetPx;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}

/**
 * The grid for the current zoom. `base` is the user's grid spacing (plane units, > 0), or 0/undefined for automatic.
 * With a base, the spacing is base times 1, 2, 5, 10 ... or base divided likewise: the nearest of those that puts the
 * lines 8 to 80 px apart, preferring about 20 px.
 */
export function adaptiveGrid(upp: number, base = 0): GridSpec {
  const u = Math.max(upp, 1e-9);
  let minor: number;
  // automatic: whole millimetres as soon as 1 mm is at least 8 px (and still under 80 px), so the snap step is 1 mm without setting it by hand
  if (!(base > 0)) minor = 1 / u >= GRID_MIN_PX && 1 / u <= GRID_MAX_PX ? 1 : niceStep(u);
  else {
    // candidates: base * (1|2|5) * 10^n, keep the ones within range, pick the closest to 20 px
    const cands: number[] = [];
    for (let n = -8; n <= 8; n++) for (const m of [1, 2, 5]) cands.push(base * m * 10 ** n);
    const fit = cands.filter((c) => c / u >= GRID_MIN_PX && c / u <= GRID_MAX_PX);
    const pool = fit.length ? fit : cands;
    minor = pool.reduce((b, c) => (Math.abs(Math.log(c / u / 20)) < Math.abs(Math.log(b / u / 20)) ? c : b));
  }
  // the 1-2-5 sequence: after a 2 the major lines are every 5th (10, 50 ...), otherwise every 5th also; powers of ten use every 10th
  const lead = minor / 10 ** Math.floor(Math.log10(minor) + 1e-9);
  const majorEvery: 5 | 10 = Math.abs(lead - 1) < 1e-6 && base <= 0 ? 10 : 5;
  return { minor, majorEvery, major: minor * majorEvery };
}

/** Parse a typed grid spacing ('2.5', '0.25 in', '5mm') into plane units (mm); null when it is not a positive number. */
export function parseSpacing(text: string): number | null {
  const m = /^\s*([0-9]*\.?[0-9]+(?:e[+-]?\d+)?)\s*(mm|cm|m|in)?\s*$/i.exec(text);
  if (!m) return null;
  const f = { mm: 1, cm: 10, m: 1000, in: 25.4 }[(m[2] ?? 'mm').toLowerCase() as 'mm'];
  const v = parseFloat(m[1]) * f;
  return v > 0 && Number.isFinite(v) ? v : null;
}
