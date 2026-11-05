// Expression evaluator for variables and numeric fields. A port of the kernel's `ck-model/src/expr.rs`
// (the kernel stays the authority when the part rebuilds; this gives the value hint and the error text
// while the user types, without a kernel round trip).
//
//   expr   := term (('+'|'-') term)*
//   term   := power (('*'|'/') power)*
//   power  := unary ('^' power)?                 right associative
//   unary  := '(' expr ')' | '-' power | '+' power | ident | func '(' expr ')' | number unit?
//   unit   := mm | cm | m | in | deg | °         scale to mm / degrees
//
// Variable names are case sensitive; `pi` and the functions sqrt sin cos tan abs are any case. Trig is in
// degrees, a comma is a decimal point, a leading `=` is optional. The functions of MULTI (as the kernel's) are called only as
// `name(` in lower case; inside their parentheses a comma separates the arguments, every argument and result must be finite, and
// the inverse trigonometric ones return degrees while the hyperbolic ones (sinh cosh tanh asinh acosh atanh) are unitless.

export type ExprCode = 'badExpression' | 'badName' | 'cyclicVariables' | 'unknownName' | 'duplicateName';

export const FUNCTIONS = ['sqrt', 'sin', 'cos', 'tan', 'abs'] as const;
/** Functions called as `name(args)`: (name, number of arguments; 0 = one or more). Same list and meaning as the kernel's `MULTI`. */
const MULTI: Array<[string, number]> = [
  ['min', 0], ['max', 0], ['pow', 2], ['mod', 2], ['hypot', 2], ['atan2', 2], ['round', 1], ['floor', 1], ['ceil', 1], ['trunc', 1],
  ['exp', 1], ['ln', 1], ['log10', 1], ['asin', 1], ['acos', 1], ['atan', 1],
  ['sinh', 1], ['cosh', 1], ['tanh', 1], ['asinh', 1], ['acosh', 1], ['atanh', 1],
];
const DEG = 180 / Math.PI;
function callMulti(f: string, a: number[]): number {
  switch (f) {
    case 'min': return Math.min(...a);
    case 'max': return Math.max(...a);
    case 'pow': return Math.pow(a[0], a[1]);
    case 'mod': return a[0] % a[1];
    case 'hypot': return Math.hypot(a[0], a[1]);
    case 'atan2': return Math.atan2(a[0], a[1]) * DEG;
    case 'round': return Math.sign(a[0]) * Math.round(Math.abs(a[0]));   // halves away from zero
    case 'floor': return Math.floor(a[0]);
    case 'ceil': return Math.ceil(a[0]);
    case 'trunc': return Math.trunc(a[0]);
    case 'exp': return Math.exp(a[0]);
    case 'ln': return Math.log(a[0]);
    case 'log10': return Math.log10(a[0]);
    case 'asin': return Math.asin(a[0]) * DEG;
    case 'acos': return Math.acos(a[0]) * DEG;
    case 'atan': return Math.atan(a[0]) * DEG;
    case 'sinh': return Math.sinh(a[0]);
    case 'cosh': return Math.cosh(a[0]);
    case 'tanh': return Math.tanh(a[0]);
    case 'asinh': return Math.asinh(a[0]);
    case 'acosh': return Math.acosh(a[0]);
    default: return Math.atanh(a[0]);
  }
}
/** `,` is a decimal point except directly inside the parentheses of a call to a MULTI function, where it separates the arguments (the kernel's `decimal_commas`). */
function decimalCommas(s: string): string {
  const calls: boolean[] = [];
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') {
      let j = i;
      while (j > 0 && /\s/.test(s[j - 1])) j--;
      const end = j;
      while (j > 0 && isIdent(s[j - 1])) j--;
      calls.push(j < end && MULTI.some(([m]) => m === s.slice(j, end)));
      out += c;
    } else if (c === ')') { calls.pop(); out += c; }
    else if (c === ',') out += calls[calls.length - 1] ? ',' : '.';
    else out += c;
  }
  return out;
}
const UNITS: Array<[string, number]> = [['mm', 1], ['cm', 10], ['m', 1e3], ['in', 25.4], ['deg', 1], ['°', 1]];

const isIdentStart = (c: string | undefined): boolean => !!c && /[A-Za-z_]/.test(c);
const isIdent = (c: string | undefined): boolean => !!c && /[A-Za-z0-9_]/.test(c);

export type Values = Record<string, number>;

class Fail extends Error {}

function call(f: string, x: number): number {
  const rad = (x * Math.PI) / 180;
  switch (f) {
    case 'sqrt': return Math.sqrt(x);
    case 'sin': return Math.sin(rad);
    case 'cos': return Math.cos(rad);
    case 'tan': return Math.tan(rad);
    default: return Math.abs(x);
  }
}

