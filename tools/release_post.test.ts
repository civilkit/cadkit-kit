import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
// @ts-expect-error plain .mjs module without types
import { buildPost, pickReleases, sameTopic, sentence } from './release_post.mjs';
// @ts-expect-error plain .mjs module without types
import { scanText } from './pages_leakcheck.mjs';

const repo = resolve(__dirname, '..');
const changelog = `# Changelog

## Unreleased

- **Not yet.** Unreleased work stays out.

## 0.7.0 - 2026-11-20

- **Open STEP faster.** Big files open in half the time. The cache is new.
- **A \`hole\` can target a [body](https://example.com/body).** Pass \`target\`; nothing else changes.
- **Rounded rectangle tool.** Click two corners.
- Plain entry without a title. More words here.

## 0.6.9 - 2026-11-15

- **Fix one.** Fixed one.
- **Fix two.** Fixed two.

## 0.6.8 - 2026-11-14

- **Fix three.** Fixed three.
`;
const highlights = {
  '0.7.0': [
    { id: 'step-speed', title: 'Open STEP faster', blurb: 'Big files open in half the time. The cache is new.' },
    { id: 'round-rect', title: 'A Rounded rectangle sketch tool', blurb: 'Click two corners and they come out rounded.' },
  ],
  '0.6.9': [{ id: 'x', title: 'Fix highlight', blurb: 'Fixed.' }],
};

describe('release post', () => {
  const p = buildPost({ changelog, highlights, version: '0.7.0' });

  it('starts with a plain title of at most 300 characters', () => {
    expect(p.text.split('\n')[0]).toBe(p.title);
    expect(p.title).toBe('CivilKit CAD 0.7.0: Open STEP faster; a Rounded rectangle sketch tool');
    expect(p.title.length).toBeLessThanOrEqual(300);
    expect(p.title).not.toMatch(/[`*\[\]!]/);
    const long = buildPost({ changelog, highlights: { '0.7.0': [{ id: 'a', title: 'x'.repeat(400), blurb: 'b.' }] }, version: '0.7.0' });
    expect(long.title.length).toBeLessThanOrEqual(300);
  });

  it('has no empty section and the fixed headings', () => {
    const sections = p.body.split(/^## /m).slice(1);
    expect(sections.map((s: string) => s.split('\n')[0])).toEqual(['Highlights', 'Also in this release', 'Links']);
    for (const s of sections) expect(s.split('\n').slice(1).join('\n').trim().length).toBeGreaterThan(0);
    expect(p.body).toContain('https://civilkit.io/cad/whats-new/#v0-7-0');
    expect(p.body).toContain('Feedback and bug reports are welcome');
  });

  it('keeps highlights out of the other list, and keeps backticks and links in entries', () => {
    expect(p.body).not.toContain('Open STEP faster.**');
    expect(p.body).toContain('- **A `hole` can target a [body](https://example.com/body).** Pass `target`; nothing else changes.');
    expect(p.body).not.toContain('Unreleased work');
    expect(p.body).toContain('- Plain entry without a title.');
  });

  it('mentions the Mac app only when asked', () => {
    expect(p.body).not.toContain('Mac app');
    expect(buildPost({ changelog, highlights, version: '0.7.0', mac: true }).body).toContain('unsigned: macOS blocks the first start, the release notes say how to open it');
  });

  it('caps the also-list and summarises the rest', () => {
    const many = '## 1.0.0 - 2026-12-01\n\n' + Array.from({ length: 20 }, (_, i) => `- **Item ${i}.** Text ${i}.`).join('\n') + '\n';
    const q = buildPost({ changelog: many, highlights: null, version: '1.0.0', max: 12 });
    expect(q.body.match(/^- \*\*Item/gm)).toHaveLength(12);
    expect(q.body).toContain('- and 8 smaller changes and fixes');
    expect(q.title).toBe('CivilKit CAD 1.0.0: Item 0; Item 1; Item 2');
  });

  it('merges sections for a catch-up, newest first', () => {
    const c = buildPost({ changelog, highlights, version: '0.7.0', from: '0.6.8' });
    expect(c.title.startsWith('CivilKit CAD, since 0.6.8: ')).toBe(true);
    expect(c.body).toContain('Also in these releases');
    for (const t of ['Fix one.', 'Fix two.', 'Fix three.']) expect(c.body).toContain(t);
    expect(c.body.indexOf('Fix one.')).toBeLessThan(c.body.indexOf('Fix three.'));
    expect(c.body).toContain('#v0-6-9');
    expect(pickReleases(changelog, '0.7.0', '0.6.9').map((r: { version: string }) => r.version)).toEqual(['0.7.0', '0.6.9']);
  });

  it('refuses unknown versions and a reversed range', () => {
    expect(() => buildPost({ changelog, highlights, version: '9.9.9' })).toThrow(/no "## 9.9.9"/);
    expect(() => buildPost({ changelog, highlights, version: '0.6.8', from: '0.7.0' })).toThrow(/newer/);
  });

  it('falls back to the first entries when there is no highlights file or none for the version', () => {
    for (const h of [null, undefined, {}, { '0.6.9': [] }]) {
      const q = buildPost({ changelog, highlights: h, version: '0.7.0' });
      expect(q.title).toBe('CivilKit CAD 0.7.0: Open STEP faster; A hole can target a body; Rounded rectangle tool');
      expect(q.body).not.toContain('## Highlights');
      expect(q.body).toContain('## Also in this release');
    }
  });

  it('never ends an entry in a cut-off code span', () => {
    const t = 'Takes a `flange: { diameter, thickness }` option, and goes on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on.';
    const s = sentence(t) as string;
    expect((s.match(/`/g) ?? []).length % 2).toBe(0);
    expect(s.endsWith('.')).toBe(true);
    expect(sameTopic('A Spring wizard adds compression springs', 'A Spring wizard for compression springs')).toBe(true);
    expect(sameTopic('A hole can aim at one body', 'A Spring wizard for compression springs')).toBe(false);
  });

  it('writes <out>/civilkit-<version>.md for the real changelog, with no internal detail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-post-'));
    execFileSync('node', [join(repo, 'tools', 'release_post.mjs'), '0.6.5', '--out', dir, '--catchup', '0.6.3'], { cwd: repo });
    const text = readFileSync(join(dir, 'civilkit-0.6.5.md'), 'utf8');
    expect(text.split('\n')[0]).toMatch(/^CivilKit CAD, since 0\.6\.3: /);
    expect(text).toContain('https://civilkit.io/docs/cad/');
    expect(text).not.toMatch(/—|!/);
    expect((scanText(text) as Array<{ id: string }>).map((h) => h.id)).toEqual([]);
  });
});
