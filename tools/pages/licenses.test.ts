import { describe, it, expect } from 'vitest';
import { filterKernelThirdParty, mdToHtml, renderLicensesHtml } from './licenses.mjs';

const kernel = `# Third-party code

| Path | Source | Licence |
|---|---|---|
| crates/ck-check/src/x.rs | brepkit | MIT OR Apache-2.0 |
| crates/ck-io/src/sat/{mod,parse,build}.rs | the author's own sat_import.rs in SGRebuild | same author |
| crates/new-thing/foo.rs | something nobody reviewed | MIT |

## Curated fonts (hosted by the kit)

| Role | Font |
|---|---|
| sans | Barlow |
`;

describe('filterKernelThirdParty', () => {
  const r = filterKernelThirdParty(kernel);
  it('keeps reviewed rows and drops private-project rows, unreviewed rows and the hosted-fonts section', () => {
    expect(r.md).toContain('crates/ck-check/src/x.rs');
    expect(r.md).not.toContain('SGRebuild');
    expect(r.md).not.toContain('new-thing');
    expect(r.md).not.toContain('Barlow');
    expect(r.md).toContain('| Path | Source | Licence |');
  });
  it('lists what it removed and why', () => {
    expect(r.filtered.map((f) => f.why)).toEqual(expect.arrayContaining([expect.stringContaining('private project'), 'not reviewed for publication']));
  });
});

describe('mdToHtml', () => {
  it('escapes HTML, renders tables and fences', () => {
    const h = mdToHtml('# T\n\n| a | b |\n|---|---|\n| <x> | `c` |\n\n```\n<pre>\n```');
    expect(h).toContain('<h1>T</h1>');
    expect(h).toContain('<td>&lt;x&gt;</td>');
    expect(h).toContain('<td><code>c</code></td>');
    expect(h).toContain('<pre>&lt;pre&gt;</pre>');
  });
});

describe('renderLicensesHtml', () => {
  it('includes BOSL2 text passed in the kit file and links back to the app', () => {
    const h = renderLicensesHtml({ kit: '## BOSL2 licence (BSD 2-Clause)\n\n```\nBSD 2-Clause License\n```', licences: [{ title: 'OFL', text: 'SIL OPEN FONT LICENSE' }], deps: [{ name: 'preact', version: '10', license: 'MIT' }] });
    expect(h).toContain('BSD 2-Clause License');
    expect(h).toContain('SIL OPEN FONT LICENSE');
    expect(h).toContain('href="./"');
    expect(h).toContain('<code>preact</code>');
  });
});
