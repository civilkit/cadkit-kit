// FreeCAD's expression language, as far as parametric models use it: numbers with units, references (`Sheet.alias`, `Obj.Prop`,
// `Obj.Constraints.Name`, `<<Label>>.Prop`, cells and ranges), + - * / % ^, comparisons and `a ? b : c`, and the usual functions
// (`;` or `,` between arguments). Written from FreeCAD's documented grammar and checked against the values FreeCAD stored (the corpus).
//
// Values are numbers in mm and degrees (a unit scales the number once: `2 cm` is 20, `1 rad` is 57.29...), so a quantity is a plain
// number here; dimensions are not tracked. `parse` gives an AST, `evalAst` its value, `emitKit` the same expression in the kernel's
// grammar (null when it has no equivalent: conditionals, comparisons, ranges outside `sum`), so the caller can keep the number instead.

export class FcExprError extends Error {}

export type Ast =
  | { k: 'num'; v: number }
  | { k: 'ref'; path: string[]; range?: [string, string] }
  | { k: 'un'; op: '-' | '+'; a: Ast }
  | { k: 'bin'; op: string; a: Ast; b: Ast }
  | { k: 'call'; fn: string; args: Ast[] }
  | { k: 'cond'; c: Ast; a: Ast; b: Ast };

const UNIT: Record<string, number> = {
  mm: 1, cm: 10, m: 1000, km: 1e6, um: 1e-3, 'µm': 1e-3, nm: 1e-6, in: 25.4, ft: 304.8, yd: 914.4, mi: 1609344, mil: 0.0254, thou: 0.0254,
  deg: 1, '°': 1, rad: 180 / Math.PI, gon: 0.9,
};

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'label'; v: string } | { t: 'range'; v: string } | { t: 'op'; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  const s = src.trim().replace(/^=\s*/, '');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    let m: RegExpExecArray | null;
    const at = (re: RegExp) => { re.lastIndex = i; return re.exec(s); };
    if ((m = at(/<<[^>]*>>/y))) { out.push({ t: 'label', v: m[0].slice(2, -2) }); i += m[0].length; continue; }
    if ((m = at(/\$?[A-Za-z]{1,2}\$?\d+:\$?[A-Za-z]{1,2}\$?\d+/y))) { out.push({ t: 'range', v: m[0].replace(/\$/g, '') }); i += m[0].length; continue; }
    if ((m = at(/(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y))) {
      i += m[0].length;
      let v = Number(m[0]);
      const u = /\s*([A-Za-z°µ]+)/y; u.lastIndex = i;
      const um = u.exec(s);
      if (um && Object.prototype.hasOwnProperty.call(UNIT, um[1])) { v *= UNIT[um[1]]; i += um[0].length; }
      else if (um && /^[A-Za-z°µ]+$/.test(um[1]) && !/^[eE]$/.test(um[1])) throw new FcExprError(`unit "${um[1]}" is not supported`);
      out.push({ t: 'num', v });
      continue;
    }
    if ((m = at(/\$?[A-Za-z_µ][A-Za-z0-9_µ]*/y))) { out.push({ t: 'id', v: m[0].replace(/\$/g, '') }); i += m[0].length; continue; }
    if ((m = at(/==|!=|<=|>=|&&|\|\|/y))) { out.push({ t: 'op', v: m[0] }); i += 2; continue; }
    if ('+-*/%^(),;.?:<>=!'.includes(c)) { out.push({ t: 'op', v: c === ';' ? ',' : c }); i++; continue; }
    throw new FcExprError(`cannot read "${s.slice(i, i + 8)}"`);
  }
  return out;
}

