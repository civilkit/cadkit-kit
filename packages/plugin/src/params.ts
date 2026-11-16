// Parameter definitions of a plugin generator. ONE list drives the generated form, the agent tool's JSON schema, validation and defaults,
// so the form and the MCP tool can never disagree. Pure data and pure functions: no DOM, no kernel.
import type { Schema } from '@kit/agent-tools';

export type ParamType = 'number' | 'integer' | 'boolean' | 'string' | 'enum';
export interface ParamOption { value: string | number; label?: string }
/** A field is shown (and used) only while another parameter has one of these values. */
export interface VisibleIf { param: string; equals?: string | number | boolean; in?: Array<string | number | boolean>; not?: string | number | boolean }
export interface ParamDef {
  name: string;
  type: ParamType;
  title?: string;
  description?: string;
  /** shown next to the field and in the tool description: 'mm', 'deg', ... (numbers are plain mm / degrees; units are not parsed here) */
  unit?: string;
  /** absent: the parameter is required unless `optional` */
  default?: string | number | boolean;
  /** may be left out: the generator then chooses its own value (shown as "auto") */
  optional?: boolean;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  options?: ParamOption[];
  group?: string;
  visibleIf?: VisibleIf;
}
export type Values = Record<string, string | number | boolean>;
export interface ParamIssue { param: string; message: string }

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const valueOf = (o: ParamOption): string | number => o.value;

/** Problems with the definitions themselves (a manifest is refused when there are any). */
export function checkDefs(defs: ParamDef[]): string[] {
  const out: string[] = [];
  const names = new Set<string>();
  for (const d of defs) {
    const at = `param "${d.name}"`;
    if (typeof d.name !== 'string' || !NAME.test(d.name)) { out.push(`${at}: the name must be letters, digits and _, starting with a letter`); continue; }
    if (names.has(d.name)) out.push(`${at}: defined twice`);
    names.add(d.name);
    if (!['number', 'integer', 'boolean', 'string', 'enum'].includes(d.type)) { out.push(`${at}: unknown type ${JSON.stringify(d.type)}`); continue; }
    if (d.type === 'enum' && !(d.options && d.options.length)) out.push(`${at}: an enum needs options`);
    if (d.type !== 'enum' && d.options) out.push(`${at}: only an enum has options`);
    if ((d.min !== undefined || d.max !== undefined) && d.type !== 'number' && d.type !== 'integer') out.push(`${at}: min and max are for numbers`);
    if (d.min !== undefined && d.max !== undefined && d.min > d.max) out.push(`${at}: min is more than max`);
    if (d.default === undefined && d.optional) continue;
    if (d.default !== undefined) { const e = checkValue(d, d.default); if (e) out.push(`${at}: the default ${JSON.stringify(d.default)} is not valid (${e})`); }
  }
  for (const d of defs) if (d.visibleIf && !names.has(d.visibleIf.param)) out.push(`param "${d.name}": visibleIf names "${d.visibleIf.param}", which is not a parameter`);
  return out;
}

/** The problem with one value for its definition, or null. */
export function checkValue(d: ParamDef, v: unknown): string | null {
  switch (d.type) {
    case 'boolean': return typeof v === 'boolean' ? null : 'must be true or false';
    case 'string':
      if (typeof v !== 'string') return 'must be text';
      return d.maxLength !== undefined && v.length > d.maxLength ? `longer than ${d.maxLength} characters` : null;
    case 'enum': return d.options?.some((o) => valueOf(o) === v) ? null : `must be one of ${(d.options ?? []).map((o) => JSON.stringify(valueOf(o))).join(', ')}`;
    default:
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a finite number';
      if (d.type === 'integer' && !Number.isInteger(v)) return 'must be a whole number';
      if (d.min !== undefined && v < d.min) return `must be at least ${d.min}${d.unit ? ' ' + d.unit : ''}`;
      if (d.max !== undefined && v > d.max) return `must be at most ${d.max}${d.unit ? ' ' + d.unit : ''}`;
      return null;
  }
}

/** The values a form starts with: every default (parameters without one are left out). */
export function defaultsOf(defs: ParamDef[]): Values {
  const out: Values = {};
  for (const d of defs) if (d.default !== undefined) out[d.name] = d.default;
  return out;
}

/** Is the field shown for these values? */
export function isVisible(d: ParamDef, values: Values): boolean {
  const c = d.visibleIf;
  if (!c) return true;
  const v = values[c.param];
  if (c.equals !== undefined) return v === c.equals;
  if (c.in) return c.in.includes(v);
  if (c.not !== undefined) return v !== c.not;
  return true;
}

