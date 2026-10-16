// Generates src/registry.generated.json mechanically from the TypeScript source of packages/script (recorder.ts, selectors.ts) and the
// hand-written pitfall notes in notes/<id>.md. A purely mechanical extraction: no AI, no kernel. Run: npm run skill:generate
// The TypeScript compiler API is not available (typescript 7 is the native compiler), so the source is parsed with @babel/parser
// (typescript plugin), which keeps comments and positions. Needs the JSDoc tags: @domain, @param, @example, @see.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const scriptSrc = path.resolve(root, '../script/src');
export const OUT = path.join(root, 'src/registry.generated.json');
const DOMAINS = ['sketch', 'features', 'selectors', 'holes', 'patterns', 'surfaces', 'assembly', 'utilities'];

const parseTs = (code) => parse(code, { sourceType: 'module', plugins: ['typescript'], attachComment: true });

/** JSDoc block text -> { summary, description, tags }. */
function parseDoc(comment) {
  const body = comment.value.split('\n').map((l) => l.replace(/^\s*\*\s?/, '').replace(/\s+$/, ''));
  while (body.length && !body[0]) body.shift();
  while (body.length && !body[body.length - 1]) body.pop();
  const free = [], tags = []; let cur = null;
  for (const l of body) {
    const m = /^@(\w+)\s*(.*)$/.exec(l);
    if (m) { cur = { tag: m[1], lines: [m[2]] }; tags.push(cur); } else if (cur) cur.lines.push(l); else free.push(l);
  }
  const paras = free.join('\n').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return { summary: (paras[0] ?? '').replace(/\s*\n\s*/g, ' '), description: paras.slice(1).join(' ').replace(/\s*\n\s*/g, ' '), tags };
}
const lastDoc = (node) => [...(node.leadingComments ?? [])].reverse().find((c) => c.type === 'CommentBlock' && c.value.startsWith('*'));

