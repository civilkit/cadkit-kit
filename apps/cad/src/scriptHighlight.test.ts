import { describe, it, expect } from 'vitest';
import { highlight } from './scriptHighlight';

const kinds = (s: string): string[] => highlight(s).filter((t) => t.kind).map((t) => `${t.kind}:${t.text}`);

describe('script highlighting', () => {
  it('keeps every character, in order', () => {
    const code = "// c\nconst { w } = variables({ w: 60 });\npart('B').extrude(expr('t')) /* x */\n`a${1}b`";
    expect(highlight(code).map((t) => t.text).join('')).toBe(code);
  });
  it('marks comments, strings, numbers, keywords and calls', () => {
    expect(kinds("const a = f(1.5, 'x'); // hi")).toEqual(['kw:const', 'fn:f', 'num:1.5', "str:'x'", 'com:// hi']);
  });
  it('does not colour words inside strings or comments', () => {
    expect(kinds("'const 1' // return 2")).toEqual(["str:'const 1'", 'com:// return 2']);
  });
  it('handles an unterminated string or block comment', () => {
    expect(kinds("'abc")).toEqual(["str:'abc"]);
    expect(kinds('/* open')).toEqual(['com:/* open']);
  });
  it('treats a keyword followed by a bracket as a keyword', () => {
    expect(kinds('if (a) return')).toEqual(['kw:if', 'kw:return']);
  });
});