/**
 * The values that count: defaults filled in, then every parameter whose condition fails removed, in definition order. A hidden parameter
 * counts as absent for the ones that depend on it (a `closedTurns` that depends on `ends` is hidden too once `ends` is hidden).
 */
export function effectiveValues(defs: ParamDef[], given: Record<string, unknown>): { merged: Values; shown: Values; hidden: Set<string> } {
  const merged: Values = { ...defaultsOf(defs) };
  for (const [k, v] of Object.entries(given)) if (v !== undefined && v !== null && defs.some((d) => d.name === k)) merged[k] = v as never;
  const shown: Values = {};
  const hidden = new Set<string>();
  for (const d of defs) {
    // a condition naming a parameter defined later falls back to the merged value
    const seen = { ...merged, ...shown };
    for (const h of hidden) delete seen[h];
    if (!isVisible(d, seen)) { hidden.add(d.name); continue; }
    if (merged[d.name] !== undefined) shown[d.name] = merged[d.name];
  }
  return { merged, shown, hidden };
}

export interface Checked { ok: boolean; values: Values; issues: ParamIssue[] }
/**
 * Defaults filled in, every value checked, unknown names refused (an agent that misspells a parameter is told, not ignored).
 * A hidden parameter (visibleIf false) is dropped, whatever it holds.
 */
export function checkParams(defs: ParamDef[], input: Record<string, unknown> | undefined): Checked {
  const given = input ?? {};
  const issues: ParamIssue[] = [];
  const known = new Set(defs.map((d) => d.name));
  for (const k of Object.keys(given)) if (!known.has(k)) issues.push({ param: k, message: `unknown parameter; the generator has: ${defs.map((d) => d.name).join(', ')}` });
  const { shown, hidden } = effectiveValues(defs, given);
  const values: Values = {};
  for (const d of defs) {
    if (hidden.has(d.name)) continue;
    const v = shown[d.name];
    if (v === undefined) {
      if (!d.optional) issues.push({ param: d.name, message: 'is required' });
      continue;
    }
    const e = checkValue(d, v);
    if (e) issues.push({ param: d.name, message: e }); else values[d.name] = v;
  }
  return { ok: issues.length === 0, values, issues };
}

const describe = (d: ParamDef): string => {
  const parts = [d.title && d.title !== d.name ? d.title : '', d.description ?? '', d.unit ? `unit: ${d.unit}` : '', d.optional && d.default === undefined ? 'optional: left out, the generator chooses' : '', d.visibleIf ? `used only when ${d.visibleIf.param} ${d.visibleIf.in ? 'is one of ' + JSON.stringify(d.visibleIf.in) : d.visibleIf.not !== undefined ? 'is not ' + JSON.stringify(d.visibleIf.not) : 'is ' + JSON.stringify(d.visibleIf.equals)}` : ''];
  return parts.filter(Boolean).join('. ');
};

/** The JSON schema an agent tool exposes for these parameters (the subset @kit/agent-tools validates). */
export function toJsonSchema(defs: ParamDef[]): Schema & { type: 'object' } {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  for (const d of defs) {
    const s: Schema = { description: describe(d) };
    if (d.type === 'enum') { s.enum = (d.options ?? []).map(valueOf); s.type = typeof valueOf(d.options![0]) === 'number' ? 'number' : 'string'; }
    else s.type = d.type;
    if (d.min !== undefined) s.minimum = d.min;
    if (d.max !== undefined) s.maximum = d.max;
    if (d.maxLength !== undefined) s.maxLength = d.maxLength;
    if (d.default !== undefined) s.default = d.default;
    properties[d.name] = s;
    if (d.default === undefined && !d.optional && !d.visibleIf) required.push(d.name);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

export interface FormField { def: ParamDef; value: string | number | boolean | undefined; visible: boolean; error: string | null; auto: boolean }
export interface FormGroup { title: string; fields: FormField[] }
/** What a generated form shows for the current values: groups in definition order, each field with its visibility and problem. */
export function formModel(defs: ParamDef[], values: Values): FormGroup[] {
  const { hidden } = effectiveValues(defs, values);
  const groups: FormGroup[] = [];
  for (const d of defs) {
    const title = d.group ?? '';
    let g = groups.find((x) => x.title === title);
    if (!g) groups.push((g = { title, fields: [] }));
    const v = values[d.name];
    const visible = !hidden.has(d.name);
    g.fields.push({ def: d, value: v, visible, error: !visible ? null : v === undefined ? (d.optional ? null : 'is required') : checkValue(d, v), auto: v === undefined && !!d.optional });
  }
  return groups;
}
