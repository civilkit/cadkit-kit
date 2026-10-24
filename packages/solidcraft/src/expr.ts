// A small arithmetic evaluator for SolidCraft parameter expressions: "80 mm", "width", "thickness + 14 mm", "2 * (d1 + 3)".
// Numbers, names of parameters, + - * / and parentheses; the units mm, deg and rad are accepted and dropped (the document is in
// mm, angles in degrees). Anything else throws, so an expression is never guessed at.

export class ExprError extends Error {}

const UNITS = new Set(['mm', 'deg', 'rad']);

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

/**
 * The text as the tokenizer reads it, after the spellings SolidCraft accepts besides the plain one: a single leading `=` marks a formula
 * (`=d3`), a definition `name = expression` stands for its expression, and a decimal comma (`2,5 mm`, `,5`) is a point (there are no functions here, so a comma never separates arguments).
 */
function normalise(src: string): string {
  let s = src.trim();
  const def = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)([\s\S]*)$/.exec(s);
  if (def) s = def[2].trim();
  else if (s.startsWith('=') && !s.startsWith('==')) s = s.slice(1).trim();
  let out = '', point = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
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
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/()]))/y;
  let p = 0;
  const s = normalise(src);
  while (p < s.length) {
    re.lastIndex = p;
    const m = re.exec(s);
    if (!m) throw new ExprError(`cannot read "${src}" at "${s.slice(p, p + 8)}"`);
    p = re.lastIndex;
    if (m[1] !== undefined) out.push({ k: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) { if (!UNITS.has(m[2])) out.push({ k: 'id', v: m[2] }); }
    else out.push({ k: 'op', v: m[3] });
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
    if (x.k === 'num') return x.v;
    if (x.k === 'id') {
      if (!Object.prototype.hasOwnProperty.call(vars, x.v)) throw new ExprError(`unknown parameter ${x.v}`);
      return vars[x.v];
    }
    if (x.v === '-') return -factor();
    if (x.v === '+') return factor();
    if (x.v === '(') {
      const v = expr();
      const c = t[i++];
      if (!c || c.k !== 'op' || c.v !== ')') throw new ExprError(`missing ) in "${src}"`);
      return v;
    }
    throw new ExprError(`unexpected ${x.v} in "${src}"`);
  };
  const v = expr();
  if (i < t.length) throw new ExprError(`unexpected text in "${src}"`);
  if (!Number.isFinite(v)) throw new ExprError('not a finite number');
  return v;
}
