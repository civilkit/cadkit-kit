// The material catalogue of the Material editor: name, category, density (kg/m3), a default display colour and, where
// they are usual, Young's modulus (GPa), Poisson's ratio and yield strength (MPa). A part names its material by name in
// `doc.material`; the density and colour are looked up here (built-in entries, then the custom ones kept in the browser).
// Inspect's mass properties read the density from the same lookup (see inspect/mass.ts, which works in g/cm3).

export interface MaterialDef {
  id: string;
  name: string;
  category: string;
  /** kg/m3 */
  density: number;
  /** default display colour, #rrggbb */
  color: string;
  /** Young's modulus, GPa */
  youngs?: number;
  poisson?: number;
  /** yield strength, MPa */
  yield?: number;
  custom?: boolean;
}

export const CATEGORIES = ['Steel', 'Aluminium', 'Copper alloys', 'Titanium', 'Cast iron', 'Plastics', 'Wood', 'Rubber', 'Glass', 'Concrete', 'Custom'] as const;

const m = (id: string, name: string, category: string, density: number, color: string, youngs?: number, poisson?: number, yld?: number): MaterialDef =>
  ({ id, name, category, density, color, ...(youngs !== undefined ? { youngs } : {}), ...(poisson !== undefined ? { poisson } : {}), ...(yld !== undefined ? { yield: yld } : {}) });

export const BUILTIN_MATERIALS: readonly MaterialDef[] = [
  m('steel-mild', 'Mild steel', 'Steel', 7850, '#8d97a5', 205, 0.29, 250),
  m('steel-304', 'Stainless steel 304', 'Steel', 8000, '#c3c9d1', 193, 0.29, 215),
  m('steel-316', 'Stainless steel 316', 'Steel', 8000, '#bcc3cc', 193, 0.3, 205),
  m('steel-tool', 'Tool steel', 'Steel', 7800, '#6f7782', 210, 0.3, 1500),
  m('al-6061', 'Aluminium 6061', 'Aluminium', 2700, '#c9d0d8', 68.9, 0.33, 276),
  m('al-7075', 'Aluminium 7075', 'Aluminium', 2810, '#bfc7d1', 71.7, 0.33, 503),
  m('copper', 'Copper', 'Copper alloys', 8960, '#c8774a', 117, 0.34, 70),
  m('brass', 'Brass', 'Copper alloys', 8500, '#d3b04c', 100, 0.34, 200),
  m('bronze', 'Bronze', 'Copper alloys', 8800, '#a8742f', 110, 0.34, 150),
  m('titanium', 'Titanium Ti-6Al-4V', 'Titanium', 4430, '#a7adb5', 114, 0.34, 880),
  m('cast-iron', 'Cast iron', 'Cast iron', 7200, '#5f656c', 110, 0.26, 130),
  m('abs', 'ABS', 'Plastics', 1040, '#e6e0cf', 2.3, 0.35, 40),
  m('pla', 'PLA', 'Plastics', 1240, '#e8e4d8', 3.5, 0.36, 60),
  m('petg', 'PETG', 'Plastics', 1270, '#a9d3e0', 2.1, 0.4, 50),
  m('nylon', 'Nylon', 'Plastics', 1150, '#ece8dc', 2.7, 0.39, 70),
  m('polycarbonate', 'Polycarbonate', 'Plastics', 1200, '#cfe3ea', 2.4, 0.37, 62),
  m('acetal', 'Acetal (POM)', 'Plastics', 1410, '#f1f1ec', 3.1, 0.35, 66),
  m('peek', 'PEEK', 'Plastics', 1320, '#c9b79c', 3.6, 0.4, 100),
  m('oak', 'Oak', 'Wood', 750, '#b98b52', 11, 0.35),
  m('pine', 'Pine', 'Wood', 500, '#d8b27a', 9, 0.3),
  m('mdf', 'MDF', 'Wood', 750, '#b79a76', 3.5),
  m('rubber', 'Rubber', 'Rubber', 1100, '#2f3236', 0.01, 0.49),
  m('glass', 'Glass', 'Glass', 2500, '#bfe3ea', 70, 0.22),
  m('concrete', 'Concrete', 'Concrete', 2400, '#a2a29c', 30, 0.2),
];

