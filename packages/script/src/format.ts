// A light formatter for script text: re-indents by bracket depth and tidies whitespace. It never changes tokens, line breaks or comments' text,
// so formatting cannot change what a script builds. (Line wrapping would need a real pretty-printer.)

const OPEN = '([{', CLOSE = ')]}';

/** The brackets of a line in order (ignoring strings, comments and template literals), and how many of them are closers at the very start. */
function scan(line: string, st: { block: boolean; tpl: boolean }): { br: string; lead: number } {
  let br = '', lead = 0, seen = false;
  let i = 0;
  let quote = '';
  while (i < line.length) {
    const c = line[i], n = line[i + 1];
    if (st.block) { if (c === '*' && n === '/') { st.block = false; i += 2; continue; } i++; continue; }
    if (st.tpl) { if (c === '\\') { i += 2; continue; } if (c === '`') { st.tpl = false; } i++; continue; }
    if (quote) { if (c === '\\') { i += 2; continue; } if (c === quote) quote = ''; i++; continue; }
    if (c === '/' && n === '/') break;
    if (c === '/' && n === '*') { st.block = true; i += 2; continue; }
    if (c === '"' || c === "'") { quote = c; seen = true; i++; continue; }
    if (c === '`') { st.tpl = true; seen = true; i++; continue; }
    if (c === ' ' || c === '\t') { i++; continue; }
    if (CLOSE.includes(c)) { br += c; if (!seen) lead++; } else if (OPEN.includes(c)) { br += c; seen = true; } else seen = true;
    i++;
  }
  return { br, lead };
}

export function formatScript(src: string, indent = '  '): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const st = { block: false, tpl: false };
  const stack: number[] = [];   // for each open bracket: the indent level of the line that opened it
  let blank = 0;
  for (const raw of lines) {
    // inside a template literal or a block comment the text is left exactly as written
    if (st.tpl) { scan(raw, st); out.push(raw); blank = 0; continue; }
    if (st.block) { const body = raw.trimEnd(); scan(raw, st); const lvl = stack.length ? stack[stack.length - 1] + 1 : 0; out.push(body.trim().startsWith('*') ? indent.repeat(lvl) + ' ' + body.trim() : body); blank = 0; continue; }
    const text = raw.trim();
    if (!text) { blank++; if (blank <= 1 && out.length) out.push(''); continue; }
    blank = 0;
    const { br, lead } = scan(text, st);
    let level: number;
    if (lead > 0) {
      let last = 0;
      for (let k = 0; k < lead; k++) last = stack.pop() ?? 0;
      level = last;   // a line that starts by closing sits where the line that opened the bracket sits
    } else level = (stack.length ? stack[stack.length - 1] + 1 : 0) + (text.startsWith('.') ? 1 : 0);
    for (const c of br.slice(lead)) { if (OPEN.includes(c)) stack.push(level); else stack.pop(); }
    out.push(indent.repeat(level) + text);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}
