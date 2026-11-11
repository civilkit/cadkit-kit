// The material catalogue of the Material editor: name, category, density (kg/m3), a default display colour and, where
// they are usual, Young's modulus (GPa), Poisson's ratio and yield strength (MPa). A part names its material by name in
// `doc.material`; the density and colour are looked up here (built-in entries, then the custom ones kept in the browser).
// Inspect's mass properties read the density from the same lookup (see inspect/mass.ts, which works in g/cm3).
// The steel grades of the standards (EN 10025-2, EN 10210/10219, ASTM A36/A992/A500/A53/A572, AS/NZS 3679.1) are generated from the verified
// record (materials.steel.json, tools/build_steel_materials.mjs); they add ultimate strength, shear modulus, thermal expansion, standard, grade, region
// and a `verified` flag (false: a value rests on one secondary source or editions disagree; the editor shows an "unverified" badge).
import steelGrades from './materials.steel.json';

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
  /** yield strength, MPa (the lowest value of the grade: for thickness-dependent grades the thinnest band, or a conservative bound) */
  yield?: number;
  /** ultimate (tensile) strength, MPa */
  ultimate?: number;
  /** shear modulus, GPa */
  shear?: number;
  /** thermal expansion, 1e-6 per kelvin */
  expansion?: number;
  /** product standard ("ASTM A992", "EN 10025-2"), grade ("50", "S355"), and where the standard applies (AU, US, EU); set on the grades from standards */
  standard?: string;
  grade?: string;
  region?: Region;
  /** false: the strength rests on one secondary source or the editions of the standard disagree */
  verified?: boolean;
  /** an alternative yield strength recorded next to the stored one (A500 Gr C round: 46 ksi stored, 50 ksi in the 2021 edition), MPa */
  yieldAlt?: number;
  /** where the strengths come from and what they depend on (thickness) */
  note?: string;
  custom?: boolean;
}
export type Region = 'AU' | 'US' | 'EU';
export const MATERIAL_REGIONS: Region[] = ['AU', 'US', 'EU'];

export const CATEGORIES = ['Steel', 'Aluminium', 'Copper alloys', 'Titanium', 'Cast iron', 'Plastics', 'Wood', 'Rubber', 'Glass', 'Concrete', 'Custom'] as const;

const m = (id: string, name: string, category: string, density: number, color: string, youngs?: number, poisson?: number, yld?: number): MaterialDef =>
  ({ id, name, category, density, color, ...(youngs !== undefined ? { youngs } : {}), ...(poisson !== undefined ? { poisson } : {}), ...(yld !== undefined ? { yield: yld } : {}) });

/** A solid wood: density at about 12% moisture, stiffness along the grain, and where the numbers come from. */
const wood = (id: string, name: string, density: number, color: string, youngs: number, species: string, url: string): MaterialDef =>
  ({ ...m(id, name, 'Wood', density, color, youngs), verified: true, note: `${species}: density at about 12% moisture, Young's modulus along the grain. ${url}` });
/** A wood panel: typical values, shown as unverified until each is checked against the product standard. */
const panel = (id: string, name: string, density: number, color: string, youngs: number, note: string): MaterialDef =>
  ({ ...m(id, name, 'Wood', density, color, youngs), verified: false, note });

const GENERIC_MATERIALS: readonly MaterialDef[] = [
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
  // solid woods at about 12% moisture, stiffness along the grain (The Wood Database, from USDA Forest Products Laboratory data)
  wood('birch', 'Birch', 690, '#d9b88a', 13.86, 'Yellow birch, Betula alleghaniensis', 'https://www.wood-database.com/yellow-birch/'),
  wood('cedar', 'Cedar', 370, '#b5764e', 7.66, 'Western red cedar, Thuja plicata', 'https://www.wood-database.com/western-red-cedar/'),
  wood('cherry', 'Cherry', 560, '#b5683f', 10.3, 'Black cherry, Prunus serotina', 'https://www.wood-database.com/black-cherry/'),
  wood('douglas-fir', 'Douglas fir', 510, '#c98f56', 12.17, 'Douglas-fir, Pseudotsuga menziesii', 'https://www.wood-database.com/douglas-fir/'),
  wood('eucalyptus', 'Eucalyptus', 820, '#c9946a', 18.76, 'Blue gum, Eucalyptus globulus', 'https://www.wood-database.com/blue-gum/'),
  wood('maple', 'Maple', 705, '#e6cfa6', 12.62, 'Hard (sugar) maple, Acer saccharum', 'https://www.wood-database.com/hard-maple/'),
  wood('teak', 'Teak', 655, '#a9753f', 12.28, 'Teak, Tectona grandis', 'https://www.wood-database.com/teak/'),
  wood('walnut', 'Walnut', 610, '#5b4030', 11.59, 'Black walnut, Juglans nigra', 'https://www.wood-database.com/black-walnut/'),
  // panels: typical manufacturer values (EN 310 / EN 12369-1 / declarations of performance); marked unverified until checked against the standards
  panel('chipboard-p5', 'Chipboard P5', 650, '#d8be92', 2.4, 'Particleboard P5 (EN 312): bending modulus about 2.4 GPa for 18 mm board (EGGER Eurospan E1 P5 data, EN 310); density is a typical value'),
  panel('osb3', 'OSB/3', 600, '#c9a56b', 3.5, 'OSB/3 (EN 300): mean bending modulus 3.5 GPa along the major axis (EN 310; the EN 12369-1 characteristic value is 4.93 GPa), density the stated minimum (EGGER OSB data)'),
  panel('plywood-birch', 'Plywood - birch', 680, '#e3c79a', 10.05, 'Finnish birch plywood, 18 mm, face grain along the span: mean bending modulus 10.05 GPa, mean density 680 kg/m3 (UPM WISA-Form Birch declaration of performance)'),
  m('rubber', 'Rubber', 'Rubber', 1100, '#2f3236', 0.01, 0.49),
  m('gasket', 'Gasket material', 'Rubber', 1400, '#e8802a', 0.5, 0.45),
  m('glass', 'Glass', 'Glass', 2500, '#bfe3ea', 70, 0.22),
  m('concrete', 'Concrete', 'Concrete', 2400, '#a2a29c', 30, 0.2),
];

