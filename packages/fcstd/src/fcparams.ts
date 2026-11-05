// FreeCAD expressions as part variables. A property bound by an expression (`Pad.Length = Params.depth`) becomes a numeric field that
// holds the expression over variables; the variables are the spreadsheet cells, VarSet / custom properties, named sketch constraints and
// other bound properties the expression refers to. Every translation is checked: the expression is evaluated here and must give the number
// FreeCAD stored for the property (1e-6 relative), else the number is kept and the reason is reported.
import { Ast, FcExprError, emitKit, evalAst, parse, refsOf } from './fcexpr';

/** The part of the importer's object model this module needs. */
export interface PObj { name: string; type: string; props: Map<string, Element> }
export interface PCons { name: string; type: number; value: number }

export interface Var {
  key: string;
  /** the part variable's name */
  name: string;
  /** kernel expression (a number text when the source has no usable expression) */
  expr: string;
  value: number;
  /** FcParam path to set it from outside (`Sheet.alias:width`, `Obj.Prop`, `Sketch.Constraints.Name`) */
  path: string;
  /** what it stands for, for reports */
  source: string;
}

const RESERVED = new Set(['pi', 'e', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sqrt', 'abs', 'exp', 'ln', 'log10', 'floor', 'ceil', 'round', 'trunc', 'min', 'max', 'pow', 'mod', 'hypot', 'mm', 'cm', 'm', 'in', 'deg']);
const safe = (s: string) => { const t = s.replace(/[^A-Za-z0-9_]/g, '_'); return /^[A-Za-z_]/.test(t) ? t : `_${t}`; };
const cellRe = /^\$?([A-Za-z]{1,2})\$?(\d+)$/;
const colNum = (c: string) => c.toUpperCase().split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n: number) => { let s = ''; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
const REL = 1e-6;

export function makeParams(env: {
  objs: Map<string, PObj>;
  warn: (object: string, code: string, message: string) => void;
  /** the `value` attribute of the first child of a property, or null */
  attr: (o: PObj, prop: string) => string | null;
  constraints: (sk: PObj) => PCons[];
}) {
  const { objs, warn } = env;
  const variables: Var[] = [];
  const cache = new Map<string, Var | null>();
  const busy = new Set<string>();
  const usedNames = new Set<string>();

  const labelOf = (o: PObj) => env.attr(o, 'Label') ?? o.name;
  const byRef = (n: string): PObj | undefined => {
    if (n.startsWith('<<')) { const l = n.slice(2, -2); for (const o of objs.values()) if (labelOf(o) === l) return o; return undefined; }
    return objs.get(n);
  };
  const engine = (o: PObj) => {
    const m = new Map<string, string>();
    for (const e of Array.from(o.props.get('ExpressionEngine')?.querySelectorAll('Expression') ?? [])) m.set((e.getAttribute('path') ?? '').replace(/^\./, ''), e.getAttribute('expression') ?? '');
    return m;
  };
  const cells = (sheet: PObj) => {
    const m = new Map<string, { content: string; alias: string }>();
    for (const c of Array.from(sheet.props.get('cells')?.querySelectorAll('Cell') ?? [])) m.set((c.getAttribute('address') ?? '').toUpperCase(), { content: c.getAttribute('content') ?? '', alias: c.getAttribute('alias') ?? '' });
    return m;
  };
  const uniq = (base: string) => {
    let n = RESERVED.has(base.toLowerCase()) ? `v_${base}` : base, k = 2;
    while (usedNames.has(n)) n = `${base}_${k++}`;
    usedNames.add(n);
    return n;
  };

  /** Resolve a reference found in an expression of `from` to the variable(s) it stands for. */
  function resolve(from: PObj, path: string[], range?: [string, string]): Var | Var[] | null {
    // ranges: Sheet.A1:B3 or A1:B3 inside a sheet
    const head = path.length ? byRef(path[0]) : undefined;
    const sheet = head?.type === 'Spreadsheet::Sheet' ? head : from.type === 'Spreadsheet::Sheet' && !head ? from : undefined;
    if (range) {
      if (!sheet) return null;
      const [a, b] = range.map((r) => cellRe.exec(r)); if (!a || !b) return null;
      const cs = cells(sheet), out: Var[] = [];
      for (let c = colNum(a[1]); c <= colNum(b[1]); c++) for (let r = Number(a[2]); r <= Number(b[2]); r++) {
        const addr = `${colName(c)}${r}`;
        if (!cs.has(addr)) continue;
        const v = cellVar(sheet, addr, true);
        if (v) out.push(v);
      }
      return out;
    }
    if (sheet) {
      const rest = head ? path.slice(1) : path;
      if (rest.length !== 1) return null;
      const cs = cells(sheet);
      let addr = '';
      if (cellRe.test(rest[0]) && cs.has(rest[0].toUpperCase().replace(/\$/g, ''))) addr = rest[0].toUpperCase().replace(/\$/g, '');
      else for (const [a, c] of cs) if (c.alias === rest[0]) addr = a;
      return addr ? cellVar(sheet, addr, false) : null;
    }
    if (!head) return null;
    if (path.length === 3 && path[1] === 'Constraints') return constraintVar(head, path[2]);
    if (path.length === 2) return propVar(head, path[1]);
    return null;
  }

  const refValue = (from: PObj) => (path: string[], range?: [string, string]) => {
    const r = resolve(from, path, range);
    if (r === null) return undefined;
    return Array.isArray(r) ? r.map((v) => v.value) : r.value;
  };
  const refName = (from: PObj) => (path: string[], range?: [string, string]) => {
    const r = resolve(from, path, range);
    if (r === null) return null;
    return Array.isArray(r) ? r.map((v) => v.name) : r.name;
  };

  /** value and kernel text of an expression in the context of `from`; null when it cannot be translated (reason in `why`). */
  function translate(from: PObj, text: string): { value: number; expr: string | null; ast: Ast } | { why: string } {
    try {
      const ast = parse(text);
      const value = evalAst(ast, refValue(from));
      return { value, expr: emitKit(ast, refName(from)), ast };
    } catch (e) { return { why: (e as Error).message }; }
  }

  function make(key: string, f: () => Omit<Var, 'key' | 'name'> & { nameHint: string } | null): Var | null {
    if (cache.has(key)) return cache.get(key)!;
    if (busy.has(key)) return null; // a cycle
    busy.add(key);
    let v: Var | null = null;
    try { const r = f(); if (r) { const { nameHint, ...rest } = r; v = { key, name: uniq(safe(nameHint)), ...rest }; variables.push(v); } }
    finally { busy.delete(key); }
    cache.set(key, v);
    return v;
  }

  function cellVar(sheet: PObj, addr: string, inRange: boolean): Var | null {
    const cell = cells(sheet).get(addr);
    if (!cell) return null;
    return make(`${sheet.name}!${addr}`, () => {
      const c = cell.content.trim();
      if (!c || c.startsWith("'")) return null; // text
      const t = translate(sheet, c);
      if ('why' in t) { if (!inRange) warn(sheet.name, 'expressions', `cell ${addr} (${c}) is not translated: ${t.why}`); return null; }
      if (t.expr === null) warn(sheet.name, 'expressions', `cell ${addr} (${c}) has no kernel equivalent; its value ${t.value} is kept`);
      return { nameHint: cell.alias || `${sheet.name}_${addr}`, expr: t.expr ?? String(t.value), value: t.value, path: cell.alias ? `${sheet.name}.alias:${cell.alias}` : `${sheet.name}.cell:${addr}`, source: `${sheet.name}.${cell.alias || addr}` };
    });
  }

  function propVar(o: PObj, prop: string): Var | null {
    return make(`${o.name}.${prop}`, () => {
      const raw = env.attr(o, prop);
      if (raw === null) return null;
      const stored = Number(raw === 'true' ? 1 : raw === 'false' ? 0 : raw);
      if (!Number.isFinite(stored)) return null;
      const e = engine(o).get(prop);
      let expr = String(stored), value = stored;
      if (e) {
        const t = translate(o, e);
        if (!('why' in t) && t.expr !== null && Math.abs(t.value - stored) <= REL * Math.max(1, Math.abs(stored))) { expr = t.expr; value = t.value; }
        else warn(o.name, 'expressions', `${prop} = ${e} is kept as the number ${stored}${'why' in t ? ` (${t.why})` : t.expr === null ? ' (no kernel equivalent)' : ` (the expression gives ${t.value})`}`);
      }
      return { nameHint: `${o.name}_${prop}`, expr, value, path: `${o.name}.${prop}`, source: `${o.name}.${prop}` };
    });
  }

  function constraintVar(sk: PObj, name: string): Var | null {
    return make(`${sk.name}.Constraints.${name}`, () => {
      const c = env.constraints(sk).find((x) => x.name === name);
      if (!c) return null;
      const stored = c.type === 9 ? (c.value * 180) / Math.PI : c.value;
      const e = engine(sk).get(`Constraints.${name}`);
      let expr = String(stored), value = stored;
      if (e) {
        const t = translate(sk, e);
        if (!('why' in t) && t.expr !== null && Math.abs(t.value - stored) <= REL * Math.max(1, Math.abs(stored))) { expr = t.expr; value = t.value; }
        else warn(sk.name, 'expressions', `constraint ${name} = ${e} is kept as the number ${stored}${'why' in t ? ` (${t.why})` : t.expr === null ? ' (no kernel equivalent)' : ` (the expression gives ${t.value})`}`);
      }
      return { nameHint: `${sk.name}_${name}`, expr, value, path: `${sk.name}.Constraints.${name}`, source: `${sk.name}.Constraints.${name}` };
    });
  }

  /**
   * Property `prop` of `o` bound by an expression: its kernel text and value when it translates and reproduces `stored`; null when the
   * property has no expression or it cannot be used (a reason is reported then).
   */
  function bound(o: PObj, prop: string, stored: number): { expr: string; value: number } | null {
    const e = engine(o).get(prop);
    if (!e) return null;
    const t = translate(o, e);
    if ('why' in t) { warn(o.name, 'expressions', `${prop} = ${e} is not translated (${t.why}); the number ${stored} is kept`); return null; }
    if (t.expr === null) { warn(o.name, 'expressions', `${prop} = ${e} has no kernel equivalent (conditional or unsupported function); the number ${stored} is kept`); return null; }
    if (Math.abs(t.value - stored) > REL * Math.max(1, Math.abs(stored))) { warn(o.name, 'expressionValue', `${prop} = ${e} gives ${t.value} here but FreeCAD stored ${stored}; the number is kept`); return null; }
    return { expr: t.expr, value: t.value };
  }

  /** Does the object's expression engine hold an expression for a path such as `Length` or `Constraints.Width`? */
  const hasExpr = (o: PObj, prop: string) => engine(o).has(prop);
  /** Every expression path of an object that the importer did not use (for the report). */
  const exprPaths = (o: PObj) => [...engine(o).keys()];

  /** the variable already made for a key (`Obj.Prop`, `Sketch.Constraints.Name`), if any */
  const peek = (key: string) => cache.get(key) ?? null;
  return { variables, bound, hasExpr, exprPaths, constraintVar, propVar, peek, FcExprError, refsOf };
}
