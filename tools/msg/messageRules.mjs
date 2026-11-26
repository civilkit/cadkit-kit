// Prototype of the message-quality rules (see SPEC.md section 6). Pure functions: text in, list of rule ids out.
// The kit test (apps/cad/src/messageQuality.test.ts) imports these, feeds every catalogue message, and fails on any violation not in the ratchet baseline.

export const FORBIDDEN = [
  'coedge', 'pcurve', 'tangent chain', 'closed spline', 'free-form curve', 'rim', 'torus', 'nurbs', 'b-rep', 'brep', 'manifold', 'non-manifold',
  'euler', 'tessellat', 'degenerate', 'knot', 'weld', 'ulp', 'epsilon', 'g0', 'g1', 'g2', 'parametrisation', 'parametrization', 'periodic', 'seam',
  'spine', 'station', 'boolean did not assemble', 'kernel', 'wasm', 'json', 'regen', 'regenerat', 'null', 'undefined', 'NaN', 'stack', 'exception',
  'autoFuzzy', 'refDiff', 'shell.rs', 'ck-', 'zone section', 'patch fit', 'in-place corner', 'overhang corner', 'half space', 'ring tool', 'tool leg', 'centre did not converge', 'singular',
];
// words that are fine in a CAD vocabulary the user meets in the UI (they are matched whole-word and removed from FORBIDDEN hits)
export const ALLOWED_CONTEXT = ['kernel']; // only inside Settings > Kernel strings (key prefix settings.kernel / kernel.*)

const SENT = (s) => s.replace(/\{[^}]*\}/g, 'X').split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map((x) => x.trim()).filter(Boolean);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
const contain = (a, b) => { const A = words(a), B = words(b); const m = Math.min(A.size, B.size); if (m < 4) return 0; let i = 0; for (const w of A) if (B.has(w)) i++; return i / m; };
const jacc = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let i = 0; for (const w of A) if (B.has(w)) i++; return i / (A.size + B.size - i); };

const RANGE = /\b(must|at least|at most|between|above|below|more than|less than|larger than|smaller than|no larger|no more|whole number)\b/i;
const ACTION = /\b(use|pick|choose|select|move|try|change|set|make|add|remove|close|open|undo|raise|lower|reduce|increase|enter|type|check|flip|split|round|unite|simplify|reopen|drag|click|draw|connect|join|delete|redo|shorten|widen|narrow|wait|install|start|paste|export|import|turn|keep|leave|give|fix|rename|repair|reselect|rebuild|save|reload|run|sign|replace|apply|allow)\b/i;

/** Rules apply to one message. kind: 'refusal' (an operation was refused or failed), 'warning', 'info', 'hint' (guidance line), 'validation' (a field rule). */
export function check(text, { kind = 'refusal', key = '', collapsed = false } = {}) {
  const out = [];
  const t = text.trim();
  if (!t) return ['empty'];
  const sents = SENT(t);
  // 1 duplicate or near-duplicate sentence
  for (let i = 0; i < sents.length; i++) for (let j = i + 1; j < sents.length; j++) {
    if (norm(sents[i]) === norm(sents[j]) || jacc(sents[i], sents[j]) >= 0.7 || contain(sents[i], sents[j]) >= 0.8) out.push('dup');
  }
  // 2 forbidden words (whole word / stem)
  if (!collapsed) {
    const low = t.toLowerCase();
    for (const w of FORBIDDEN) {
      if (ALLOWED_CONTEXT.includes(w) && /^(settings\.kernel|kernel\.|chat\.)/.test(key)) continue;
      const re = new RegExp(/^[a-z0-9]{1,3}$/i.test(w) || /[-]/.test(w) ? `(^|[^a-z0-9])${w}([^a-z0-9]|$)` : `(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      if (re.test(low)) { out.push('jargon:' + w); break; }
    }
  }
  // 3 raw key patterns
  if (/\b[A-Z]{2,}(\.[A-Z0-9_]+){2,}\b/.test(t) || /\b(app|diag|asm|io|sk3d|kernel)\.[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+\b/.test(t) || /`[^`]+`/.test(t)) out.push('rawkey');
  // 4 internal ids: F12, F3.B0, F2.S.e1~1, e1~1, edge#12, face ids
  if (/\bF\d+(\.[A-Za-z0-9~|]+)*\b/.test(t) && !/\{/.test(t.match(/\bF\d+/)?.[0] ?? '')) out.push('id');
  if (/\b[a-z]\d+~\d+\b|\b(edge|face|loop|vertex)#\d+\b|\.B\d+\b|\|/.test(t)) out.push('id');
  // 5 camelCase code words shown in words
  if (/\b[a-z]+[A-Z][a-zA-Z]+\b/.test(t.replace(/\{[^}]*\}/g, ''))) out.push('camel');
  // 6 length: at most 2 sentences and 200 characters visible (details are collapsed)
  if (!collapsed && (sents.length > 2 || t.length > 200) && kind !== 'help') out.push('long');
  // 7 refusal without a next step
  if ((kind === 'refusal' || kind === 'warning') && !ACTION.test(t) && !RANGE.test(t)) out.push('noaction');
  // 8 alarming or untrue state claims
  if (/\b(broke|broken|corrupt|crash|fatal|destroyed|lost your)\b/i.test(t) && kind === 'refusal') out.push('alarm');
  // 9 generic fallback advice
  if (/Undo the last change, or adjust the values of this feature until it builds again/.test(t)) out.push('generic');
  // 10 "yet" / "not supported" without a way round
  if (/\b(not supported|not implemented|cannot be \w+ yet|not available yet)\b/i.test(t) && !ACTION.test(t)) out.push('dead-end');
  // 11 stage directions and developer phrasing
  if (/\b(the kernel|the engine|the solver|the builder) (could not|cannot|failed|refused|gave up)\b/i.test(t)) out.push('blame-engine');
  return [...new Set(out)];
}
export { SENT };

/** The structured form (kernel `cause` + `action`, or kit cause + advice): the structural rules the sentence heuristics cannot see. */
export function checkPair(cause, action, { kind = 'refusal', key = '' } = {}) {
  const out = [];
  const c = (cause ?? '').trim(), a = (action ?? '').trim();
  if (!c) out.push('nocause');
  if (c.length > 110) out.push('cause-long');
  if (SENT(c).length > 1) out.push('cause-multi');
  if (kind === 'refusal') {
    if (!a) out.push('noaction');
    else {
      if (a.length > 100) out.push('action-long');
      if (SENT(a).length > 1) out.push('action-multi');
      if (/^(the|a|an|this|that|there|it|they|your|you)\b/i.test(a)) out.push('action-not-imperative');
      if (!/[A-Z]/.test(a[0])) out.push('action-case');
    }
  }
  if (!/[A-Z{"“]/.test(c[0] ?? 'x') && c) out.push('cause-case');
  if (/[.!?]$/.test(c) === false && c) out.push('cause-nodot');
  if (norm(c) === norm(a) || jacc(c, a) >= 0.7) out.push('dup');
  // the words rules apply to both parts, not to {placeholders}
  const words = check(`${c} ${a}`.replace(/\{[^}]*\}/g, 'N'), { kind: 'info', key }).filter((x) => x !== 'long' && x !== 'dup');
  return [...new Set([...out, ...words])];
}
