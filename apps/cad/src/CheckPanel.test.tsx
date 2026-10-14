import './i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { CheckPanel, plural, type DesignCheckProps } from './CheckPanel';
import { defaultSettings } from './checkSettings';
import type { Issue, ProfileInfo, ProfileReport } from './designCheck';

afterEach(cleanup);

const profile: ProfileInfo = {
  id: 'fdm-print', name: 'FDM 3D printing', description: '',
  rules: [
    { id: 'minWall', title: 'Minimum wall thickness', description: '', severity: 'error', params: [{ name: 'min', type: 'number', default: 1.2, value: 1.2, unit: 'mm', min: 0, description: '' }] },
    { id: 'overhang', title: 'Overhang', description: '', severity: 'warn', params: [{ name: 'direction', type: 'vec3', default: [0, 1, 0], value: [0, 1, 0], unit: '', description: '' }] },
  ],
};
const issue = (o: Partial<Issue>): Issue => ({ rule: 'minWall', severity: 'error', message: 'Wall is thin', faces: ['F2.C1'], edges: [], value: 0.5, limit: 1.2, unit: 'mm', ...o }) as Issue;
const report = (issues: Issue[]): ProfileReport => ({ profile: { id: 'fdm-print', name: 'FDM 3D printing' }, ok: false, issues, summary: { errors: 1, warnings: 1, infos: 0, total: issues.length, rules: [], truncated: [], skippedFaces: [], samples: 3000 } }) as ProfileReport;

function setup(o: Partial<DesignCheckProps> = {}) {
  const p: DesignCheckProps = {
    profiles: [profile, { ...profile, id: 'cnc-3axis', name: 'CNC 3-axis' }], profileId: 'fdm-print', onProfile: vi.fn(),
    settings: defaultSettings(profile), onSettings: vi.fn(), onReset: vi.fn(), afterEdit: false, onAfterEdit: vi.fn(), showOnPart: false, onShowOnPart: vi.fn(),
    report: null, stale: false, running: false, onRun: vi.fn(), onSelect: vi.fn(), onHover: vi.fn(), ...o,
  };
  return { p, ...render(<CheckPanel {...p} />) };
}

describe('CheckPanel', () => {
  it('before a run it says so; the profile list comes from the kernel and Run calls back', () => {
    const { p, container, getByText } = setup();
    expect(container.textContent).toContain('No check run yet');
    expect([...container.querySelectorAll('option')].map((x) => x.textContent)).toContain('CNC 3-axis');
    fireEvent.click(getByText('Run check'));
    expect(p.onRun).toHaveBeenCalled();
  });

  it('lists issues grouped by severity with counts, rule, message and value vs limit', () => {
    const { container } = setup({ report: report([issue({}), issue({ rule: 'overhang', severity: 'warn', message: 'Steep', value: 62, limit: 45, unit: 'deg', faces: ['F5'] })]) });
    const groups = [...container.querySelectorAll('.dcheck-group')];
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Errors', 'Warnings']);
    expect(groups[0].textContent).toContain('Minimum wall thickness');
    expect(groups[0].textContent).toContain('0.5 mm / 1.2 mm');
    expect(groups[1].textContent).toContain('62 deg / 45 deg');
  });

  it('clicking selects, hovering lights', () => {
    const i = issue({});
    const { p, container } = setup({ report: report([i]) });
    const row = container.querySelector('.dcheck-issue')!;
    fireEvent.mouseEnter(row); expect(p.onHover).toHaveBeenLastCalledWith(i);
    fireEvent.mouseLeave(row); expect(p.onHover).toHaveBeenLastCalledWith(null);
    fireEvent.click(row); expect(p.onSelect).toHaveBeenCalledWith(i);
  });

  it('a stale result is greyed with a note and cannot be clicked', () => {
    const { container } = setup({ report: report([issue({})]), stale: true });
    expect(container.querySelector('.dcheck.stale')).not.toBeNull();
    expect(container.textContent).toContain('Out of date');
    expect((container.querySelector('.dcheck-issue') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a clean report says so', () => {
    const { container } = setup({ report: report([]) });
    expect(container.textContent).toContain('No issues found');
  });

  it('rule mode and limit edits go out as new settings', () => {
    const { p, container } = setup();
    const sel = container.querySelector('select[aria-label="Minimum wall thickness"]') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(['off', 'info', 'warn', 'block']);
    fireEvent.change(sel, { target: { value: 'block' } });
    expect((p.onSettings as ReturnType<typeof vi.fn>).mock.calls[0][0].minWall.mode).toBe('block');
    fireEvent.change(container.querySelector('input[aria-label="min"]')!, { target: { value: '2' } });
    expect((p.onSettings as ReturnType<typeof vi.fn>).mock.calls[1][0].minWall.params.min).toBe(2);
    fireEvent.change(container.querySelector('input[aria-label="direction z"]')!, { target: { value: '1' } });
    expect((p.onSettings as ReturnType<typeof vi.fn>).mock.calls[2][0].overhang.params.direction).toEqual([0, 1, 1]);
  });

  it('switches report back', () => {
    const { p, getByLabelText } = setup();
    fireEvent.click(getByLabelText('Show on part')); expect(p.onShowOnPart).toHaveBeenCalledWith(true);
    fireEvent.click(getByLabelText('Check after every edit')); expect(p.onAfterEdit).toHaveBeenCalledWith(true);
  });

  it('plural keys', () => {
    expect(plural('error', 1)).toBe('1 error');
    expect(plural('warn', 5)).toBe('5 warnings');
  });
});
