import { describe, expect, it } from 'vitest';
import { type InlineProfile, expandMould, mergeMould, mouldRuleInfo, MOULD_RULE, pullLabel, withMouldRule, type ProfileList, type ProfileReport, type RuleInfo } from './index';

const rule = (id: string, params: RuleInfo['params'] = []): RuleInfo => ({ id, title: id, description: '', severity: 'warn', params });
const undercut = rule('undercut', [
  { name: 'direction', type: 'vec3', default: [0, 0, 1], value: [0, 0, 1], unit: '', description: 'tool' },
  { name: 'minArea', type: 'number', default: 0.5, value: 0.5, unit: 'mm2', description: 'area' },
]);
const list = (): ProfileList => ({
  rules: [rule('openShell'), rule('draft'), undercut],
  profiles: [
    { id: 'injection', name: 'Injection', description: '', rules: [rule('openShell'), rule('draft')] },
    { id: 'cnc-3axis', name: 'CNC', description: '', rules: [rule('openShell'), undercut] },
  ],
} as ProfileList);

describe('the mould undercut rule in the catalogue', () => {
  it('is added to the injection profile only, with the undercut parameters and the pull-axis wording', () => {
    const l = withMouldRule(list());
    const inj = l.profiles.find((p) => p.id === 'injection')!;
    expect(inj.rules.map((r) => r.id)).toEqual(['openShell', 'draft', MOULD_RULE]);
    const m = inj.rules[2];
    expect(m.params.map((p) => p.name)).toEqual(['direction', 'minArea']);
    expect(m.params[0].description).toMatch(/Pull axis/);
    expect(l.profiles.find((p) => p.id === 'cnc-3axis')!.rules.map((r) => r.id)).toEqual(['openShell', 'undercut']);
    expect(withMouldRule(l).profiles[0].rules).toHaveLength(3);   // idempotent
  });
  it('is left out when the kernel has no undercut rule', () => {
    const l = list();
    l.rules = l.rules.filter((r) => r.id !== 'undercut');
    expect(mouldRuleInfo(l.rules)).toBeNull();
    expect(withMouldRule(l)).toBe(l);
  });
});

describe('expanding and merging', () => {
  const inline: InlineProfile = { id: 'injection', name: 'Injection', rules: [
    { id: 'draft', severity: 'warn', params: { minAngle: 1 } },
    { id: MOULD_RULE, severity: 'error', params: { direction: [0, 0, 2], minArea: 1 } },
  ] };
  it('runs undercut along the pull and against it, tagged by severity, in the place of the kit rule', () => {
    const { profile, mould } = expandMould(inline);
    expect(profile.rules.map((r) => [r.id, r.severity])).toEqual([['draft', 'warn'], ['undercut', 'info'], ['undercut', 'warn']]);
    expect(profile.rules[1].params).toEqual({ direction: [0, 0, 1], minArea: 1 });
    expect(profile.rules[2].params).toEqual({ direction: [-0, -0, -1], minArea: 1 });
    expect(mould).toEqual({ severity: 'error', direction: [0, 0, 1], minArea: 1 });
  });
  it('a profile without the rule is untouched', () => {
    const p = { rules: [{ id: 'draft' }] };
    expect(expandMould(p)).toEqual({ profile: p, mould: null });
  });
  it('keeps the faces both runs flagged, with the smaller area, and recounts the summary', () => {
    const issue = (rule: string, severity: 'info' | 'warn' | 'error', face: string, value: number) => ({ rule, severity, message: 'm', faces: [face], edges: [], value, limit: 1, unit: 'mm2' });
    const report = {
      profile: { id: 'injection', name: 'Injection', rules: [{ id: 'draft' }, { id: 'undercut' }, { id: 'undercut' }] },
      ok: true,
      issues: [issue('draft', 'warn', 'F2.S.e1', 1), issue('undercut', 'info', 'F4.S.e1', 30), issue('undercut', 'info', 'F2.C0', 400), issue('undercut', 'warn', 'F4.S.e1', 12)],
      summary: { errors: 0, warnings: 2, infos: 2, total: 4, rules: [{ rule: 'draft', severity: 'warn', issues: 1, passed: false }, { rule: 'undercut', severity: 'info', issues: 2, passed: false }, { rule: 'undercut', severity: 'warn', issues: 1, passed: false }], truncated: [], skippedFaces: [], samples: 3000 },
    } as unknown as ProfileReport;
    const out = mergeMould(report, { severity: 'error', direction: [0, 0, 1], minArea: 1 });
    const mould = out.issues.filter((i) => i.rule === MOULD_RULE);
    expect(mould).toHaveLength(1);
    expect(mould[0]).toMatchObject({ faces: ['F4.S.e1'], value: 12, severity: 'error', unit: 'mm2' });
    expect(mould[0].message).toContain('F4.S.e1');
    expect(mould[0].message).toContain('pulled along Z');
    expect(out.issues.some((i) => i.rule === 'undercut')).toBe(false);
    expect(out.ok).toBe(false);
    expect(out.summary).toMatchObject({ errors: 1, warnings: 1, infos: 0, total: 2 });
    expect(out.summary.rules.map((r) => r.rule)).toEqual(['draft', MOULD_RULE]);
    expect(out.summary.rules[1]).toMatchObject({ issues: 1, passed: false, severity: 'error' });
    expect((out.profile.rules as Array<{ id: string }>).map((r) => r.id)).toEqual(['draft', MOULD_RULE]);
  });
  it('labels an oblique pull as a unit vector', () => {
    expect(pullLabel([0, 0, 5])).toBe('Z');
    expect(pullLabel([1, 0, 1])).toBe('(0.71, 0, 0.71)');
  });
});
