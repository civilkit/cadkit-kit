// A small arithmetic evaluator for SolidCraft parameter expressions: "80 mm", "width", "thickness + 14 mm", "2 * (d1 + 3)", "sqrt(a^2 + b^2)".
// Numbers, names of parameters, + - * / ^ and parentheses, the constants pi / PI, and the functions below. A number may carry a unit; lengths
// are converted to mm and angles to degrees (the document is in mm and degrees), so "2 cm" is 20 and "1 rad" is 57.29...; trigonometric
// functions take degrees and the inverse ones return degrees. Anything else throws, so an expression is never guessed at.

export class ExprError extends Error {}

/** Units a number may carry, as the factor to millimetres (lengths) or degrees (angles). */
const UNIT_SCALE: Record<string, number> = {
  mm: 1, cm: 10, m: 1000, um: 1e-3, 'µm': 1e-3, nm: 1e-6, km: 1e6, in: 25.4, inch: 25.4, ft: 304.8, yd: 914.4, mil: 0.0254,
  deg: 1, rad: 180 / Math.PI,
};
const PI = Math.PI, RAD = PI / 180;
/** Functions by name: the arity (0 = any number from one up) and the value. `log` and `sign` are left out: the base of the first and the sign of zero in the second are not stated. */
const FUNCTIONS: Record<string, { n: number; f: (...a: number[]) => number }> = {
  sin: { n: 1, f: (x) => Math.sin(x * RAD) }, cos: { n: 1, f: (x) => Math.cos(x * RAD) }, tan: { n: 1, f: (x) => Math.tan(x * RAD) },
  asin: { n: 1, f: (x) => Math.asin(x) / RAD }, acos: { n: 1, f: (x) => Math.acos(x) / RAD }, atan: { n: 1, f: (x) => Math.atan(x) / RAD },
  atan2: { n: 2, f: (y, x) => Math.atan2(y, x) / RAD },
  // hyperbolic: plain numbers in and out (no degrees); a result outside the domain or past the double range is NaN / Infinity and is refused as not finite
  sinh: { n: 1, f: Math.sinh }, cosh: { n: 1, f: Math.cosh }, tanh: { n: 1, f: Math.tanh },
  asinh: { n: 1, f: Math.asinh }, acosh: { n: 1, f: Math.acosh }, atanh: { n: 1, f: Math.atanh },
  sqrt: { n: 1, f: Math.sqrt }, abs: { n: 1, f: Math.abs }, exp: { n: 1, f: Math.exp }, ln: { n: 1, f: Math.log }, log10: { n: 1, f: Math.log10 },
  floor: { n: 1, f: Math.floor }, ceil: { n: 1, f: Math.ceil }, trunc: { n: 1, f: Math.trunc },
  round: { n: 1, f: (x) => Math.sign(x) * Math.round(Math.abs(x)) },   // halves away from zero
  min: { n: 0, f: Math.min }, max: { n: 0, f: Math.max },
  hypot: { n: 2, f: Math.hypot }, pow: { n: 2, f: Math.pow }, mod: { n: 2, f: (a, b) => a % b },
};

type Tok = { k: 'num'; v: number; unit?: boolean } | { k: 'id'; v: string } | { k: 'op'; v: string };
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * The text as the tokenizer reads it, after the spellings SolidCraft accepts besides the plain one: a single leading `=` marks a formula
 * (`=d3`), a definition `name = expression` stands for its expression, and a decimal comma (`2,5 mm`, `,5`) is a point (inside the parentheses of a function a comma separates the arguments).
 */