/** The steel grades from the standards, after the general steels (they sort in the Steel category). */
const STANDARD_STEELS: MaterialDef[] = (steelGrades.materials as unknown as Array<Record<string, unknown>>).map((g) => ({
  id: g.id as string, name: g.name as string, category: 'Steel', density: g.density as number, color: g.color as string,
  youngs: g.youngs as number, shear: g.shear as number, poisson: g.poisson as number, yield: g.yield as number, ultimate: g.ultimate as number,
  ...(g.expansion !== undefined ? { expansion: g.expansion as number } : {}), standard: g.standard as string, grade: g.grade as string, region: g.region as Region,
  verified: g.verified === true, ...(g.yieldAlt !== undefined ? { yieldAlt: g.yieldAlt as number } : {}), note: g.note as string,
}));
export const BUILTIN_MATERIALS: readonly MaterialDef[] = [...GENERIC_MATERIALS, ...STANDARD_STEELS];

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

/** Filter by a search text (name, category, standard, grade or region; every word must match) and group by category in catalogue order. */
export function groupMaterials(list: MaterialDef[], query: string): Array<{ category: string; items: MaterialDef[] }> {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (x: MaterialDef): boolean => { const hay = [x.name, x.category, x.standard, x.grade, x.region].filter(Boolean).join(' ').toLowerCase(); return words.every((w) => hay.includes(w)); };
  const out: Array<{ category: string; items: MaterialDef[] }> = [];
  for (const category of CATEGORIES) {
    const items = list.filter((x) => x.category === category && hit(x));
    if (items.length) out.push({ category, items });
  }
  return out;
}

/** One category's materials split by where they apply: the general ones, then each region and standard (AU, US, EU) in catalogue order. */
export function subgroups(items: MaterialDef[]): Array<{ key: string; region?: Region; standard?: string; items: MaterialDef[] }> {
  const out: Array<{ key: string; region?: Region; standard?: string; items: MaterialDef[] }> = [];
  const at = (key: string, region?: Region, standard?: string) => { let g = out.find((x) => x.key === key); if (!g) { g = { key, ...(region ? { region } : {}), ...(standard ? { standard } : {}), items: [] }; out.push(g); } return g; };
  for (const x of items) (x.region && x.standard ? at(x.region + '|' + x.standard, x.region, x.standard) : at('general')).items.push(x);
  const rank = (g: { region?: Region }): number => (g.region ? MATERIAL_REGIONS.indexOf(g.region) + 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Mass in grams of a volume in mm3 at a density in kg/m3. */
export const massGrams = (volumeMm3: number, density: number): number => volumeMm3 * density * 1e-6;

export function loadUseColour(): boolean {
  try { return localStorage.getItem(COLOUR_KEY) !== '0'; } catch { return true; }
}
export function saveUseColour(on: boolean): void {
  try { localStorage.setItem(COLOUR_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}

import { displayColor, materialParams, type Appearance, type MaterialPreset } from '@kit/viewport';

/** How a material looks: metals shine, plastics are glossy, wood and rubber are matte, glass is clear. */
export function finishOf(def: MaterialDef | null): MaterialPreset {
  if (!def) return 'default';
  switch (def.category) {
    case 'Steel': case 'Aluminium': case 'Titanium': case 'Cast iron': return 'default';
    case 'Copper alloys': return 'brushed';
    case 'Plastics': return 'plastic';
    case 'Glass': return 'glass';
    case 'Wood': case 'Rubber': case 'Concrete': return 'matte';
    default: return 'default';
  }
}

/** A colour scaled towards black by `k` (0..1 keeps that fraction of each channel), as #rrggbb. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k).toString(16).padStart(2, '0'));
  return '#' + c.join('');
}

/** The appearance a material gives a part or component (colour lifted a little for metals so it does not read dark), or null when unknown. */
export function appearanceOfMaterial(name: string | undefined | null, custom?: MaterialDef[]): Appearance | null {
  const def = findMaterial(name, custom);
  if (!def) return null;
  const material = finishOf(def);
  // woods are a little more satin than the matte preset, with a hint of sheen on the clear-finished species
  const wood = def.category === 'Wood';
  const pbr = wood ? { roughness: 0.6 } : undefined;
  // and grain: growth rings in a darker tone of the wood's own colour (panels without a grain, MDF and chipboard, stay plain)
  const grain = wood && !/MDF|Chipboard|OSB/i.test(def.name) ? { kind: 'wood' as const, tone: shade(def.color, 0.55), contrast: 0.55 } : undefined;
  return { color: displayColor(def.color, materialParams(material).metalness), material, ...(pbr ? { pbr } : {}), ...(grain ? { look: grain } : {}) };
}
