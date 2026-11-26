import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain .mjs module without types
import { checkGuideLinks } from './check_guide_links.mjs';

describe('checkGuideLinks', () => {
  it('accepts a page and anchor that exist and reports the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guide-'));
    mkdirSync(join(dir, 'modelling'));
    writeFileSync(join(dir, 'modelling', 'curves.html'), '<h2 id="wrap"><a class="header" href="#wrap">Wrap</a></h2>');
    const h = (guide: string | undefined) => ({ id: 'x', guide, guideText: 'T' });
    const bad = checkGuideLinks({
      '1.0.0': [h('/docs/cad/modelling/curves.html#wrap'), h(undefined), h('/docs/cad/modelling/curves.html#nope'), h('/docs/cad/modelling/none.html#wrap'), h('/docs/cad/modelling/curves/#wrap')],
    }, dir) as Array<{ problem: string }>;
    expect(bad.map((b) => b.problem)).toEqual(['no such anchor on the page', 'no such page', 'not of the form /docs/cad/<page>.html#<anchor>']);
  });
});