function normalise(src: string): string {
  let s = src.trim();
  const def = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)([\s\S]*)$/.exec(s);
  if (def) s = def[2].trim();
  else if (s.startsWith('=') && !s.startsWith('==')) s = s.slice(1).trim();
  let out = '', point = false;
  const calls: boolean[] = [];   // for each open parenthesis: does it belong to a function call (where a comma separates arguments)
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') calls.push(/[A-Za-z0-9_µ]$/.test(out.trimEnd()) && /[A-Za-z_µ][A-Za-z0-9_µ]*\s*$/.test(out));
    else if (c === ')') calls.pop();
    if (c === ',' && calls[calls.length - 1]) { out += c; point = false; continue; }
    const digit = (k: number) => k >= 0 && k < s.length && s[k] >= '0' && s[k] <= '9';
    if (c === ',' && digit(i + 1)) {
      let p = out.length - 1;
      while (p >= 0 && out[p] === ' ') p--;
      const operand = p < 0 || '+-*/'.includes(out[p]);   // where an operand is expected: a leading decimal comma
      if (operand || (digit(i - 1) && !point)) { out += '.'; point = true; continue; }
    }
    if (c === '.') point = true;
    else if (!(c >= '0' && c <= '9')) point = false;
    out += c;
  }
  return out;
}

function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-zµ_][A-Za-z0-9µ_]*)|([-+*/^(),]))/y;
  let p = 0;
  const s = normalise(src);
  while (p < s.length) {
    re.lastIndex = p;
    const m = re.exec(s);
    if (!m) throw new ExprError(`cannot read "${src}" at "${s.slice(p, p + 8)}"`);
    p = re.lastIndex;
    if (m[1] !== undefined) out.push({ k: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) {
      // a unit directly after a number scales it; anywhere else the word is a name
      const last = out[out.length - 1];
      if (last?.k === 'num' && hasOwn(UNIT_SCALE, m[2]) && !last.unit) { out[out.length - 1] = { k: 'num', v: last.v * UNIT_SCALE[m[2]], unit: true }; }
      else out.push({ k: 'id', v: m[2] });
    } else out.push({ k: 'op', v: m[3] });
  }
  return out;
}

/** The value of an expression (or a plain number); `vars` holds the values of the named parameters. */
export function evalExpr(src: string | number, vars: Record<string, number> = {}): number {
  if (typeof src === 'number') {
    if (!Number.isFinite(src)) throw new ExprError('not a finite number');
    return src;
  }
  const t = tokens(String(src));
  if (!t.length) throw new ExprError('empty expression');
  let i = 0;
  const peek = () => t[i];
  const expr = (): number => {
    let v = term();
    for (let o = peek(); o && o.k === 'op' && (o.v === '+' || o.v === '-'); o = peek()) { i++; const r = term(); v = o.v === '+' ? v + r : v - r; }
    return v;
  };
  const term = (): number => {
    let v = factor();
    for (let o = peek(); o && o.k === 'op' && (o.v === '*' || o.v === '/'); o = peek()) {
      i++; const r = factor();
      if (o.v === '/' && r === 0) throw new ExprError('division by zero');
      v = o.v === '*' ? v * r : v / r;
    }
    return v;
  };
  const factor = (): number => {
    const x = t[i++];
    if (!x) throw new ExprError(`"${src}" ends too early`);
    if (x.k === 'op' && x.v === '-') return -factor();
    if (x.k === 'op' && x.v === '+') return factor();
    let v: number;
    if (x.k === 'num') v = x.v;
    else if (x.k === 'id') {
      const call = t[i];
      if (call?.k === 'op' && call.v === '(' && hasOwn(FUNCTIONS, x.v) && !hasOwn(vars, x.v)) {
        i++;
        const args = [expr()];
        while (t[i]?.k === 'op' && t[i].v === ',') { i++; args.push(expr()); }
        const c = t[i++];
        if (!c || c.k !== 'op' || c.v !== ')') throw new ExprError(`missing ) after ${x.v}( in "${src}"`);
        const fn = FUNCTIONS[x.v];
        if (fn.n ? args.length !== fn.n : false) throw new ExprError(`${x.v} takes ${fn.n} argument${fn.n === 1 ? '' : 's'} in "${src}"`);
        v = fn.f(...args);
        if (!Number.isFinite(v)) throw new ExprError(`${x.v}(${args.join(', ')}) is not a finite number`);   // as the part's grammar: every call must give a finite value
      } else if (hasOwn(vars, x.v)) v = vars[x.v];
      else if (x.v === 'pi' || x.v === 'PI') v = PI;
      else throw new ExprError(`unknown parameter ${x.v}`);
    } else if (x.v === '(') {
      v = expr();
      const c = t[i++];
      if (!c || c.k !== 'op' || c.v !== ')') throw new ExprError(`missing ) in "${src}"`);
    } else throw new ExprError(`unexpected ${x.v} in "${src}"`);
    // a power binds tighter than a product and runs right to left: 2 ^ 3 ^ 2 is 2 ^ 9
    if (t[i]?.k === 'op' && t[i].v === '^') { i++; v = v ** factor(); }
    return v;
  };
  const v = expr();
  if (i < t.length) throw new ExprError(`unexpected text in "${src}"`);
  if (!Number.isFinite(v)) throw new ExprError('not a finite number');
  return v;
}

