import { describe, expect, it } from 'vitest';
import { HIDE_LINKS, docsLink, licencesLink } from './siteLinks.mjs';

describe('the published site links', () => {
  it('keep their ids (the smoke test and the more menu look them up) and carry the class the phone layouts hide', () => {
    expect(licencesLink()).toContain('id="licences-link" class="site-link" href="licenses.html"');
    expect(docsLink()).toContain('id="docs-link" class="site-link" href="/docs/cad/"');
  });
  it('are hidden on a phone and a tablet, where the bottom bar is', () => {
    expect(licencesLink()).toContain(HIDE_LINKS);
    expect(HIDE_LINKS).toContain('[data-layout="phone"]');
    expect(HIDE_LINKS).toContain('[data-layout="tablet"]');
  });
});
