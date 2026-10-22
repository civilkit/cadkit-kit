import { describe, expect, it } from 'vitest';
import { formatScript } from './format';
import { evaluate } from './run';
import { EXAMPLES } from './examples';
import { PICKLEBALL_SCRIPT } from './pickleball';

describe('formatScript', () => {
  it('indents by bracket depth and chains one level deeper', () => {
    const src = "part('A')\n.sketch('front', (s) => {\ns.rect(1, 2);\n})\n  .extrude(3);\n";
    expect(formatScript(src)).toBe("part('A')\n  .sketch('front', (s) => {\n    s.rect(1, 2);\n  })\n  .extrude(3);\n");
  });
  it('lines that start with closers sit one level out, and else-branches line up', () => {
    expect(formatScript('if (a) {\nx();\n} else {\ny();\n}\n')).toBe('if (a) {\n  x();\n} else {\n  y();\n}\n');
  });
  it('brackets in strings and comments do not count', () => {
    const src = "const a = '(((';\n// }}}\nfoo();\n";
    expect(formatScript(src)).toBe(src);
  });
  it('leaves template literals and block comments alone', () => {
    const src = 'const t = `a\n   b {\n c`;\n/* x\n * y */\nfoo();\n';
    expect(formatScript(src)).toBe('const t = `a\n   b {\n c`;\n/* x\n * y */\nfoo();\n');
  });
  it('trims trailing spaces, collapses blank runs and ends with one newline', () => {
    expect(formatScript('a();   \n\n\n\nb();\n\n\n')).toBe('a();\n\nb();\n');
  });
  it('is idempotent on every example', () => {
    for (const code of [PICKLEBALL_SCRIPT, ...EXAMPLES.filter((e) => !e.id.startsWith('matx')).map((e) => e.code)]) {
      const once = formatScript(code);
      expect(formatScript(once)).toBe(once);
    }
  });
  it('does not change what a script builds', () => {
    for (const code of [PICKLEBALL_SCRIPT, EXAMPLES[0].code]) {
      const a = evaluate(code), b = evaluate(formatScript(code));
      expect(b.errors).toEqual(a.errors);
      expect(b.state.parts.map((p) => p.steps.length)).toEqual(a.state.parts.map((p) => p.steps.length));
      expect(b.state.varDefs).toEqual(a.state.varDefs);
    }
  });
});
