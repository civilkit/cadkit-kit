// The user's own frame stock and hardware: a JSON library (same shapes as profiles.json: `profiles`, `fittings`, `materials`) checked with
// errors that say where the problem is, kept in the browser's storage, and copied into each frame feature that uses it (`library`), so a
// shared file still opens and prices correctly on a machine that never imported the library.
import { BUILTIN_FITTINGS, BUILTIN_MATERIALS, BUILTIN_PROFILES, FITTINGS, MATERIALS, PROFILES, extendLibrary, type FittingDef, type MaterialDef, type ProfileDef } from './frameLib';

export interface UserLibrary { profiles?: ProfileDef[]; fittings?: Record<string, FittingDef>; materials?: Record<string, MaterialDef> }
export type Checked = { ok: true; lib: UserLibrary; summary: { profiles: number; fittings: number; materials: number } } | { ok: false; errors: string[] };


const STORE_KEY = 'ck.frame.userlib';
/** Required dimensions of each section kind the kernel builds (see features/frame.rs). */
const SECTION_DIMS: Record<string, string[]> = { rect: ['w'], rectTube: ['w', 't'], roundTube: ['d', 't'], roundBar: ['d'], angle: ['w', 't'], channel: ['w'], ibeam: ['w', 'h', 'tf', 'tw'], tslot: ['s'] };
const PART_KINDS = ['lbracket', 'gusset', 'corner3', 'cap', 'foot'];
const PLACE_KINDS: Record<string, string[]> = { joint: ['lbracket', 'gusset'], corner3: ['corner3'], cap: ['cap'], foot: ['foot'] };
const PART_DIMS: Record<string, string[]> = { lbracket: ['arm', 't', 'w', 'hole', 'holeAt'], gusset: ['leg', 't'], corner3: ['block', 'arm', 't', 'w', 'hole', 'holeAt'], cap: ['t'], foot: ['base', 'baseH', 'studD', 'studLen'] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPos = (v: unknown): v is number => isNum(v) && v > 0;

/** Check a library given as parsed JSON. Every problem is listed with its path; nothing is half-installed. References may point at the built-in library or inside this one. */
export function validateLibrary(raw: unknown): Checked {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['the file must be a JSON object with `profiles`, `fittings` and/or `materials`'] };
  for (const k of Object.keys(raw)) if (!['version', 'note', 'profiles', 'fittings', 'materials'].includes(k)) errors.push(`unknown top-level key \`${k}\` (profiles, fittings, materials)`);
  const materials = raw.materials === undefined ? {} : raw.materials;
  const fittings = raw.fittings === undefined ? {} : raw.fittings;
  const profiles = raw.profiles === undefined ? [] : raw.profiles;
  if (!isObj(materials)) errors.push('`materials` must be an object keyed by id');
  if (!isObj(fittings)) errors.push('`fittings` must be an object keyed by id');
  if (!Array.isArray(profiles)) errors.push('`profiles` must be a list');
  if (errors.length) return { ok: false, errors };
  const mats = materials as Record<string, unknown>, fits = fittings as Record<string, unknown>, profs = profiles as unknown[];
  for (const [id, m] of Object.entries(mats)) {
    if (BUILTIN_MATERIALS.has(id)) errors.push(`materials.${id}: this id is built in, pick another`);
    if (!isObj(m) || typeof m.label !== 'string' || !isPos(m.density)) errors.push(`materials.${id}: needs a \`label\` and a \`density\` above 0 (kg per mm3, steel is 7.85e-6)`);
  }
  const fitExists = (id: string): boolean => id in fits || BUILTIN_FITTINGS.has(id);
  const fitDef = (id: string): Record<string, unknown> | undefined => (isObj(fits[id]) ? (fits[id] as Record<string, unknown>) : (FITTINGS[id] as unknown as Record<string, unknown> | undefined));
  for (const [id, f] of Object.entries(fits)) {
    const at = `fittings.${id}`;
    if (BUILTIN_FITTINGS.has(id)) errors.push(`${at}: this id is built in, pick another`);
    if (!isObj(f)) { errors.push(`${at}: must be an object`); continue; }
    if (typeof f.label !== 'string' || !f.label) errors.push(`${at}: needs a \`label\``);
    if (typeof f.kind !== 'string' || !f.kind) errors.push(`${at}: needs a \`kind\` (bracket, nut, bolt, cap, foot, process)`);
    if (f.part === undefined) continue;
    if (!isObj(f.part)) { errors.push(`${at}.part: must be an object`); continue; }
    const part = f.part, pk = part.kind;
    if (pk !== undefined && !PART_KINDS.includes(String(pk))) { errors.push(`${at}.part.kind \`${String(pk)}\`: one of ${PART_KINDS.join(', ')}`); continue; }
    for (const dim of PART_DIMS[String(pk)] ?? []) if (!isPos(part[dim])) errors.push(`${at}.part.${dim}: needs a number above 0 (mm)`);
    for (const ref of ['tnut', 'bolt', 'nut']) {
      if (part[ref] === undefined) continue;
      if (typeof part[ref] !== 'string' || !fitExists(part[ref] as string)) errors.push(`${at}.part.${ref}: \`${String(part[ref])}\` is not a fitting id of this file or the built-in library`);
      else if (!isObj(fitDef(part[ref] as string)?.part)) errors.push(`${at}.part.${ref}: fitting \`${String(part[ref])}\` has no \`part\` dimensions`);
    }
    if (pk === 'lbracket' && isObj(part) && part.tnut === undefined && part.bolt !== undefined && part.nut === undefined) errors.push(`${at}.part: a bolt without a \`nut\` (tubes) or \`tnut\` (T-slot)`);
  }
  const ids = new Set<string>();
  profs.forEach((p, i) => {
    const at = `profiles[${i}]`;
    if (!isObj(p)) { errors.push(`${at}: must be an object`); return; }
    const id = typeof p.id === 'string' ? p.id : '';
    if (!id) errors.push(`${at}: needs an \`id\``);
    else if (BUILTIN_PROFILES.has(id)) errors.push(`${at}: id \`${id}\` is built in, pick another`);
    else if (ids.has(id)) errors.push(`${at}: id \`${id}\` is listed twice`);
    ids.add(id);
    if (typeof p.label !== 'string' || !p.label) errors.push(`${at}: needs a \`label\``);
    if (typeof p.family !== 'string' || !p.family) errors.push(`${at}: needs a \`family\` (the group in the profile list)`);
    if (typeof p.material !== 'string' || !(p.material in mats || BUILTIN_MATERIALS.has(p.material))) errors.push(`${at}.material: \`${String(p.material)}\` is not a material of this file or the built-in library`);
    if (p.corner !== undefined && p.corner !== 'mitre' && p.corner !== 'butt') errors.push(`${at}.corner: mitre or butt`);
    const sec = p.section;
    if (!isObj(sec) || typeof sec.kind !== 'string' || !(sec.kind in SECTION_DIMS)) errors.push(`${at}.section.kind: one of ${Object.keys(SECTION_DIMS).join(', ')}`);
    else {
      for (const dim of SECTION_DIMS[sec.kind]) if (!isPos(sec[dim])) errors.push(`${at}.section.${dim}: needs a number above 0 (mm)`);
      for (const [k, v] of Object.entries(sec)) if (k !== 'kind' && !isNum(v)) errors.push(`${at}.section.${k}: must be a number`);
      if (sec.kind === 'channel' && !isPos(sec.t) && !(isPos(sec.tf) && isPos(sec.tw))) errors.push(`${at}.section.t: needs a number above 0 (mm), or \`tf\` and \`tw\` for the flange and the web`);
    }
    for (const [j, u] of (Array.isArray(p.fittings) ? p.fittings : []).entries()) {
      const ur = u as Record<string, unknown>;
      if (!isObj(u) || typeof ur.id !== 'string' || !fitExists(ur.id)) errors.push(`${at}.fittings[${j}].id: \`${isObj(u) ? String(ur.id) : '?'}\` is not a fitting id of this file or the built-in library`);
      else if (!['joint', 'freeEnd', 'member'].includes(String(ur.per)) || !isPos(ur.qty)) errors.push(`${at}.fittings[${j}]: needs \`per\` (joint, freeEnd, member) and \`qty\` above 0`);
    }
    if (p.hardware !== undefined) {
      if (!isObj(p.hardware)) errors.push(`${at}.hardware: must be an object {joint, corner3, cap, foot} of id lists`);
      else for (const [place, list] of Object.entries(p.hardware)) {
        if (!(place in PLACE_KINDS)) { errors.push(`${at}.hardware.${place}: one of ${Object.keys(PLACE_KINDS).join(', ')}`); continue; }
        if (!Array.isArray(list) || list.some((x) => typeof x !== 'string')) { errors.push(`${at}.hardware.${place}: must be a list of fitting ids`); continue; }
        for (const fid of list as string[]) {
          const d = fitDef(fid), pk = (d?.part as Record<string, unknown> | undefined)?.kind;
          if (!d || !fitExists(fid)) errors.push(`${at}.hardware.${place}: \`${fid}\` is not a fitting id of this file or the built-in library`);
          else if (!isObj(d.part) || !PLACE_KINDS[place].includes(String(pk))) errors.push(`${at}.hardware.${place}: fitting \`${fid}\` is not a ${PLACE_KINDS[place].join(' or ')} (its part.kind is \`${String(pk)}\`)`);
        }
      }
    }
  });
  if (errors.length) return { ok: false, errors };
  const out: UserLibrary = { profiles: profs as ProfileDef[], fittings: fits as Record<string, FittingDef>, materials: mats as Record<string, MaterialDef> };
  return { ok: true, lib: out, summary: { profiles: profs.length, fittings: Object.keys(fits).length, materials: Object.keys(mats).length } };
}