export function parse(src: string): Ast {
  const T = lex(src);
  let p = 0;
  const peek = () => T[p];
  const isOp = (v: string) => T[p]?.t === 'op' && T[p].v === v;
  const eat = (v: string) => { if (!isOp(v)) throw new FcExprError(`expected "${v}"`); p++; };
  const cond = (): Ast => {
    const c = or();
    if (isOp('?')) { p++; const a = cond(); eat(':'); const b = cond(); return { k: 'cond', c, a, b }; }
    return c;
  };
  const bin = (ops: string[], next: () => Ast) => (): Ast => {
    let a = next();
    for (;;) { const t = T[p]; if (t?.t !== 'op' || !ops.includes(t.v)) break; p++; a = { k: 'bin', op: t.v, a, b: next() }; }
    return a;
  };
  const unary = (): Ast => {
    if (isOp('-') || isOp('+')) { const op = T[p++].v as '-' | '+'; return { k: 'un', op, a: unary() }; }
    return pow();
  };
  const pow = (): Ast => { const a = primary(); if (isOp('^')) { p++; return { k: 'bin', op: '^', a, b: unary() }; } return a; };
  const mul = bin(['*', '/', '%'], unary);
  const add = bin(['+', '-'], mul);
  const cmp = bin(['==', '!=', '<', '>', '<=', '>=', '='], add);
  const and = bin(['&&'], cmp);
  const or: () => Ast = bin(['||'], and);
  const primary = (): Ast => {
    const t = T[p++];
    if (!t) throw new FcExprError('unexpected end');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'op' && t.v === '(') { const e = cond(); eat(')'); return e; }
    if (t.t === 'range') { const [a, b] = t.v.split(':'); return { k: 'ref', path: [], range: [a, b] }; }
    if (t.t === 'label' || t.t === 'id') {
      if (t.t === 'id' && isOp('(')) { // function call
        p++; const args: Ast[] = [];
        if (!isOp(')')) { for (;;) { args.push(cond()); if (isOp(',')) { p++; continue; } break; } }
        eat(')');
        return { k: 'call', fn: t.v.toLowerCase(), args };
      }
      const path = [t.t === 'label' ? `<<${t.v}>>` : t.v];
      while (isOp('.') && T[p + 1] && (T[p + 1].t === 'id')) { p++; path.push((T[p++] as { v: string }).v); }
      // a range written Sheet.A1:B3 is lexed as id "Sheet" "." range
      if (isOp('.') && T[p + 1]?.t === 'range') { p++; const [a, b] = (T[p++] as { v: string }).v.split(':'); return { k: 'ref', path, range: [a, b] }; }
      if (path.length === 1 && path[0].toLowerCase() === 'pi') return { k: 'num', v: Math.PI };
      if (path.length === 1 && path[0] === 'e') return { k: 'num', v: Math.E };
      return { k: 'ref', path };
    }
    throw new FcExprError(`unexpected "${(t as { v: string }).v}"`);
  };
  const ast = cond();
  if (p < T.length) throw new FcExprError(`unexpected "${(T[p] as { v: string }).v}"`);
  return ast;
}

const RAD = Math.PI / 180;
const FN: Record<string, (...a: number[]) => number> = {
  sin: (x) => Math.sin(x * RAD), cos: (x) => Math.cos(x * RAD), tan: (x) => Math.tan(x * RAD),
  asin: (x) => Math.asin(x) / RAD, acos: (x) => Math.acos(x) / RAD, atan: (x) => Math.atan(x) / RAD, atan2: (y, x) => Math.atan2(y, x) / RAD,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, log: Math.log, ln: Math.log, log10: Math.log10, ceil: Math.ceil, floor: Math.floor, trunc: Math.trunc,
  round: (x) => Math.sign(x) * Math.round(Math.abs(x)), pow: Math.pow, mod: (a, b) => a % b, hypot: Math.hypot,
  min: Math.min, max: Math.max, sum: (...a) => a.reduce((x, y) => x + y, 0), count: (...a) => a.length, average: (...a) => a.reduce((x, y) => x + y, 0) / a.length,
};

