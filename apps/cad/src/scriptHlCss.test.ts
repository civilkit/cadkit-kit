import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The coloured copy of the code under the Script textarea is slid up and left as the textarea scrolls. If its own box clips
// (overflow hidden) only the first screenful of lines is ever painted and everything below is blank after a scroll; the clip
// belongs on the wrapper around it.
describe('Script box colour layer', () => {
  const css = readFileSync(join(process.cwd(), 'apps/cad/src/app.css'), 'utf8');
  const rule = (sel: string) => new RegExp('\\n' + sel.replace(/[.]/g, '\\.') + ' \\{([^}]*)\\}').exec(css)?.[1] ?? '';
  it('does not clip its own content', () => {
    expect(rule('.script-hl')).toContain('position: absolute');
    expect(rule('.script-hl')).not.toMatch(/overflow:\s*hidden/);
  });
  it('is clipped by its wrapper in the panel', () => {
    const panel = readFileSync(join(process.cwd(), 'apps/cad/src/ScriptPanel.tsx'), 'utf8');
    expect(panel).toMatch(/position:relative;flex:1;min-width:0;overflow:hidden">\s*<div ref=\{bands\}/);
  });
});