/** Parse and check a library file's text, then install it. Parse errors are reported like any other problem. */
export function importLibraryText(text: string): Checked {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { ok: false, errors: [`not valid JSON: ${(e as Error).message}`] }; }
  const r = validateLibrary(raw);
  if (r.ok) installLibrary(r.lib);
  return r;
}

const read = (): UserLibrary => {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null'); return isObj(v) ? (v as UserLibrary) : {}; } catch { return {}; }
};
const write = (l: UserLibrary): void => { try { localStorage.setItem(STORE_KEY, JSON.stringify(l)); } catch { /* storage blocked: the library lasts for this session */ } };

/** Merge `l` (already checked) into the live library and the browser's stored copy; an id imported again is replaced. */
export function installLibrary(l: UserLibrary): void {
  extendLibrary(l);
  const cur = read();
  const byId = new Map((cur.profiles ?? []).map((p) => [p.id, p]));
  for (const p of l.profiles ?? []) byId.set(p.id, p);
  write({ profiles: [...byId.values()], fittings: { ...cur.fittings, ...l.fittings }, materials: { ...cur.materials, ...l.materials } });
}

/** Put the stored library back into the live one (at start-up). Anything that no longer checks is left out. */
export function loadStoredLibrary(): void {
  const cur = read();
  if (!cur.profiles && !cur.fittings && !cur.materials) return;
  const r = validateLibrary({ profiles: [], ...cur });
  if (r.ok) extendLibrary(r.lib);
}

