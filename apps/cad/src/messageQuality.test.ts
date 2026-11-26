// Message quality gate (docs: msg-audit SPEC section 6). Every user-visible refusal, failure and warning text is checked against the
// rules in tools/msg/messageRules.mjs. Known violations are listed in tools/ci/msg-baseline.json; the list may only shrink:
// a new violation fails, and so does a baseline entry that no longer violates (delete it). Regenerate with UPDATE_MSG_BASELINE=1.
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { registerCatalog } from '@kit/i18n';
import { reasonOf, adviceOf, composeMessage } from '@kit/viewdata';
import { en } from './locales/en';
// @ts-expect-error plain ESM shared with the Node tools
import { check, checkPair } from '../../../tools/msg/messageRules.mjs';

registerCatalog('en', en);
const BASELINE = join(process.cwd(), 'tools/ci/msg-baseline.json');
const baseline: Record<string, string[]> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};

const violations: Record<string, string[]> = {};
const add = (id: string, rules: string[]) => { if (rules.length) violations[id] = [...new Set(rules)].sort(); };

// 1. every kernel code the kit words: its cause and its action, composed through the real composer
const codes = Object.keys(en).filter((k) => k.startsWith('diag.reason.')).map((k) => k.slice('diag.reason.'.length)).filter((c) => !/\.|^unknown$/.test(c));
for (const code of codes) {
  const root = { id: 'F3', label: 'fillet', code, params: {} } as never;
  const cause = reasonOf(root), action = adviceOf(root);
  add('code:' + code, checkPair(cause.charAt(0).toUpperCase() + cause.slice(1) + '.', action, { kind: 'refusal', key: 'diag.' + code }));
  const m = composeMessage({ roots: [root], consequences: [], blockedBy: {} } as never, 'failed');
  add('composed:' + code, check([m.cause, m.action].filter(Boolean).join(' '), { kind: 'refusal', key: 'diag.' + code }).filter((r: string) => r !== 'noaction' && r !== 'long'));
}
// 2. catalogue keys that are messages by name
const MSG_KEY = /\.(err|error|errors|warn|warning|failed|refuse|refused|blocked|problem|notice|invalid|unsupported)(\.|$)/;
for (const [k, v] of Object.entries(en)) {
  if (!MSG_KEY.test(k) || typeof v !== 'string' || k.startsWith('diag.')) continue;
  add('key:' + k, check(v, { kind: /warn/.test(k) ? 'warning' : 'refusal', key: k }));
}

describe('message quality', () => {
  it('has no new violation, and the baseline only shrinks', () => {
    if (process.env.UPDATE_MSG_BASELINE) { writeFileSync(BASELINE, JSON.stringify(violations, Object.keys(violations).sort(), 1) + '\n'); return; }
    const fresh = Object.keys(violations).filter((id) => !baseline[id] || violations[id].some((r) => !baseline[id].includes(r)));
    const stale = Object.keys(baseline).filter((id) => !violations[id] || baseline[id].some((r) => !violations[id].includes(r)));
    expect(fresh.map((id) => `${id}: ${violations[id].join(',')}`), 'new message problems (fix the text, do not add to the baseline)').toEqual([]);
    expect(stale, 'fixed: delete these from tools/ci/msg-baseline.json (UPDATE_MSG_BASELINE=1 npx vitest run apps/cad/src/messageQuality.test.ts)').toEqual([]);
  });
  it('the composer never says "broke", shows an id or a code, or repeats itself', () => {
    const root = { id: 'F3', label: 'fillet', code: 'blendOverflow', params: { detail: 'F3.B0: spring leaves its face away from its edges', hint: 'agent text F3.B0' } } as never;
    for (const state of ['preview', 'rejected', 'failed'] as const) {
      const m = composeMessage({ roots: [root], consequences: [], blockedBy: {} } as never, state);
      const text = [m.lead, m.cause, m.action].join(' ');
      expect(text).not.toMatch(/broke|F3\.B0|blendOverflow|spring/);
      expect(check(text, { kind: 'info' })).not.toContain('dup');
    }
  });
});
