// Saved recipes: declarative JSON files (`*.ckrecipe.json`) in a `recipes` folder inside an allowed asset root. A recipe is DATA: parameters with types
// and limits, a list of app_edit ops with "$name" placeholders, optional checks, and the source files it depends on. It is never run as code, never
// holds a command, and never names a path outside the allowed folders. Running one is one app_edit transaction followed by the checks.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { BridgeError } from '@kit/agent-link';
import { type AssetPolicy, resolveAsset, readAsset } from './assetPolicy';

export const RECIPE_SUFFIX = '.ckrecipe.json';
export const RECIPE_DIR = 'recipes';
const MAX_RECIPE_BYTES = 256 * 1024;
const MAX_STEPS = 50;
const MAX_CHECKS = 20;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const OPS = new Set(['add', 'replace', 'remove', 'transform', 'setParam']);
/** The read-only measuring ops a recipe may run as checks. */
export const CHECK_TOOLS = ['clearance', 'interference', 'thickness', 'draft', 'dfm', 'measure', 'interfaces', 'bodies'] as const;

export type ParamDef = { type: 'number' | 'integer'; default?: number; min?: number; max?: number; description?: string }
  | { type: 'string'; default?: string; maxLength?: number; description?: string }
  | { type: 'boolean'; default?: boolean; description?: string }
  | { type: 'enum'; values: Array<string | number>; default?: string | number; description?: string };
export interface RecipeCheck { tool: typeof CHECK_TOOLS[number]; args?: Record<string, unknown>; /** each key of the result must equal the value, or be within {min, max} */ expect?: Record<string, unknown>; label?: string }
export interface Recipe { id: string; title: string; version: number; params: Record<string, ParamDef>; sources: string[]; steps: Array<Record<string, unknown>>; checks: RecipeCheck[]; file: string; hash: string }
export interface RecipeEntry { id: string; title: string; params: Record<string, ParamDef>; sources: string[]; file: string }

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const bad = (file: string, message: string) => new BridgeError('bad_recipe', `${file}: ${message}`, 'a recipe is a JSON file with id, title, params, steps (app_edit ops) and optional checks and sources');

/** Check a parsed recipe file; throws bad_recipe naming the problem. */
export function parseRecipe(raw: unknown, file: string, hash: string): Recipe {
  if (!isObj(raw)) throw bad(file, 'must be a JSON object');
  const allowed = new Set(['id', 'title', 'version', 'params', 'sources', 'steps', 'checks']);
  for (const k of Object.keys(raw)) if (!allowed.has(k)) throw bad(file, `unknown field ${k} (a recipe holds data only: ${[...allowed].join(', ')})`);
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) throw bad(file, 'id must be letters, digits, . _ - (at most 64)');
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 120) throw bad(file, 'title is required (at most 120 characters)');
  const params: Record<string, ParamDef> = {};
  for (const [name, d] of Object.entries(raw.params ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(name)) throw bad(file, `parameter name ${name} is not a plain name`);
    if (!isObj(d) || !['number', 'integer', 'string', 'boolean', 'enum'].includes(String(d.type))) throw bad(file, `parameter ${name}: type must be number, integer, string, boolean or enum`);
    if (d.type === 'enum' && (!Array.isArray(d.values) || !d.values.length || d.values.some((x) => typeof x !== 'string' && typeof x !== 'number'))) throw bad(file, `parameter ${name}: enum needs values`);
    params[name] = d as unknown as ParamDef;
  }
  if (!Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > MAX_STEPS) throw bad(file, `steps must be a list of 1 to ${MAX_STEPS} ops`);
  raw.steps.forEach((s, i) => { if (!isObj(s) || !OPS.has(String(s.op))) throw bad(file, `step ${i}: op must be one of ${[...OPS].join(', ')}`); });
  const checks = (raw.checks ?? []) as unknown[];
  if (!Array.isArray(checks) || checks.length > MAX_CHECKS) throw bad(file, `checks must be a list of at most ${MAX_CHECKS}`);
  checks.forEach((c, i) => { if (!isObj(c) || !(CHECK_TOOLS as readonly string[]).includes(String(c.tool))) throw bad(file, `check ${i}: tool must be one of ${CHECK_TOOLS.join(', ')}`); });
  const sources = (raw.sources ?? []) as unknown[];
  if (!Array.isArray(sources) || sources.length > 20 || sources.some((s) => typeof s !== 'string')) throw bad(file, 'sources must be a list of at most 20 file paths');
  return { id: raw.id, title: raw.title, version: typeof raw.version === 'number' ? raw.version : 1, params, sources: sources as string[], steps: raw.steps as Array<Record<string, unknown>>, checks: checks as RecipeCheck[], file, hash };
}