class Parser {
  n = 0;
  readonly t: string;
  constructor(src: string, private readonly vars: Values | undefined, readonly unknown: string[] = []) {
    this.t = src;
  }
  peek(): string | undefined { return this.t[this.n]; }
  ws(): void { while (this.n < this.t.length && /\s/.test(this.t[this.n])) this.n++; }
  number(): number {
    this.ws();
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(this.t.slice(this.n));
    if (!m) throw new Fail();
    this.n += m[0].length;
    let v = parseFloat(m[0].replace(/\.$/, ''));
    this.ws();
    const rest = this.t.slice(this.n).toLowerCase();
    for (const [u, k] of UNITS) {
      if (rest.startsWith(u) && !/[A-Za-z]/.test(this.t[this.n + u.length] ?? '')) { v *= k; this.n += u.length; break; }
    }
    return v;
  }
  /** `name(a, b, ...)` of a MULTI function, the cursor just after the name; null when no `(` follows (the word is then read as before). */
  multi(name: string): number | null {
    const m = MULTI.find(([f]) => f === name);
    if (!m) return null;
    const at = this.n;
    this.ws();
    if (this.peek() !== '(') { this.n = at; return null; }
    this.n++;
    const args: number[] = [];
    for (;;) {
      const v = this.expr();
      if (!Number.isFinite(v)) throw new Fail();
      args.push(v);
      this.ws();
      const c = this.peek();
      this.n++;
      if (c === ')') break;
      if (c !== ',') throw new Fail();
    }
    if (m[1] === 0 ? args.length === 0 : args.length !== m[1]) throw new Fail();
    const r = callMulti(m[0], args);
    if (!Number.isFinite(r)) throw new Fail();
    return r;
  }
  unary(): number {
    this.ws();
    const c = this.peek();
    if (c === '(') {
      this.n++;
      const v = this.expr();
      this.ws();
      if (this.peek() !== ')') throw new Fail();
      this.n++;
      return v;
    }
    if (c === '-') { this.n++; return -this.power(); }
    if (c === '+') { this.n++; return this.power(); }
    if (isIdentStart(c)) {
      const s = this.n;
      while (isIdent(this.peek())) this.n++;
      const id = this.t.slice(s, this.n);
      const mv = this.multi(id);
      if (mv !== null) return mv;
      if (this.vars && Object.prototype.hasOwnProperty.call(this.vars, id)) return this.vars[id];
      const low = id.toLowerCase();
      if (low === 'pi') return Math.PI;
      const f = (FUNCTIONS as readonly string[]).find((x) => x === low);
      if (!f) { this.unknown.push(id); throw new Fail(); }
      this.ws();
      if (this.peek() !== '(') throw new Fail();
      return call(f, this.unary());
    }
    return this.number();
  }
  power(): number {
    const m = this.unary();
    this.ws();
    if (this.peek() === '^') { this.n++; return Math.pow(m, this.power()); }
    return m;
  }
  term(): number {
    let m = this.power();
    for (;;) {
      this.ws();
      const c = this.peek();
      if (c === '*') { this.n++; m *= this.power(); } else if (c === '/') { this.n++; m /= this.power(); } else return m;
    }
  }
  expr(): number {
    let m = this.term();
    for (;;) {
      this.ws();
      const c = this.peek();
      if (c === '+') { this.n++; m += this.term(); } else if (c === '-') { this.n++; m -= this.term(); } else return m;
    }
  }
}

export type EvalResult = { ok: true; value: number } | { ok: false; code: ExprCode; name?: string };

/** Evaluate an expression string (the leading `=` is optional) against resolved variable values. */
export function evalExpr(src: string, values?: Values): EvalResult {
  let s = src.trim();
  if (s.startsWith('=')) s = s.slice(1);
  s = decimalCommas(s);
  const unknown: string[] = [];
  const p = new Parser(s, values, unknown);
  try {
    const v = p.expr();
    p.ws();
    if (p.n < s.length || !Number.isFinite(v)) return { ok: false, code: 'badExpression' };
    return { ok: true, value: v };
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    if (unknown.length) return { ok: false, code: 'unknownName', name: unknown[0] };
    return { ok: false, code: 'badExpression' };
  }
}

/** Identifiers in an expression, in order (numbers with units like `3mm` do not count: a digit starts the token). */
export function identifiers(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    if (isIdentStart(src[i])) {
      const s = i;
      while (i < src.length && isIdent(src[i])) i++;
      out.push(src.slice(s, i));
    } else i++;
  }
  return out;
}

export interface Variable { name: string; expr: string; comment?: string; unit?: string }

