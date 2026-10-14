import { describe, expect, it } from 'vitest';
import { blockedIssues, blockMessage, chipParts, chipTone, groupIssues, issueFaceMap, issueTarget, severityCss, valueText, type Issue } from './designCheck';

const issue = (o: Partial<Issue>): Issue => ({ rule: 'minWall', severity: 'error', message: 'm', faces: [], edges: [], value: 0.5, limit: 1.2, unit: 'mm', ...o }) as Issue;
describe('grouping and colours', () => {
  it('groups worst first, drops empty groups, keeps kernel order inside', () => {
    const g = groupIssues([issue({ severity: 'info', message: 'i' }), issue({ severity: 'error', message: 'a' }), issue({ severity: 'error', message: 'b' })]);
    expect(g.map((x) => x.severity)).toEqual(['error', 'info']);
    expect(g[0].issues.map((i) => i.message)).toEqual(['a', 'b']);
  });
  it('severity colours differ and are css hex', () => {
    const c = (['error', 'warn', 'info'] as const).map(severityCss);
    expect(new Set(c).size).toBe(3);
    expect(c[0]).toBe('#d1242f');
  });
  it('face map keeps the worst severity per face', () => {
    expect(issueFaceMap([issue({ severity: 'warn', faces: ['F1', 'F2'] }), issue({ severity: 'error', faces: ['F2'] }), issue({ severity: 'info', faces: ['F2', 'F3'] })]))
      .toEqual({ F1: 'warn', F2: 'error', F3: 'info' });
  });
  it('target is edges in edge mode when present, else faces', () => {
    expect(issueTarget(issue({ faces: ['A', 'B'], edges: ['A|B#1'] }))).toEqual({ names: ['A|B#1'], mode: 'edge' });
    expect(issueTarget(issue({ faces: ['A', 'B'] }))).toEqual({ names: ['A', 'B'], mode: 'face' });
  });
  it('value text', () => {
    expect(valueText({ value: 0.5, limit: 1.2, unit: 'mm' })).toBe('0.5 mm / 1.2 mm');
    expect(valueText({ value: 3, limit: null, unit: '' })).toBe('3');
    expect(valueText({ value: null, limit: 1, unit: 'mm' })).toBe('');
  });
});

describe('blocking diff', () => {
  const wall = (faces: string[], value = 0.5) => issue({ rule: 'minWall', faces, value });
  it('a pre-existing violation never blocks', () => {
    expect(blockedIssues([wall(['A', 'B'])], [wall(['A', 'B'])], ['minWall'])).toEqual([]);
  });
  it('a new violation blocks; only the new one is returned', () => {
    const fresh = wall(['C', 'D']);
    expect(blockedIssues([wall(['A', 'B'])], [wall(['A', 'B']), fresh], ['minWall'])).toEqual([fresh]);
  });
  it('fewer issues, other rules and non-blocking rules do not block', () => {
    expect(blockedIssues([wall(['A']), wall(['B'])], [wall(['A'])], ['minWall'])).toEqual([]);
    expect(blockedIssues([], [issue({ rule: 'overhang' })], ['minWall'])).toEqual([]);
  });
  it('same count with renamed faces does not block (no growth)', () => {
    expect(blockedIssues([wall(['A'])], [wall(['Z'])], ['minWall'])).toEqual([]);
  });
  it('message names the rule, value, faces and limit', () => {
    const m = blockMessage([issue({ rule: 'overhang', faces: ['F5.S.e2'], value: 62, limit: 45, unit: 'deg' })], { overhang: 'Overhang' });
    expect(m).toContain('Overhang: 62 degrees on F5.S.e2, limit 45');
  });
});

describe('chip', () => {
  it('tone follows the worst severity', () => {
    const r = (e: number, w: number, i: number) => chipParts('P', { summary: { errors: e, warnings: w, infos: i } } as never);
    expect(chipTone(r(2, 5, 0))).toBe('err');
    expect(chipTone(r(0, 1, 0))).toBe('warn');
    expect(chipTone(r(0, 0, 3))).toBe('ok');
  });
});
