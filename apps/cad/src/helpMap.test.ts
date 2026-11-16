import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { FEATURE_TYPES } from '@ck/part-model';
import { sketchTools } from '@kit/sketch';
import './sheet/register';
import { t } from './i18n';
import { currentTopic, docsBase, guideUrl, helpCard, HELP, PUBLIC_DOCS } from './helpMap';

const GUIDE = `${process.cwd()}/guide/src/`;

/** mdBook's heading id: letters and digits lower-cased, `_` and `-` kept, white space to `-`, the rest dropped; a repeat gets `-1`, `-2`. */
export function headingIds(md: string): Set<string> {
  const ids = new Set<string>(), seen = new Map<string, number>();
  let fence = false;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^#{1,6}\s+(.*?)\s*(?:\{#([^}\s]+)\})?\s*$/.exec(line);
    if (!m) continue;
    const text = m[1].replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`]/g, '');
    const base = m[2] ?? [...text].map((c) => (/[\p{L}\p{N}_-]/u.test(c) ? c.toLowerCase() : /\s/.test(c) ? '-' : '')).join('');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    ids.add(n ? `${base}-${n}` : base);
  }
  for (const a of md.matchAll(/<a\s+id="([^"]+)"/g)) ids.add(a[1]);
  return ids;
}

const sourceOf = (page: string): string => (page === 'index.html' ? 'introduction.md' : page.replace(/\.html$/, '.md'));

describe('headingIds', () => {
  it('follows mdBook: punctuation dropped, spaces to dashes, repeats numbered, explicit anchors kept', () => {
    const ids = headingIds('# Fillet, chamfer & shell\n## Rib and lip\n## Rib and lip\n```\n# not a heading\n```\n| <a id="tool-line"></a>**Line** |');
    expect([...ids]).toEqual(['fillet-chamfer--shell', 'rib-and-lip', 'rib-and-lip-1', 'tool-line']);
  });
});

describe('helpMap against the guide sources', () => {
  it('every entry points at a guide page that exists, with an anchor that exists on it', () => {
    const dead: string[] = [];
    for (const [topic, e] of Object.entries(HELP)) {
      const file = GUIDE + sourceOf(e.page);
      if (!existsSync(file)) { dead.push(`${topic}: no page ${e.page}`); continue; }
      if (e.anchor && !headingIds(readFileSync(file, 'utf8')).has(e.anchor)) dead.push(`${topic}: no anchor #${e.anchor} on ${e.page}`);
    }
    expect(dead).toEqual([]);
  });
  it('every page the map names is in the guide contents', () => {
    const summary = readFileSync(GUIDE + 'SUMMARY.md', 'utf8');
    const missing = [...new Set(Object.values(HELP).map((e) => e.page))].filter((p) => p !== 'index.html' && !summary.includes('(' + sourceOf(p) + ')'));
    expect(missing).toEqual([]);
  });
});

/** Tools and feature types that deliberately have no help topic (none today: add an id here with a reason, never leave one out silently). */
const NO_SKETCH_HELP: string[] = [];
const NO_FEATURE_HELP: string[] = [];

describe('helpMap covers the app', () => {
  it('every registered sketch tool, the select tool and the 3D sketch have a topic', () => {
    const missing = ['select', ...sketchTools().map((x) => x.id)].filter((id) => !NO_SKETCH_HELP.includes(id) && !HELP['sketch:' + id]);
    expect(missing).toEqual([]);
    expect(HELP.sketch).toBeTruthy();
    expect(HELP.sketch3d).toBeTruthy();
  });
  it('every feature type has a topic', () => {
    const missing = (FEATURE_TYPES as readonly string[]).filter((id) => !NO_FEATURE_HELP.includes(id) && !HELP['feature:' + id]);
    expect(missing).toEqual([]);
  });
  it('the wizards of the app have a topic', () => {
    for (const w of ['gear', 'propeller', 'marine', 'impeller', 'bearing', 'screw', 'washer', 'nut', 'standoff', 'insert', 'spring', 'case', 'fasten', 'knurl', 'cornerHoles', 'mesh', 'material']) expect(HELP['wizard:' + w], w).toBeTruthy();
  });
  it('no entry is for a sketch tool the app does not have', () => {
    const tools = new Set(['select', ...sketchTools().map((x) => x.id)]);
    expect(Object.keys(HELP).filter((k) => k.startsWith('sketch:') && !tools.has(k.slice(7)))).toEqual([]);
  });
});

describe('help text', () => {
  it('every entry has a name and a one-sentence summary in the catalogue', () => {
    for (const topic of Object.keys(HELP)) {
      const c = helpCard(topic);
      expect(c.name, topic).not.toMatch(/^help\./);
      expect(c.summary, topic).not.toMatch(/^help\./);
      expect(c.summary.length, topic).toBeGreaterThan(20);
      expect(c.summary.length, topic).toBeLessThan(200);
      expect(c.summary, topic).toMatch(/\.$/);
      expect(c.summary.match(/[.!?](\s|$)/g)?.length, topic + ': one sentence').toBe(1);
    }
  });
  it('an inline summary on an entry wins over the catalogue', () => {
    HELP['guide'].summary = 'Inline.';
    try { expect(helpCard('guide').summary).toBe('Inline.'); } finally { delete HELP['guide'].summary; }
    expect(t('help.guide')).toBe('Open the guide');
  });
});

describe('guide addresses', () => {
  it('are absolute and carry the anchor', () => {
    expect(guideUrl('sketch:line', 'https://example.com/docs/cad/')).toBe('https://example.com/docs/cad/sketching/tools.html#tool-line');
    expect(guideUrl('guide', 'https://example.com/docs/cad/')).toBe('https://example.com/docs/cad/index.html');
    expect(guideUrl('nope')).toBeNull();
  });
  it('stay on the site for a web origin and use the public guide for a local server or the desktop app', () => {
    expect(docsBase({ protocol: 'https:', hostname: 'cad.example.com', origin: 'https://cad.example.com' })).toBe('https://cad.example.com/docs/cad/');
    expect(docsBase({ protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:4173' })).toBe(PUBLIC_DOCS);
    expect(docsBase({ protocol: 'tauri:', hostname: 'localhost', origin: 'tauri://localhost' })).toBe(PUBLIC_DOCS);
    expect(docsBase({ protocol: 'http:', hostname: 'tauri.localhost', origin: 'http://tauri.localhost' })).toBe(PUBLIC_DOCS);
  });
  it('an unknown topic opens the guide front page', () => {
    expect(helpCard('feature:nonsense').topic).toBe('guide');
  });
});

describe('currentTopic', () => {
  it('prefers the 3D sketch, then a wizard, then the open feature, then the sketch tool', () => {
    expect(currentTopic({ sketch3d: true, wizard: 'gear' })).toBe('sketch3d');
    expect(currentTopic({ wizard: 'spring', feature: 'extrude' })).toBe('wizard:spring');
    expect(currentTopic({ feature: 'extrude', sketching: true })).toBe('feature:extrude');
    expect(currentTopic({ sketching: true, tool: 'trim' })).toBe('sketch:trim');
    expect(currentTopic({ sketching: true, tool: null })).toBe('sketch');
    expect(currentTopic({ sketching: true, tool: 'not-a-tool' })).toBe('sketch');
    expect(currentTopic({})).toBe('guide');
    expect(currentTopic({ feature: 'unknownType' })).toBe('guide');
  });
});
