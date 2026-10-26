// Syntax colouring for the Script box: splits JavaScript into spans (comment, string, number, keyword, call) and returns the pieces; the panel draws them under the transparent textarea.
export type Tok = { text: string; kind?: 'com' | 'str' | 'num' | 'kw' | 'fn' };

const KW = new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'of', 'in', 'new', 'true', 'false', 'null', 'undefined', 'import', 'export', 'from', 'await', 'async', 'class', 'break', 'continue', 'typeof', 'this']);
// one alternative per kind; the order matters (comments before the division sign, strings before words)
const RE = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?|`(?:\\[\s\S]|[^`\\])*`?)|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|\.\d+\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;

export function highlight(code: string): Tok[] {
  const out: Tok[] = [];
  let at = 0;
  for (const m of code.matchAll(RE)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: code.slice(at, i) });
    const [txt, com, str, num, fn, word] = m;
    if (com) out.push({ text: txt, kind: 'com' });
    else if (str) out.push({ text: txt, kind: 'str' });
    else if (num) out.push({ text: txt, kind: 'num' });
    else if (fn) out.push(KW.has(txt) ? { text: txt, kind: 'kw' } : { text: txt, kind: 'fn' });
    else if (word && KW.has(txt)) out.push({ text: txt, kind: 'kw' });
    else out.push({ text: txt });
    at = i + txt.length;
  }
  if (at < code.length) out.push({ text: code.slice(at) });
  return out;
}