export interface Scope {
  vars: Variable[];
  values: Values;
  /** variable name -> error code */
  errors: Record<string, ExprCode>;
}
export const EMPTY_SCOPE: Scope = { vars: [], values: {}, errors: {} };

const reserved = (low: string): boolean => low === 'pi' || (FUNCTIONS as readonly string[]).includes(low) || UNITS.some(([u]) => u === low);
export const validName = (n: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n);

/** The name problem, or null when the name is usable. */
export function nameError(name: string, others: string[]): ExprCode | null {
  if (!validName(name) || reserved(name.toLowerCase())) return 'badName';
  if (others.includes(name)) return 'duplicateName';
  return null;
}

/** Resolve `part.variables` like the kernel: bad names, bad expressions and cycles are reported per variable. */
export function resolveVariables(vars: Variable[]): Scope {
  const values: Values = {};
  const errors: Record<string, ExprCode> = {};
  const pending: Variable[] = [];
  for (const v of vars) {
    if (!validName(v.name) || reserved(v.name.toLowerCase())) errors[v.name || ''] = 'badName';
    else if (pending.some((p) => p.name === v.name)) errors[v.name] = 'duplicateName';
    else pending.push(v);
  }
  let progress = true;
  while (progress && pending.length) {
    progress = false;
    let o = 0;
    while (o < pending.length) {
      const a = pending[o];
      if (identifiers(a.expr).some((h) => pending.some((d) => d.name === h))) { o++; continue; }
      const r = evalExpr(a.expr, values);
      if (r.ok) values[a.name] = r.value; else errors[a.name] = r.code;
      pending.splice(o, 1);
      progress = true;
    }
  }
  for (const p of pending) errors[p.name] = 'cyclicVariables';
  return { vars, values, errors };
}

/** Error text for a code, in English (the app catalogue overrides by key `expr.error.<code>`). */
export const ERROR_TEXT: Record<ExprCode, string> = {
  badExpression: 'Not a valid expression',
  unknownName: 'Unknown variable',
  badName: 'Invalid name: letters, digits and _, not starting with a digit, and not pi, sqrt, sin, cos, tan, abs or a unit',
  duplicateName: 'Name already in use',
  cyclicVariables: 'Circular reference between variables',
};

/** What a field holds: a plain number or an expression (a string starting with `=`). */
export const isExprValue = (v: unknown): v is string => typeof v === 'string' && v.trim().startsWith('=');

/** Turn typed text into a field value: a number stays a number; `=...` or a lone identifier/formula becomes `=...`. */
export function parseFieldText(text: string): { kind: 'empty' } | { kind: 'number'; value: number } | { kind: 'expr'; expr: string } {
  const s = text.trim();
  if (s === '') return { kind: 'empty' };
  const plain = Number(s.replace(',', '.'));
  if (!s.startsWith('=') && Number.isFinite(plain)) return { kind: 'number', value: plain };
  return { kind: 'expr', expr: s.startsWith('=') ? s : '=' + s };
}

/** `name = value` typed in a value box: the name and the value as an expression (`=...`). Null for anything else, including a
 *  plain `=expr` (no name before the `=`) and `==`. */
export function parseAssignment(text: string): { name: string; expr: string } | null {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*(\S.*?)\s*$/.exec(text);
  return m ? { name: m[1], expr: '=' + m[2].replace(/^=\s*/, '') } : null;
}

/** Value of a field (number or `=expr`) in a scope; null when it does not evaluate. */
export function valueOf(v: unknown, scope: Scope): number | null {
  if (typeof v === 'number') return v;
  if (isExprValue(v)) { const r = evalExpr(v, scope.values); return r.ok ? r.value : null; }
  if (typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}

/** Variable names (with their value) that start with the word being typed at the end of `text` (the caret is taken at the end). */
export function completions(text: string, scope: Scope): Array<{ name: string; value: number | null; kind: 'var' | 'fn' | 'const' }> {
  const m = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(text);
  const word = m ? m[1] : '';
  if (!m && text !== '' && !/[=+\-*/^(,\s]$/.test(text)) return [];
  const low = word.toLowerCase();
  const out: Array<{ name: string; value: number | null; kind: 'var' | 'fn' | 'const' }> = [];
  for (const v of scope.vars) {
    if (v.name && v.name !== word && v.name.toLowerCase().startsWith(low) && !scope.errors[v.name]) out.push({ name: v.name, value: scope.values[v.name] ?? null, kind: 'var' });
  }
  for (const f of FUNCTIONS) if (word && f.startsWith(low) && f !== low) out.push({ name: f, value: null, kind: 'fn' });
  if (word && 'pi'.startsWith(low) && low !== 'pi') out.push({ name: 'pi', value: Math.PI, kind: 'const' });
  return out;
}