/** What is stored for this browser (for the panel's summary). */
export const storedLibrary = (): UserLibrary => read();

/** Forget the stored library and take its stock and fittings out of the live lists. */
export function clearStoredLibrary(): void {
  const cur = read();
  for (const p of cur.profiles ?? []) { const i = PROFILES.findIndex((x) => x.id === p.id); if (i >= 0) PROFILES.splice(i, 1); }
  for (const id of Object.keys(cur.fittings ?? {})) delete FITTINGS[id];
  for (const id of Object.keys(cur.materials ?? {})) delete MATERIALS[id];
  try { localStorage.removeItem(STORE_KEY); } catch { /* nothing stored */ }
}

/** Frame features of a document that carry a `library`: adopt what this browser does not know yet (an id already here is kept). Returns how many profiles were added. */
export function adoptFrameLibraries(features: ReadonlyArray<Record<string, unknown>>): number {
  let added = 0;
  for (const f of features) {
    if (f.type !== 'frame' || !isObj(f.library)) continue;
    const r = validateLibrary({ profiles: [], ...(f.library as object) });
    if (!r.ok) continue;
    const fresh: UserLibrary = {
      profiles: (r.lib.profiles ?? []).filter((p) => !PROFILES.some((x) => x.id === p.id)),
      fittings: Object.fromEntries(Object.entries(r.lib.fittings ?? {}).filter(([id]) => !FITTINGS[id])),
      materials: Object.fromEntries(Object.entries(r.lib.materials ?? {}).filter(([id]) => !MATERIALS[id])),
    };
    extendLibrary(fresh);   // for this session only: a library in a shared file is not stored in the browser
    added += fresh.profiles!.length;
  }
  return added;
}

/** A small valid library, as a starting point for the user's own: one stock, its material and the bracket, cap and screw it takes. */
export function exampleLibrary(): Record<string, unknown> {
  return {
    version: 1,
    note: 'Frame library. Dimensions in mm. Each id must be new (not one of the built-in library).',
    materials: { 'brass-cz121': { label: 'Brass CZ121', density: 8.5e-6 } },
    fittings: {
      'my-hex-m5': { label: 'Hex head bolt M5', kind: 'bolt', spec: 'ISO 4017 M5', part: { d: 5, headD: 8, headH: 3.5 } },
      'my-nut-m5': { label: 'Hex nut M5', kind: 'nut', spec: 'ISO 4032 M5', part: { af: 8, t: 4 } },
      'my-bracket-30': { label: 'Bracket 30 tube', kind: 'bracket', spec: '28 x 28 x 3 L angle, bolted', part: { kind: 'lbracket', arm: 28, t: 3, w: 26, hole: 5.5, holeAt: 17, bolt: 'my-hex-m5', nut: 'my-nut-m5' } },
      'my-cap-30': { label: 'Plug 30', kind: 'cap', spec: '30 x 30, 3 thick', part: { kind: 'cap', t: 3 } },
    },
    profiles: [{
      id: 'my-shs-30x30x2', label: 'My SHS 30 x 30 x 2', family: 'shs', material: 'brass-cz121', corner: 'mitre',
      section: { kind: 'rectTube', w: 30, h: 30, t: 2 }, fittings: [{ id: 'weld', per: 'joint', qty: 1 }],
      hardware: { joint: ['my-bracket-30'], cap: ['my-cap-30'] },
    }],
  };
}
