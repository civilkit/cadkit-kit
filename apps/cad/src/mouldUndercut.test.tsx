import './i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { CheckPanel, type DesignCheckProps } from './CheckPanel';
import { buildPolicy, defaultSettings, mergeSettings, settingsToInline } from './checkSettings';
import { blockedIssues, blockMessage, mouldLabels, runProfile, withMould, type Issue, type ProfileInfo, type ProfileList, type ProfileReport } from './designCheck';

afterEach(cleanup);

const num = (name: string, value: number, unit = '') => ({ name, type: 'number' as const, default: value, value, unit, description: '' });
const vec = (name: string, value: number[]) => ({ name, type: 'vec3' as const, default: value, value, unit: '', description: '' });
const rule = (id: string, title: string, params: ProfileInfo['rules'][number]['params'] = [], severity = 'warn') => ({ id, title, description: '', severity, params });
const undercut = rule('undercut', 'Undercut / tool access', [vec('direction', [0, 0, 1]), num('minArea', 0.5, 'mm2')], 'error');
const kernelList = (): ProfileList => ({
  rules: [undercut],
  profiles: [
    { id: 'injection', name: 'Injection moulding', description: '', rules: [rule('draft', 'Draft angle', [num('minAngle', 1, 'deg'), vec('direction', [0, 0, 1])]), rule('minWall', 'Minimum wall', [num('min', 0.8, 'mm')], 'info')] },
    { id: 'cnc-3axis', name: 'CNC milling', description: '', rules: [undercut] },
  ],
} as ProfileList);
const injection = (): ProfileInfo => withMould(kernelList()).profiles.find((p) => p.id === 'injection')!;

describe('the injection profile in the Check tab', () => {
  it('gains the undercut rule, after the kernel rules, as a warning with the pull axis and the area limit; CNC keeps its own', () => {
    const l = withMould(kernelList());
    const inj = l.profiles.find((p) => p.id === 'injection')!;
    expect(inj.rules.map((r) => r.id)).toEqual(['draft', 'minWall', 'mouldUndercut']);
    const m = inj.rules[2];
    expect(m.title).toBe('Undercut (two-part mould)');
    expect(m.severity).toBe('warn');
    expect(m.params.map((p) => [p.name, p.value])).toEqual([['direction', [0, 0, 1]], ['minArea', 0.5]]);
    expect(m.params[0].description).toMatch(/Pull axis/);
    expect(l.profiles.find((p) => p.id === 'cnc-3axis')!.rules.map((r) => r.id)).toEqual(['undercut']);
  });

  it('its default setting is Warn with pull +Z; saved settings of the profile from before still load and get the new rule', () => {
    const p = injection();
    expect(defaultSettings(p).mouldUndercut).toEqual({ mode: 'warn', params: { direction: [0, 0, 1], minArea: 0.5 } });
    const old = { v: 1, rules: { draft: { mode: 'block', params: { minAngle: 2 } } } };
    const s = mergeSettings(p, old);
    expect(s.draft.mode).toBe('block');
    expect(s.mouldUndercut.mode).toBe('warn');
    expect(Object.keys(s)).toEqual(['draft', 'minWall', 'mouldUndercut']);
  });

  it('Off leaves the rule out of the inline profile; a changed pull axis is sent as it is', () => {
    const p = injection();
    const s = defaultSettings(p);
    s.mouldUndercut = { mode: 'off', params: { direction: [0, 0, 1], minArea: 0.5 } };
    expect(settingsToInline(p, s).rules.map((r) => r.id)).toEqual(['draft', 'minWall']);
    s.mouldUndercut = { mode: 'block', params: { direction: [1, 0, 0], minArea: 2 } };
    expect(settingsToInline(p, s).rules[2]).toEqual({ id: 'mouldUndercut', severity: 'error', params: { direction: [1, 0, 0], minArea: 2 } });
  });
});

