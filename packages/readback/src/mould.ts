// The injection-moulding undercut rule. The kernel's `undercut` rule (CNC profile) asks "can a tool coming along ONE direction reach this
// face". A two-part mould is different: the cavity half pulls along +pull and the core half along -pull, so a face is an undercut only when
// NEITHER half can form it (hidden from both directions), e.g. the wall of a cross hole or a slot open to the side. The kernel has no such
// rule, so the kit builds it from two runs of `undercut` (pull and -pull) inside ONE checkProfile call and keeps the faces named by both.
//
// `mouldUndercut` is a kit rule: `withMouldRule` adds it to the injection profile's catalogue (so the Check tab shows it like any rule),
// `expandMould` turns an inline profile that has it into one the kernel accepts, `mergeMould` folds the kernel's answer back.
import type { Session } from '@ck/session';

export type ProfileList = Awaited<ReturnType<Session['profiles']>>;
export type ProfileInfo = ProfileList['profiles'][number];
export type RuleInfo = ProfileInfo['rules'][number];
export type ProfileReport = Awaited<ReturnType<Session['checkProfile']>>;
export type Severity = 'error' | 'warn' | 'info';

export const MOULD_RULE = 'mouldUndercut';
/** The built-in profile the rule belongs to. */
export const MOULD_PROFILE = 'injection';

/** The words of the rule; the app passes translated ones. */
export interface MouldLabels {
  title: string;
  description: string;
  pullDescription: string;
  /** `face` is the persistent face name, `area` the unformable area in mm2 (rounded), `pull` e.g. 'Z' or '(0.7, 0, 0.7)'. */
  message(face: string, area: number, pull: string): string;
}
export const MOULD_LABELS: MouldLabels = {
  title: 'Undercut (two-part mould)',
  description: 'Faces that neither mould half can form: hidden under other material when looking along the pull direction and against it (the wall of a cross hole, a slot open to the side). A face that only one half can see is fine: that half forms it.',
  pullDescription: 'Pull axis: the mould halves open along it and against it',
  message: (face, area, pull) => `${face} is an undercut for a mould pulled along ${pull}: neither half can form it (${area} mm2 hidden both ways). Add a side action, open the feature along the pull direction, or reshape it.`,
};

/** The rule as the Check tab lists it, built from the kernel's `undercut` entry (same parameters, pull-axis wording). Null when the kernel has none. */
export function mouldRuleInfo(catalogue: ReadonlyArray<RuleInfo>, labels: MouldLabels = MOULD_LABELS): RuleInfo | null {
  const u = catalogue.find((r) => r.id === 'undercut');
  if (!u) return null;
  return {
    ...u,
    id: MOULD_RULE, title: labels.title, description: labels.description, severity: 'warn',
    params: u.params.map((p) => (p.name === 'direction' ? { ...p, description: labels.pullDescription } : p)),
  };
}

/** The profile list with the mould rule added to the injection profile (a list that already has it, or has no `undercut` entry, is returned as it is). */
export function withMouldRule(list: ProfileList, labels: MouldLabels = MOULD_LABELS): ProfileList {
  const rule = mouldRuleInfo(list.rules, labels);
  if (!rule) return list;
  return { ...list, profiles: list.profiles.map((p) => (p.id === MOULD_PROFILE && !p.rules.some((r) => r.id === MOULD_RULE || r.id === 'undercut') ? { ...p, rules: [...p.rules, rule] } : p)) };
}

export interface InlineRule { id: string; severity?: Severity; params?: Record<string, number | number[]> }
export interface InlineProfile { id?: string; name?: string; rules: InlineRule[] }
export interface MouldSpec { severity: Severity; direction: number[]; minArea: number }

const unit = (d: number[]): number[] => { const n = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / n, d[1] / n, d[2] / n]; };
const num = (x: number) => Math.round(x * 100) / 100;

/** 'Z' for an axis-aligned pull, else the unit vector. */
export function pullLabel(d: number[]): string {
  const u = unit(d);
  const ax = ['X', 'Y', 'Z'];
  for (let i = 0; i < 3; i++) if (Math.abs(Math.abs(u[i]) - 1) < 1e-6) return ax[i];
  return `(${u.map(num).join(', ')})`;
}

