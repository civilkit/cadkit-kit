// A tiny JSON-schema subset validator (zod-free): type, enum, required, properties, items, min/max, additionalProperties.
export interface Schema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: ReadonlyArray<string | number>;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  maxLength?: number;
  additionalProperties?: boolean;
  default?: unknown;
  oneOf?: Schema[];
}

/** Validate `v` against `s`; returns a list of "path: problem" strings (empty when valid). */
export function validate(s: Schema, v: unknown, path = '$'): string[] {
  const out: string[] = [];
  if (s.oneOf) {
    const tries = s.oneOf.map((o) => validate(o, v, path));
    return tries.some((t) => t.length === 0) ? [] : [`${path}: matches none of the allowed shapes (${tries.map((t) => t[0]).join(' | ')})`];
  }
  if (s.enum && !s.enum.includes(v as never)) return [`${path}: must be one of ${s.enum.map((x) => JSON.stringify(x)).join(', ')}`];
  switch (s.type) {
    case 'string':
      if (typeof v !== 'string') return [`${path}: must be a string`];
      if (s.maxLength !== undefined && v.length > s.maxLength) out.push(`${path}: longer than ${s.maxLength} characters`);
      break;
    case 'number':
    case 'integer':
      if (typeof v !== 'number' || !Number.isFinite(v)) return [`${path}: must be a finite number`];
      if (s.type === 'integer' && !Number.isInteger(v)) out.push(`${path}: must be an integer`);
      if (s.minimum !== undefined && v < s.minimum) out.push(`${path}: must be >= ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) out.push(`${path}: must be <= ${s.maximum}`);
      break;
    case 'boolean':
      if (typeof v !== 'boolean') return [`${path}: must be a boolean`];
      break;
    case 'array':
      if (!Array.isArray(v)) return [`${path}: must be an array`];
      if (s.minItems !== undefined && v.length < s.minItems) out.push(`${path}: needs at least ${s.minItems} items`);
      if (s.maxItems !== undefined && v.length > s.maxItems) out.push(`${path}: at most ${s.maxItems} items`);
      if (s.items) v.forEach((x, i) => out.push(...validate(s.items!, x, `${path}[${i}]`)));
      break;
    case 'object': {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return [`${path}: must be an object`];
      const o = v as Record<string, unknown>;
      for (const k of s.required ?? []) if (o[k] === undefined) out.push(`${path}.${k}: is required`);
      for (const [k, x] of Object.entries(o)) {
        const sub = s.properties?.[k];
        if (sub) { if (x !== undefined) out.push(...validate(sub, x, `${path}.${k}`)); }
        else if (s.additionalProperties === false) {
          const allowed = Object.keys(s.properties ?? {});
          const near = closest(k, allowed);
          out.push(`${path}.${k}: unknown field${near ? ` (did you mean ${near}?)` : ''} (allowed: ${allowed.join(', ') || 'none'}; parameters go at the top level of the input)`);
        }
      }
      break;
    }
  }
  return out;
}

/** The allowed name closest to a misspelt one (edit distance of at most 2, or a prefix/substring match), or undefined. */
function closest(k: string, names: string[]): string | undefined {
  const lk = k.toLowerCase();
  let best: string | undefined, bd = 3;
  for (const n of names) {
    const ln = n.toLowerCase();
    const d = ln === lk ? 0 : (ln.includes(lk) || lk.includes(ln)) && Math.min(ln.length, lk.length) >= 3 ? 1 : editDistance(lk, ln);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
