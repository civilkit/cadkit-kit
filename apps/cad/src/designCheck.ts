// Pure helpers for the Design check panel: no DOM, no kernel. The kernel's rule catalogue drives the settings form,
// its issue list drives the result view (grouping, colours, selection targets) and the status-bar chip.
import type { Session } from '@ck/session';
import { t } from './i18n';

export type ProfileList = Awaited<ReturnType<Session['profiles']>>;
export type ProfileInfo = ProfileList['profiles'][number];
export type RuleInfo = ProfileInfo['rules'][number];
export type ParamInfo = RuleInfo['params'][number];
export type ProfileReport = Awaited<ReturnType<Session['checkProfile']>>;
export type Issue = ProfileReport['issues'][number];
export type Severity = Issue['severity'];

export type ParamValue = number | number[];
export const SEVERITIES: Severity[] = ['error', 'warn', 'info'];

/** Overlay colours on the part (also the swatches in the panel). */
export const SEVERITY_COLOUR: Record<Severity, number> = { error: 0xd1242f, warn: 0xe5a00d, info: 0x2f7fd6 };
export const severityCss = (s: Severity): string => '#' + SEVERITY_COLOUR[s].toString(16).padStart(6, '0');

export interface IssueGroup { severity: Severity; issues: Issue[] }

/** Issues grouped by severity, worst first; empty groups are left out. The order inside a group is the kernel's. */
export function groupIssues(issues: Issue[]): IssueGroup[] {
  return SEVERITIES.map((severity) => ({ severity, issues: issues.filter((i) => i.severity === severity) })).filter((g) => g.issues.length > 0);
}

/** face name -> worst severity of any issue naming it (for the viewport overlay). */
export function issueFaceMap(issues: Issue[]): Record<string, Severity> {
  const rank = (s: Severity) => SEVERITIES.indexOf(s);
  const out: Record<string, Severity> = {};
  for (const i of issues) for (const f of i.faces ?? []) if (!(f in out) || rank(i.severity) < rank(out[f])) out[f] = i.severity;
  return out;
}

/** What clicking an issue selects: its edges (edge mode) when it names any, otherwise its faces (face mode). */
export function issueTarget(issue: Issue): { names: string[]; mode: 'face' | 'edge' } {
  const edges = issue.edges ?? [];
  if (edges.length) return { names: [...edges], mode: 'edge' };
  return { names: [...(issue.faces ?? [])], mode: 'face' };
}

/** Everything an issue points at, for hover and framing. */
export const issueNames = (issue: Issue): string[] => [...(issue.faces ?? []), ...(issue.edges ?? [])];

/** "value vs limit" with the unit, or '' when the kernel gave no numbers. */
export function valueText(i: Pick<Issue, 'value' | 'limit' | 'unit'>): string {
  const n = (x: number) => String(Math.round(x * 100) / 100);
  if (i.value == null) return '';
  const u = i.unit ? ' ' + i.unit : '';
  return i.limit == null ? `${n(i.value)}${u}` : `${n(i.value)}${u} / ${n(i.limit)}${u}`;
}

/** Chip text for the status bar, from a report: '3D printing: 2 errors, 5 warnings' or '3D printing: no issues'. */
export interface ChipParts { name: string; errors: number; warnings: number; infos: number }
export const chipParts = (name: string, r: Pick<ProfileReport, 'summary'>): ChipParts => ({ name, errors: r.summary.errors, warnings: r.summary.warnings, infos: r.summary.infos });
export const chipTone = (c: ChipParts): 'ok' | 'warn' | 'err' => (c.errors ? 'err' : c.warnings ? 'warn' : 'ok');

// ---- blocking: only NEW violations of Block rules reject an edit ----

/** Identity of an issue across edits: persistent names do not change when an unrelated feature is edited. */
export const issueKey = (i: Pick<Issue, 'rule' | 'faces' | 'edges'>): string => `${i.rule}:${[...(i.faces ?? [])].sort().join(',')}:${[...(i.edges ?? [])].sort().join(',')}`;

/** The issues of Block rules that the edit introduced. A rule counts only when it has MORE issues after than before,
 *  and then the ones whose faces/edges were not flagged before are the new ones. Violations that were already there never block. */
export function blockedIssues(before: Issue[], after: Issue[], blockingRules: string[]): Issue[] {
  const out: Issue[] = [];
  for (const rule of blockingRules) {
    const b = before.filter((i) => i.rule === rule), a = after.filter((i) => i.rule === rule);
    if (a.length <= b.length) continue;
    const seen = new Set(b.map(issueKey));
    const fresh = a.filter((i) => !seen.has(issueKey(i)));
    out.push(...(fresh.length ? fresh : a.slice(b.length)));
  }
  return out;
}

const UNIT_WORDS: Record<string, string> = { deg: 'degrees' };
/** 'Overhang: 62 degrees on F5.S.e2, limit 45' (several issues: the first three, then a count). */
export function blockMessage(issues: Issue[], titles: Record<string, string>): string {
  const n = (x: number) => String(Math.round(x * 100) / 100);
  const one = (i: Issue) => {
    const u = i.unit ? ' ' + (UNIT_WORDS[i.unit] ?? i.unit) : '';
    const on = [...(i.faces ?? []), ...(i.edges ?? [])].slice(0, 4).join(', ');
    const val = i.value == null ? i.message : `${n(i.value)}${u}${on ? ' on ' + on : ''}`;
    return `${titles[i.rule] ?? i.rule}: ${val}${i.limit == null ? '' : `, limit ${n(i.limit)}`}`;
  };
  const shown = issues.slice(0, 3).map(one).join('; ');
  return t('check.blocked', { what: shown + (issues.length > 3 ? ` (+${issues.length - 3})` : '') });
}
