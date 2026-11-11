import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// @ts-expect-error plain .mjs module without types
import { esc, firstSentence, inline, parseChangelog, renderPage, PAGE_DIR } from './make_whats_new.mjs';
// @ts-expect-error plain .mjs module without types
import { scanText } from './pages_leakcheck.mjs';

const repo = resolve(__dirname, '..');
const changelog = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8');
const highlights = JSON.parse(readFileSync(join(repo, 'docs', 'whats-new', 'highlights.json'), 'utf8'));
const page: string = renderPage(changelog, highlights);

describe("What's new page", () => {
  it('equals what the generator writes from the changelog now', () => {
    const file = join(PAGE_DIR, 'index.html');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(page);
  });

  it('lists every entry of every released version (title and first sentence)', () => {
    const releases = parseChangelog(changelog) as Array<{ version: string; entries: string[] }>;
    expect(releases.length).toBeGreaterThan(0);
    for (const r of releases) {
      for (const e of r.entries) {
        const m = /^\*\*(.+?)\*\*\s*(.*)$/s.exec(e);
        const line = (m ? `<strong>${inline(m[1])}</strong> ${inline(firstSentence(m[2]))}` : inline(firstSentence(e))) as string;
        expect(page, `${r.version}: ${e.slice(0, 60)}`).toContain(line);
      }
    }
  });

  it('has a heading and a highlight card for every highlight of a released version', () => {
    const versions = new Set((parseChangelog(changelog) as Array<{ version: string }>).map((r) => r.version));
    for (const [v, list] of Object.entries(highlights) as Array<[string, Array<{ id: string; title: string }>]>) {
      if (!versions.has(v)) continue;   // coming release: kept off the page on purpose
      for (const h of list) expect(page, `${v}/${h.id}`).toContain(esc(h.title));
    }
  });

  it('carries no local path, internal host, address or em-dash', () => {
    expect(page).not.toMatch(/—/);
    // the suite header and footer link to the public repository; nothing else may match
    const hits = (scanText(page) as Array<{ id: string; context: string }>).filter((h) => !/github\.com\/internal-org\/civilkit-/.test(h.context));
    expect(hits.map((h) => h.id)).toEqual([]);
  });
});