/** The recipe files of the allowed roots (`<root>/recipes/*.ckrecipe.json`, real files inside the root: a link is skipped). Each is the recipe or the reason it is not one. */
export function listRecipes(policy: AssetPolicy): { recipes: Recipe[]; problems: Array<{ file: string; error: string }> } {
  const recipes: Recipe[] = [], problems: Array<{ file: string; error: string }> = [];
  const seen = new Set<string>();
  for (const root of policy.roots) {
    const dir = join(root, RECIPE_DIR);
    let names: string[] = [];
    try { names = readdirSync(dir).filter((n) => n.endsWith(RECIPE_SUFFIX)).sort(); } catch { continue; }
    for (const n of names) {
      const file = join(dir, n);
      try {
        const st = lstatSync(file);
        if (!st.isFile()) { problems.push({ file: n, error: 'not a regular file (links are not followed)' }); continue; }
        if (st.size > MAX_RECIPE_BYTES) { problems.push({ file: n, error: `larger than ${MAX_RECIPE_BYTES} bytes` }); continue; }
        const rel = relative(root, realpathSync(file));
        if (rel.startsWith('..') || isAbsolute(rel)) { problems.push({ file: n, error: 'leads outside the allowed folder' }); continue; }
        const text = readFileSync(file, 'utf8');
        const r = parseRecipe(JSON.parse(text), n, createHash('sha256').update(text).digest('hex'));
        if (seen.has(r.id)) { problems.push({ file: n, error: `id ${r.id} is already defined by an earlier file` }); continue; }
        seen.add(r.id); recipes.push(r);
      } catch (e) { problems.push({ file: n, error: e instanceof BridgeError ? e.message : `not valid JSON: ${String((e as Error).message).slice(0, 120)}` }); }
    }
  }
  return { recipes, problems };
}

/** Typed, bounded values for a run: defaults filled in, unknown names and wrong types refused. */
export function bindParams(r: Recipe, given: unknown): Record<string, string | number | boolean> {
  const g = given === undefined ? {} : given;
  if (!isObj(g)) throw new BridgeError('bad_input', 'params must be an object');
  for (const k of Object.keys(g)) if (!(k in r.params)) throw new BridgeError('bad_input', `recipe ${r.id} has no parameter ${k}`, `parameters: ${Object.keys(r.params).join(', ') || 'none'}`);
  const out: Record<string, string | number | boolean> = {};
  for (const [name, d] of Object.entries(r.params)) {
    const v = g[name] ?? d.default;
    const no = (why: string) => new BridgeError('bad_input', `parameter ${name} ${why}`);
    if (v === undefined) throw no('is required (no default)');
    if (d.type === 'number' || d.type === 'integer') {
      if (typeof v !== 'number' || !Number.isFinite(v) || (d.type === 'integer' && !Number.isInteger(v))) throw no(`must be ${d.type === 'integer' ? 'an integer' : 'a number'}`);
      if (d.min !== undefined && v < d.min) throw no(`must be at least ${d.min}`);
      if (d.max !== undefined && v > d.max) throw no(`must be at most ${d.max}`);
    } else if (d.type === 'string') { if (typeof v !== 'string' || v.length > (d.maxLength ?? 200)) throw no(`must be a string of at most ${d.maxLength ?? 200} characters`); }
    else if (d.type === 'boolean') { if (typeof v !== 'boolean') throw no('must be true or false'); }
    else { const vals = (d as Extract<ParamDef, { type: 'enum' }>).values; if (!vals.includes(v as never)) throw no(`must be one of ${vals.join(', ')}`); }
    out[name] = v as string | number | boolean;
  }
  return out;
}

/** Replace every string that is exactly "$name" by that parameter's value (not inside longer strings: nothing is ever interpolated or evaluated). */
export function substitute(v: unknown, params: Record<string, string | number | boolean>, file = 'recipe'): unknown {
  if (typeof v === 'string') {
    const m = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(v);
    if (!m) return v;
    if (!(m[1] in params)) throw bad(file, `$${m[1]} is not a parameter of this recipe`);
    return params[m[1]];
  }
  if (Array.isArray(v)) return v.map((x) => substitute(x, params, file));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x, params, file)]));
  return v;
}

/** The hash of a run: the recipe, the typed parameters and the contents of the source files (each resolved through the same allow-list as app_open_asset). */
export async function runKey(r: Recipe, params: Record<string, unknown>, policy: AssetPolicy): Promise<{ key: string; sources: Record<string, string> }> {
  const sources: Record<string, string> = {};
  for (const s of r.sources) {
    const a = await resolveAsset(policy, s);
    sources[s] = createHash('sha256').update(await readAsset(a, policy)).digest('hex');
  }
  return { key: createHash('sha256').update(JSON.stringify({ recipe: r.hash, params, sources })).digest('hex'), sources };
}

/** One check's verdict: every key of `expect` equals the result's value (or lies within {min, max}); with no `expect`, a `pass: false` or an error in the result fails it. */
export function judge(check: RecipeCheck, result: Record<string, unknown>): { ok: boolean; why?: string } {
  if (!check.expect) return result.pass === false ? { ok: false, why: 'pass is false' } : { ok: true };
  for (const [k, want] of Object.entries(check.expect)) {
    const got = result[k];
    if (isObj(want) && (typeof want.min === 'number' || typeof want.max === 'number')) {
      if (typeof got !== 'number' || (typeof want.min === 'number' && got < want.min) || (typeof want.max === 'number' && got > want.max)) return { ok: false, why: `${k} is ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}` };
    } else if (JSON.stringify(got) !== JSON.stringify(want)) return { ok: false, why: `${k} is ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}` };
  }
  return { ok: true };
}

export const recipeEntry = (r: Recipe): RecipeEntry => ({ id: r.id, title: r.title, params: r.params, sources: r.sources, file: r.file });