describe('running it', () => {
  const issue = (rule: string, severity: Issue['severity'], face: string, value: number): Issue => ({ rule, severity, message: 'kernel says', faces: [face], edges: [], value, limit: 0.5, unit: 'mm2' });
  /** a fake kernel: faces F4.S.e1 and F4.S.e2 are unreachable along +Z, F4.S.e2 and F2.C0 against it */
  function fake() {
    const sent: Array<Record<string, unknown>> = [];
    const checkProfile = vi.fn(async (p: Record<string, unknown>) => {
      sent.push(p);
      const rules = p.rules as Array<{ id: string; severity: string; params: { direction?: number[] } }>;
      const issues: Issue[] = [];
      for (const r of rules) {
        if (r.id === 'draft') issues.push(issue('draft', 'warn', 'F2.S.e1', 1));
        if (r.id === 'undercut') (r.params.direction![2] > 0 ? ['F4.S.e1', 'F4.S.e2'] : ['F4.S.e2', 'F2.C0']).forEach((f, i) => issues.push({ ...issue('undercut', r.severity as Issue['severity'], f, 10 + i + (r.params.direction![2] > 0 ? 0 : 5)), message: 'tool cannot reach' }));
      }
      const count = (s: string) => issues.filter((i) => i.severity === s).length;
      return { profile: { id: 'injection', name: 'Injection moulding', rules: rules.map((r) => ({ id: r.id })) }, ok: count('error') === 0, issues, summary: { errors: count('error'), warnings: count('warn'), infos: count('info'), total: issues.length, rules: rules.map((r) => ({ rule: r.id, severity: r.severity, issues: issues.filter((i) => i.rule === r.id && i.severity === r.severity).length, passed: false })), truncated: [], skippedFaces: [], samples: 3000 } } as unknown as ProfileReport;
    });
    return { sent, session: { checkProfile } };
  }

  it('asks the kernel for the undercut along the pull and against it, and reports only the face both cannot reach, as one rule', async () => {
    const { sent, session } = fake();
    const p = injection();
    const report = await runProfile(session as never, settingsToInline(p, defaultSettings(p)));
    const undercuts = (sent[0].rules as Array<{ id: string; params: { direction: number[] } }>).filter((r) => r.id === 'undercut');
    expect(undercuts.map((r) => r.params.direction)).toEqual([[0, 0, 1], [-0, -0, -1]]);
    expect((sent[0].rules as Array<{ id: string }>).some((r) => r.id === 'mouldUndercut')).toBe(false);   // the kernel never sees the kit rule
    const mould = report.issues.filter((i) => i.rule === 'mouldUndercut');
    expect(mould).toHaveLength(1);
    expect(mould[0].faces).toEqual(['F4.S.e2']);
    expect(mould[0].severity).toBe('warn');
    expect(mould[0].message).toBe('F4.S.e2 is an undercut for a mould pulled along Z: neither half can form it (11 mm2 hidden both ways). Add a side action, open the feature along the pull direction, or reshape it.');
    expect(report.issues.map((i) => i.rule)).toEqual(['draft', 'mouldUndercut']);
    expect(report.summary).toMatchObject({ warnings: 2, errors: 0, total: 2 });
  });

  it('with the rule off the kernel is asked nothing about undercuts; a built-in profile id goes through untouched', async () => {
    const { sent, session } = fake();
    const p = injection();
    const s = defaultSettings(p);
    s.mouldUndercut.mode = 'off';
    await runProfile(session as never, settingsToInline(p, s));
    expect((sent[0].rules as Array<{ id: string }>).map((r) => r.id)).toEqual(['draft', 'minWall']);
    const plain = { checkProfile: vi.fn(async () => ({ issues: [] }) as never) };
    await runProfile(plain, 'cnc-3axis');
    expect(plain.checkProfile).toHaveBeenCalledWith('cnc-3axis', undefined);
  });

  it('Block mode makes it an error that blocks a new undercut, with the rule title in the message', async () => {
    const { session } = fake();
    const p = injection();
    const s = defaultSettings(p);
    s.mouldUndercut.mode = 'block';
    const policy = buildPolicy(p, s, false);
    expect(policy.blocking).toEqual(['mouldUndercut']);
    const after = await runProfile(session as never, policy.profile);
    expect(after.ok).toBe(false);
    const fresh = blockedIssues([], after.issues, policy.blocking);
    expect(fresh).toHaveLength(1);
    expect(blockMessage(fresh, policy.titles)).toMatch(/Undercut \(two-part mould\): 11 mm2 on F4\.S\.e2, limit 0\.5/);
  });

  it('the labels are translated text, not literals of the rule', () => {
    expect(mouldLabels().title).toBe('Undercut (two-part mould)');
    expect(mouldLabels().message('F1', 3, 'X')).toContain('F1 is an undercut for a mould pulled along X');
  });
});

describe('the panel', () => {
  const p = injection();
  const props = (o: Partial<DesignCheckProps> = {}): DesignCheckProps => ({
    profiles: [p], profileId: 'injection', onProfile: vi.fn(), settings: defaultSettings(p), onSettings: vi.fn(), onReset: vi.fn(), afterEdit: false, onAfterEdit: vi.fn(),
    showOnPart: false, onShowOnPart: vi.fn(), report: null, stale: false, running: false, onRun: vi.fn(), onSelect: vi.fn(), onHover: vi.fn(), ...o,
  });

  it('lists the rule with its mode and the pull axis field next to the other injection rules', () => {
    const { container } = render(<CheckPanel {...props()} />);
    const rules = [...container.querySelectorAll('.dcheck-rule')];
    expect(rules.map((r) => r.querySelector('b')!.textContent)).toEqual(['Draft angle', 'Minimum wall', 'Undercut (two-part mould)']);
    const mould = rules[2];
    expect((mould.querySelector('select') as HTMLSelectElement).value).toBe('warn');
    expect(mould.querySelectorAll('input').length).toBeGreaterThanOrEqual(4);   // pull x y z and the area limit
  });

  it('editing the pull axis reports new settings with the changed axis', () => {
    const onSettings = vi.fn();
    const { container } = render(<CheckPanel {...props({ onSettings })} />);
    const mould = container.querySelectorAll('.dcheck-rule')[2];
    const first = mould.querySelectorAll('input')[0] as HTMLInputElement;
    fireEvent.input(first, { target: { value: '1' } });
    fireEvent.change(first, { target: { value: '1' } });
    fireEvent.blur(first);
    const last = onSettings.mock.calls.at(-1)?.[0];
    expect(last?.mouldUndercut.params.direction[0]).toBe(1);
  });

  it('shows the undercut issue under its title with the faces', () => {
    const issue: Issue = { rule: 'mouldUndercut', severity: 'warn', message: mouldLabels().message('F4.S.e2', 11, 'Z'), faces: ['F4.S.e2'], edges: [], value: 11, limit: 0.5, unit: 'mm2' };
    const report = { profile: { id: 'injection', name: 'Injection moulding', rules: [] }, ok: true, issues: [issue], summary: { errors: 0, warnings: 1, infos: 0, total: 1, rules: [], truncated: [], skippedFaces: [], samples: 3000 } } as unknown as ProfileReport;
    const onSelect = vi.fn();
    const { container } = render(<CheckPanel {...props({ report, onSelect })} />);
    const row = container.querySelector('.dcheck-issue')!;
    expect(row.textContent).toContain('Undercut (two-part mould)');
    expect(row.textContent).toContain('neither half can form it');
    expect(row.textContent).toContain('11 mm2 / 0.5 mm2');
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(issue);
  });
});