/** An inline profile without the kit rule (the two `undercut` runs in its place, tagged by severity: info = along the pull, warn = against it), and the rule's settings; `mould` is null when the profile has none. */
export function expandMould(profile: InlineProfile): { profile: InlineProfile; mould: MouldSpec | null } {
  const i = profile.rules.findIndex((r) => r.id === MOULD_RULE);
  if (i < 0) return { profile, mould: null };
  const r = profile.rules[i];
  const dir = Array.isArray(r.params?.direction) ? unit(r.params!.direction as number[]) : [0, 0, 1];
  const minArea = typeof r.params?.minArea === 'number' ? r.params.minArea : 0.5;
  const rules = profile.rules.filter((_, k) => k !== i);
  rules.splice(i, 0,
    { id: 'undercut', severity: 'info', params: { direction: dir, minArea } },
    { id: 'undercut', severity: 'warn', params: { direction: dir.map((x) => -x), minArea } });
  return { profile: { ...profile, rules }, mould: { severity: r.severity ?? 'warn', direction: dir, minArea } };
}

/** The kernel's report for an expanded profile, as if the mould rule were one rule: issues for the faces both runs flagged. */
export function mergeMould(report: ProfileReport, mould: MouldSpec | null, labels: MouldLabels = MOULD_LABELS): ProfileReport {
  if (!mould) return report;
  const along = report.issues.filter((x) => x.rule === 'undercut' && x.severity === 'info');
  const against = new Map(report.issues.filter((x) => x.rule === 'undercut' && x.severity === 'warn').flatMap((x) => x.faces.map((f) => [f, x] as const)));
  const pull = pullLabel(mould.direction);
  const merged: ProfileReport['issues'] = [];
  for (const a of along) {
    const face = a.faces[0];
    const b = face === undefined ? undefined : against.get(face);
    if (!b) continue;
    const area = Math.min(a.value ?? Infinity, b.value ?? Infinity);
    merged.push({ rule: MOULD_RULE, severity: mould.severity, message: labels.message(face, num(Number.isFinite(area) ? area : 0), pull), faces: [face], edges: [], value: Number.isFinite(area) ? area : null, limit: mould.minArea, unit: 'mm2', ...(a.at ? { at: a.at } : {}) });
  }
  merged.sort((x, y) => (y.value ?? 0) - (x.value ?? 0));
  const issues = [...report.issues.filter((x) => x.rule !== 'undercut'), ...merged];
  const count = (s: Severity) => issues.filter((x) => x.severity === s).length;
  // the two kernel entries of the expansion become the one the profile asked for (at the place of the first)
  let placed = false;
  const rules = report.summary.rules.flatMap((r) => {
    if (r.rule !== 'undercut') return [r];
    if (placed) return [];
    placed = true;
    return [{ rule: MOULD_RULE, severity: mould.severity, issues: merged.length, passed: merged.length === 0 }];
  });
  const effective = (report.profile.rules ?? []) as Array<Record<string, unknown>>;
  let put = false;
  const profileRules = effective.flatMap((r) => {
    if (r.id !== 'undercut') return [r];
    if (put) return [];
    put = true;
    return [{ ...r, id: MOULD_RULE, title: labels.title, description: labels.description, severity: mould.severity }];
  });
  return {
    ...report,
    profile: { ...report.profile, rules: profileRules },
    ok: count('error') === 0,
    issues,
    summary: { ...report.summary, errors: count('error'), warnings: count('warn'), infos: count('info'), total: issues.length, rules, truncated: report.summary.truncated.filter((x) => x.rule !== 'undercut') },
  };
}

/** Run an inline profile through `check` (a session's checkProfile): the kit rule is expanded for the kernel and folded back. */
export async function checkWithMould(check: (p: Record<string, unknown>) => Promise<ProfileReport>, profile: InlineProfile, labels: MouldLabels = MOULD_LABELS): Promise<ProfileReport> {
  const { profile: kernelProfile, mould } = expandMould(profile);
  return mergeMould(await check(kernelProfile as unknown as Record<string, unknown>), mould, labels);
}