/** Names the part files and the older Inspect table used, matched ignoring case: they resolve to the entry here. */
const ALIASES: Record<string, string> = {
  steel: 'steel-mild', 'stainless steel': 'steel-304', stainless: 'steel-304', iron: 'cast-iron', aluminium: 'al-6061', aluminum: 'al-6061',
  pc: 'polycarbonate', pom: 'acetal', 'ti-6al-4v': 'titanium', 'tool-steel': 'steel-tool',
};

export const CUSTOM_KEY = 'cad.materials.custom';
export const COLOUR_KEY = 'cad.materials.useColour';

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const posNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/** A stored custom material, or null when it is not usable (a stale or hand-edited value never breaks the editor). */
export function sanitizeCustom(raw: unknown): MaterialDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 60) : '';
  const density = posNum(r.density);
  if (!name || density === undefined) return null;
  const out: MaterialDef = { id: 'custom:' + name.toLowerCase(), name, category: 'Custom', density, color: isHex(r.color) ? r.color.toLowerCase() : '#b8c4d6', custom: true };
  const y = posNum(r.youngs), p = posNum(r.poisson), s = posNum(r.yield);
  if (y !== undefined) out.youngs = y;
  if (p !== undefined && p < 0.5) out.poisson = p;
  if (s !== undefined) out.yield = s;
  return out;
}

export function loadCustom(): MaterialDef[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: MaterialDef[] = [];
    for (const r of raw) { const c = sanitizeCustom(r); if (c && !seen.has(c.id) && !BUILTIN_MATERIALS.some((b) => b.name.toLowerCase() === c.name.toLowerCase())) { seen.add(c.id); out.push(c); } }
    return out;
  } catch { return []; }
}

export function saveCustom(list: MaterialDef[]): void {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list.filter((x) => x.custom))); } catch { /* storage blocked: the list lasts for the session only */ }
}

/** Add or replace a custom material by name; returns the new list (and stores it). */
export function upsertCustom(def: unknown): MaterialDef[] {
  const c = sanitizeCustom(def);
  const cur = loadCustom();
  if (!c) return cur;
  const next = [...cur.filter((x) => x.id !== c.id), c];
  saveCustom(next);
  return next;
}

export function removeCustom(id: string): MaterialDef[] {
  const next = loadCustom().filter((x) => x.id !== id);
  saveCustom(next);
  return next;
}

export const allMaterials = (custom: MaterialDef[] = loadCustom()): MaterialDef[] => [...BUILTIN_MATERIALS, ...custom];

/** The catalogue entry a part's `material` string names (by name, id or an old alias, ignoring case), or null. */
export function findMaterial(name: string | undefined | null, custom?: MaterialDef[]): MaterialDef | null {
  const k = (name ?? '').trim().toLowerCase();
  if (!k) return null;
  const list = allMaterials(custom);
  return list.find((x) => x.name.toLowerCase() === k) ?? list.find((x) => x.id === k) ?? list.find((x) => x.id === ALIASES[k]) ?? null;
}

/** Density in g/cm3 (what Inspect works in) of a named material, or null when it is not known. */
export function densityGcm3(name: string | undefined | null): number | null {
  const d = findMaterial(name)?.density;
  return d === undefined ? null : d / 1000;
}

/** Filter by a search text (name or category, every word must match) and group by category in catalogue order. */
export function groupMaterials(list: MaterialDef[], query: string): Array<{ category: string; items: MaterialDef[] }> {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (x: MaterialDef): boolean => words.every((w) => x.name.toLowerCase().includes(w) || x.category.toLowerCase().includes(w));
  const out: Array<{ category: string; items: MaterialDef[] }> = [];
  for (const category of CATEGORIES) {
    const items = list.filter((x) => x.category === category && hit(x));
    if (items.length) out.push({ category, items });
  }
  return out;
}

/** Mass in grams of a volume in mm3 at a density in kg/m3. */
export const massGrams = (volumeMm3: number, density: number): number => volumeMm3 * density * 1e-6;

export function loadUseColour(): boolean {
  try { return localStorage.getItem(COLOUR_KEY) !== '0'; } catch { return true; }
}
export function saveUseColour(on: boolean): void {
  try { localStorage.setItem(COLOUR_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}