/** What the part's expression grammar has: the functions (`log` and `sign`, which this evaluator refuses too, have no counterpart there). */
const KERNEL_FUNCTIONS = new Set(['sqrt', 'sin', 'cos', 'tan', 'abs']);
/** The functions the part's grammar calls as `name(a, b, ...)`, where a comma separates the arguments. */
const KERNEL_MULTI = new Set(['min', 'max', 'pow', 'mod', 'hypot', 'atan2', 'round', 'floor', 'ceil', 'trunc', 'exp', 'ln', 'log10', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh']);
/** Names the part cannot use for a variable: `pi`, its functions and its units, in any letter case, and anything that is not letters, digits and `_`. */
const RESERVED = new Set(['pi', 'sqrt', 'sin', 'cos', 'tan', 'abs', 'mm', 'cm', 'm', 'in', 'deg']);
export const usableName = (n: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !RESERVED.has(n.toLowerCase());

/**
 * The expression as the part's grammar writes it (`"d1/2+3"`: no unit words, units already turned into mm and degrees), or null when it cannot be
 * held there: a function the part does not have, a name outside `names`, or a comma. Same value as `evalExpr` gives.
 */
export function kernelExpr(src: string | number, names: ReadonlySet<string>): string | null {
  if (typeof src === 'number') return Number.isFinite(src) ? String(src) : null;
  let t: Tok[];
  try { t = tokens(String(src)); } catch { return null; }
  if (!t.length) return null;
  let out = '';
  const calls: boolean[] = [];   // for each open parenthesis: a call of a function with several arguments (where a comma may separate them)
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    const callNext = t[i + 1]?.k === 'op' && t[i + 1].v === '(';
    if (x.k === 'num') out += String(x.v);
    else if (x.k === 'op') {
      if (x.v === ',') { if (!calls[calls.length - 1]) return null; }
      else if (x.v === '(') { const p = t[i - 1]; calls.push(p?.k === 'id' && KERNEL_MULTI.has(p.v) && !names.has(p.v)); }
      else if (x.v === ')') calls.pop();
      out += x.v;
    }
    else if (callNext && (KERNEL_FUNCTIONS.has(x.v) || KERNEL_MULTI.has(x.v)) && !names.has(x.v)) out += x.v;
    else if (names.has(x.v)) out += x.v;
    else if (x.v === 'pi' || x.v === 'PI') out += 'pi';
    else return null;
  }
  return out;
}

/** The names an expression uses (in the sense of `kernelExpr`: every word that is not a function being called, a constant or a unit). */
export function namesIn(src: string | number): string[] {
  if (typeof src === 'number') return [];
  let t: Tok[];
  try { t = tokens(String(src)); } catch { return []; }
  return t.flatMap((x, i) => (x.k === 'id' && !(t[i + 1]?.k === 'op' && t[i + 1].v === '(') && x.v !== 'pi' && x.v !== 'PI' ? [x.v] : []));
}