export function generate() {
  const src = fs.readFileSync(path.join(scriptSrc, 'recorder.ts'), 'utf8');
  const selSrc = fs.readFileSync(path.join(scriptSrc, 'selectors.ts'), 'utf8');
  const ast = parseTs(src);
  const slice = (n) => src.slice(n.start, n.end);
  const types = {}; const ifaces = {};
  for (const n of ast.program.body) {
    const d = n.type === 'ExportNamedDeclaration' ? n.declaration : n;
    if (d?.type === 'TSTypeAliasDeclaration') types[d.id.name] = slice(d.typeAnnotation);
    if (d?.type === 'TSInterfaceDeclaration') ifaces[d.id.name] = d;
  }
  // EdgeRule is documented where it lives
  const selAst = parseTs(selSrc);
  for (const n of selAst.program.body) {
    const d = n.type === 'ExportNamedDeclaration' ? n.declaration : n;
    if (d?.type === 'TSInterfaceDeclaration' && d.id.name === 'EdgeRule') {
      types.EdgeRule = selSrc.slice(d.body.start, d.body.end).replace(/\s*\n\s*/g, ' ').replace(/\s*\/\*\*.*?\*\/\s*/g, ' ');
    }
  }
  types.FaceSel = 'the result of face(sel)';
  types.EdgeSel = 'the result of edges(sel)';

  const methods = [];
  const members = (typeNode, aliases) => {
    let t = typeNode;
    if (t?.type === 'TSTypeReference' && aliases[t.typeName.name]) t = aliases[t.typeName.name];
    const list = t?.type === 'TSTypeLiteral' ? t.members : t?.type === 'TSTypeReference' && ifaces[t.typeName.name] ? ifaces[t.typeName.name].body.body : null;
    if (!list) return undefined;
    return list.filter((m) => m.type === 'TSPropertySignature').map((m) => ({ name: m.key.name, type: slice(m.typeAnnotation.typeAnnotation), optional: !!m.optional }));
  };
  const addMethod = ({ id, kind, call, fn, doc, aliases = {} }) => {
    if (!doc) throw new Error(`${id}: no JSDoc`);
    const d = parseDoc(doc);
    const tag = (t) => d.tags.filter((x) => x.tag === t);
    const domain = tag('domain')[0]?.lines[0]?.trim();
    if (!DOMAINS.includes(domain)) throw new Error(`${id}: @domain missing or unknown (${domain})`);
    if (!d.summary || !d.description) throw new Error(`${id}: JSDoc needs a summary paragraph and a description paragraph`);
    const pdoc = {};
    for (const t of tag('param')) { const m = /^(\S+)\s*(.*)$/s.exec(t.lines.join(' ')); if (m) pdoc[m[1]] = m[2]; }
    const resolve = (txt) => txt.replace(/\b[A-Za-z_]\w*\b/g, (w) => (aliases[w] ? slice(aliases[w]) : w));
    const params = fn.params.map((p) => {
      const base = p.type === 'AssignmentPattern' ? p.left : p;
      const def = p.type === 'AssignmentPattern' ? slice(p.right) : undefined;
      const tn = base.typeAnnotation?.typeAnnotation;
      const type = tn ? resolve(slice(tn)) : def !== undefined && /^-?\d/.test(def) ? 'number' : def !== undefined && /^['"]/.test(def) ? 'string' : 'unknown';
      const props = members(tn, aliases)?.map((m) => ({ ...m, description: pdoc[`${base.name}.${m.name}`] ?? '' }));
      return { name: base.name, type, optional: !!base.optional || def !== undefined, ...(def !== undefined ? { default: def } : {}), description: pdoc[base.name] ?? (props?.some((q) => q.description) ? 'options object, see properties' : ''), ...(props ? { properties: props } : {}) };
    });
    for (const p of params) if (!p.description) throw new Error(`${id}: parameter ${p.name} has no @param text`);
    const ret = fn.returnType ? resolve(slice(fn.returnType.typeAnnotation)) : undefined;
    const sig = `${call}(${params.map((p) => `${p.name}${p.optional && p.default === undefined ? '?' : ''}: ${p.type}${p.default !== undefined ? ` = ${p.default}` : ''}`).join(', ')})${ret ? `: ${ret}` : ''}`;
    const ex = tag('example')[0];
    methods.push({
      id, kind, domain, signature: sig, summary: d.summary, description: d.description, parameters: params,
      ...(ret ? { returns: ret } : {}),
      example: ex ? ex.lines.join('\n').trim() : '',
      related: tag('see').flatMap((t) => t.lines.join(' ').split(',').map((s) => s.trim()).filter(Boolean)),
    });
  };

  for (const n of ast.program.body) {
    // free functions: export const face = (...) => ...
    if (n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'VariableDeclaration') {
      for (const v of n.declaration.declarations) {
        if (v.init?.type !== 'ArrowFunctionExpression') continue;
        const doc = lastDoc(n);
        if (!doc || !/@domain/.test(doc.value)) continue;
        addMethod({ id: v.id.name, kind: 'function', call: v.id.name, fn: v.init, doc });
      }
    }
    const cls = n.type === 'ExportNamedDeclaration' ? n.declaration : n;
    if (cls?.type === 'ClassDeclaration' && (cls.id.name === 'SketchBuilder' || cls.id.name === 'PartBuilder')) {
      const sk = cls.id.name === 'SketchBuilder';
      for (const m of cls.body.body) {
        if (m.type !== 'ClassMethod' || m.accessibility === 'private' || m.kind === 'constructor') continue;
        if (m.kind === 'get' && m.key.name === 'holes') {
          const ret = m.body.body.find((s) => s.type === 'ReturnStatement');
          const aliases = {};
          for (const s of m.body.body) if (s.type === 'TSTypeAliasDeclaration') aliases[s.id.name] = s.typeAnnotation;
          for (const pr of ret.argument.properties) addMethod({ id: `part.holes.${pr.key.name}`, kind: 'method', call: `.holes.${pr.key.name}`, fn: pr.value, doc: lastDoc(pr), aliases });
          continue;
        }
        if (m.kind !== 'method') continue;
        if (!lastDoc(m)) throw new Error(`${cls.id.name}.${m.key.name}: public method without JSDoc`);
        addMethod({ id: `${sk ? 'sketch' : 'part'}.${m.key.name}`, kind: 'method', call: sk ? `s.${m.key.name}` : `.${m.key.name}`, fn: m, doc: lastDoc(m) });
      }
    }
    // makeApi's returned object: part, variables, expr
    if (n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'FunctionDeclaration' && n.declaration.id.name === 'makeApi') {
      const ret = n.declaration.body.body.find((s) => s.type === 'ReturnStatement');
      for (const pr of ret.argument.properties) {
        if (pr.type !== 'ObjectProperty' || pr.shorthand) continue;
        addMethod({ id: pr.key.name, kind: 'function', call: pr.key.name, fn: pr.value, doc: lastDoc(pr) });
      }
    }
  }
  const ids = new Set(methods.map((m) => m.id));
  const resolveId = (r) => (ids.has(r) ? r : methods.find((m) => m.id.endsWith('.' + r))?.id);
  for (const m of methods) m.related = m.related.map((r) => { const id = resolveId(r); if (!id) throw new Error(`${m.id}: @see ${r} does not exist`); return id; });
  // hand-written pitfall notes
  const notesDir = path.join(root, 'notes');
  const notesFiles = fs.existsSync(notesDir) ? fs.readdirSync(notesDir).filter((f) => f.endsWith('.md')).sort() : [];
  for (const f of notesFiles) {
    const id = f.slice(0, -3);
    const m = methods.find((x) => x.id === id);
    if (!m) throw new Error(`notes/${f}: no method ${id}`);
    m.notes = fs.readFileSync(path.join(notesDir, f), 'utf8').trim();
  }
  const order = (m) => DOMAINS.indexOf(m.domain);
  methods.sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
  return { version: 1, source: 'packages/script/src/recorder.ts', domains: DOMAINS.filter((d) => methods.some((m) => m.domain === d)), types, methods };
}

export const render = (reg) => JSON.stringify(reg, null, 1) + '\n';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const reg = generate();
  fs.writeFileSync(OUT, render(reg));
  console.log(`registry: ${reg.methods.length} methods -> ${path.relative(process.cwd(), OUT)}`);
}
