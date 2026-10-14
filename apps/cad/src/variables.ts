// Document variables ("equations"): the named values expression fields refer to, and the configurations (named sets of them).
// The kernel reads `variables: [{name, expr}]` from the part and ignores other keys, so a comment and a unit ride along on each
// variable, and `configurations` / `activeConfig` are extra top-level fields (the kernel never reads them; Save keeps them).
import type { PartDoc } from '@ck/part-model';
import { evalExpr, identifiers, nameError, resolveVariables, type Scope, type Variable } from '@kit/ui';

export interface Config { name: string; values: Record<string, string> }
export type VarDoc = PartDoc & { variables?: Variable[]; configurations?: Config[]; activeConfig?: string };

export const readVars = (d: PartDoc | null): Variable[] => (((d as VarDoc | null)?.variables ?? []).map((v) => ({ ...v })));
export const readConfigs = (d: PartDoc | null): Config[] => (((d as VarDoc | null)?.configurations ?? []).map((c) => ({ name: c.name, values: { ...c.values } })));
export const readActive = (d: PartDoc | null): string | null => (d as VarDoc | null)?.activeConfig ?? null;
export const scopeOf = (d: PartDoc | null): Scope => resolveVariables(readVars(d));

/** A name for a new variable that is not taken. */
export function freshName(vars: Variable[], base = 'var'): string {
  const taken = new Set(vars.map((v) => v.name));
  for (let i = 1; ; i++) if (!taken.has(base + i)) return base + i;
}

const wordRe = (name: string): RegExp => new RegExp('(?<![A-Za-z0-9_.])' + name + '(?![A-Za-z0-9_])', 'g');
/** Replace a variable name inside one expression string. */
export const renameIn = (expr: string, from: string, to: string): string => expr.replace(wordRe(from), to);

type Walk = (container: Record<string, unknown> | unknown[], key: string | number, value: string, path: string) => void;
/** Visit every expression string in a feature: values starting with `=`, and the `expr` of a sketch constraint. */
function eachExpr(node: unknown, path: string, fn: Walk): void {
  if (Array.isArray(node)) { node.forEach((x, i) => { if (typeof x === 'string' && x.trim().startsWith('=')) fn(node, i, x, `${path}.${i}`); else eachExpr(x, `${path}.${i}`, fn); }); return; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (typeof v === 'string' && (v.trim().startsWith('=') || k === 'expr')) fn(node as Record<string, unknown>, k, v, path ? `${path}.${k}` : k);
      else eachExpr(v, path ? `${path}.${k}` : k, fn);
    }
  }
}

/** Where a variable is used: `F2.depth`, a sketch dimension `F1.constraints.3.expr`, or another variable. */
export function usesOf(d: PartDoc, name: string): string[] {
  const out: string[] = [];
  const re = wordRe(name);
  for (const f of d.features) {
    eachExpr(f, '', (_c, _k, v, path) => { re.lastIndex = 0; if (re.test(v)) out.push(`${f.id}.${path}`); });
  }
  for (const v of readVars(d)) if (v.name !== name && identifiers(v.expr).includes(name)) out.push(v.name);
  return out;
}

/** Features changed by renaming a variable (full replacements, for one atomic edit). */
export function renameFeatures(d: PartDoc, from: string, to: string): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const f of d.features) {
    const copy = structuredClone(f) as unknown as Record<string, unknown>;
    let hit = false;
    eachExpr(copy, '', (c, k, v) => { const n = renameIn(v, from, to); if (n !== v) { (c as Record<string | number, unknown>)[k] = n; hit = true; } });
    if (hit) out[f.id] = copy;
  }
  return out;
}

/** The change a rename makes everywhere: the variable list, the configurations and the features. */
export function renamePatch(d: PartDoc, from: string, to: string): { variables: Variable[]; configurations: Config[]; features: Record<string, Record<string, unknown>> } {
  const variables = readVars(d).map((v) => ({ ...v, name: v.name === from ? to : v.name, expr: renameIn(v.expr, from, to) }));
  const configurations = readConfigs(d).map((c) => {
    const values: Record<string, string> = {};
    for (const [k, e] of Object.entries(c.values)) values[k === from ? to : k] = renameIn(e, from, to);
    return { name: c.name, values };
  });
  return { variables, configurations, features: renameFeatures(d, from, to) };
}

/** The variable list with a configuration's expressions applied (variables the set does not mention keep theirs). */
export function applyConfig(vars: Variable[], c: Config): Variable[] {
  return vars.map((v) => (c.values[v.name] !== undefined ? { ...v, expr: c.values[v.name] } : v));
}
export const configOf = (vars: Variable[], name: string): Config => ({ name, values: Object.fromEntries(vars.map((v) => [v.name, v.expr])) });
/** Whether the variables still match the configuration (every expression it names is the same). */
export const matchesConfig = (vars: Variable[], c: Config): boolean => Object.entries(c.values).every(([k, e]) => vars.find((v) => v.name === k)?.expr === e);

/** Check a whole variable list before it is applied: the first variable with a problem, else null. */
export function firstProblem(vars: Variable[]): { name: string; code: string; at: number } | null {
  const names: string[] = [];
  for (let i = 0; i < vars.length; i++) {
    const e = nameError(vars[i].name, names);
    if (e) return { name: vars[i].name, code: e, at: i };
    names.push(vars[i].name);
  }
  const sc = resolveVariables(vars);
  for (let i = 0; i < vars.length; i++) {
    const code = sc.errors[vars[i].name];
    if (code) return { name: vars[i].name, code, at: i };
  }
  for (let i = 0; i < vars.length; i++) if (!evalExpr(vars[i].expr, sc.values).ok) return { name: vars[i].name, code: 'badExpression', at: i };
  return null;
}