export type RefValue = number | number[] | undefined;
/** The value of the expression; `ref` gives the value of a reference (a list for a range) or undefined when it cannot be found. */
export function evalAst(a: Ast, ref: (path: string[], range?: [string, string]) => RefValue): number {
  const ev = (n: Ast): number => {
    switch (n.k) {
      case 'num': return n.v;
      case 'ref': { const v = ref(n.path, n.range); if (typeof v !== 'number') throw new FcExprError(`reference ${n.path.join('.') || n.range?.join(':')} has no value`); return v; }
      case 'un': return n.op === '-' ? -ev(n.a) : ev(n.a);
      case 'cond': return ev(n.c) ? ev(n.a) : ev(n.b);
      case 'call': {
        const f = FN[n.fn]; if (!f) throw new FcExprError(`function ${n.fn} is not supported`);
        const args: number[] = [];
        for (const x of n.args) {
          if (x.k === 'ref' && x.range) { const v = ref(x.path, x.range); if (!Array.isArray(v)) throw new FcExprError('range has no values'); args.push(...v); } else args.push(ev(x));
        }
        return f(...args);
      }
      case 'bin': {
        const x = ev(n.a), y = ev(n.b);
        switch (n.op) {
          case '+': return x + y; case '-': return x - y; case '*': return x * y; case '/': return x / y; case '%': return x % y; case '^': return Math.pow(x, y);
          case '==': case '=': return +(x === y); case '!=': return +(x !== y); case '<': return +(x < y); case '>': return +(x > y); case '<=': return +(x <= y); case '>=': return +(x >= y);
          case '&&': return +(!!x && !!y); case '||': return +(!!x || !!y);
        }
        throw new FcExprError(`operator ${n.op}`);
      }
    }
  };
  const v = ev(a);
  if (!Number.isFinite(v)) throw new FcExprError('not a finite number');
  return v;
}

/** Names of the references in the expression, as dotted paths (ranges as `from:to`). */
export function refsOf(a: Ast, out: Array<{ path: string[]; range?: [string, string] }> = []): Array<{ path: string[]; range?: [string, string] }> {
  switch (a.k) {
    case 'ref': out.push({ path: a.path, range: a.range }); break;
    case 'un': refsOf(a.a, out); break;
    case 'bin': refsOf(a.a, out); refsOf(a.b, out); break;
    case 'cond': refsOf(a.c, out); refsOf(a.a, out); refsOf(a.b, out); break;
    case 'call': a.args.forEach((x) => refsOf(x, out)); break;
  }
  return out;
}

const KIT_FN: Record<string, string> = { sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin', acos: 'acos', atan: 'atan', atan2: 'atan2', sqrt: 'sqrt', abs: 'abs', exp: 'exp', log: 'ln', ln: 'ln', log10: 'log10', ceil: 'ceil', floor: 'floor', trunc: 'trunc', round: 'round', pow: 'pow', mod: 'mod', hypot: 'hypot', min: 'min', max: 'max' };

/**
 * The expression in the kernel's grammar. `name(path, range)` gives the variable (or, for a range, the list of variables) a reference
 * stands for, or null. Null result: the expression has no kernel equivalent (a conditional, a comparison, an unsupported function).
 */
export function emitKit(a: Ast, name: (path: string[], range?: [string, string]) => string | string[] | null): string | null {
  const em = (n: Ast): string | null => {
    switch (n.k) {
      case 'num': return n.v < 0 ? `(${n.v})` : String(n.v);
      case 'ref': { const v = name(n.path, n.range); return typeof v === 'string' ? v : null; }
      case 'un': { const x = em(n.a); return x === null ? null : n.op === '-' ? `(-${x})` : x; }
      case 'cond': return null;
      case 'call': {
        if (n.fn === 'sum' || n.fn === 'average' || n.fn === 'count') {
          const items: string[] = [];
          for (const x of n.args) {
            if (x.k === 'ref' && x.range) { const v = name(x.path, x.range); if (!Array.isArray(v)) return null; items.push(...v); } else { const e = em(x); if (e === null) return null; items.push(e); }
          }
          if (!items.length) return null;
          return n.fn === 'sum' ? `(${items.join('+')})` : n.fn === 'count' ? String(items.length) : `((${items.join('+')})/${items.length})`;
        }
        const f = KIT_FN[n.fn]; if (!f) return null;
        const args = n.args.map(em);
        return args.some((x) => x === null) ? null : `${f}(${args.join(', ')})`;
      }
      case 'bin': {
        if (!['+', '-', '*', '/', '^'].includes(n.op)) { if (n.op === '%') { const x = em(n.a), y = em(n.b); return x === null || y === null ? null : `mod(${x}, ${y})`; } return null; }
        const x = em(n.a), y = em(n.b);
        return x === null || y === null ? null : `(${x}${n.op}${y})`;
      }
    }
  };
  return em(a);
}
