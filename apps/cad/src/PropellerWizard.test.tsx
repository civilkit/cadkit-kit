import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { PropellerWizard, CurveGraph, issueText, type WizardStep } from './PropellerWizard';
import { DEFAULT_PROP, validateProp, type PropParams } from './propData';
import './i18n';

afterEach(() => cleanup());

function mount(params: PropParams = DEFAULT_PROP, o: { edit?: boolean; name?: string; step?: WizardStep; hint?: string } = {}) {
  const drafts: PropParams[] = [], creates: PropParams[] = [];
  let cancelled = 0;
  const r = render(<PropellerWizard params={params} edit={o.edit} name={o.name} step={o.step} hint={o.hint} onDraft={(d) => drafts.push(d)} onCreate={(d) => creates.push(d)} onCancel={() => { cancelled++; }} />);
  const q = (sel: string) => r.container.querySelector(sel) as HTMLElement;
  const input = (path: string) => r.container.querySelector(`[data-path="${path}"] input`) as HTMLInputElement;
  const set = (path: string, v: string) => fireEvent.change(input(path), { target: { value: v } });
  const go = (step: string) => fireEvent.click(q(`[data-step-tab="${step}"]`));
  return { r, drafts, creates, cancelled: () => cancelled, q, input, set, go };
}

describe('PropellerWizard', () => {
  it('a new propeller previews its defaults at once; the three steps are tabs and Next / Back walk them', () => {
    const m = mount();
    expect(m.drafts.length).toBe(1);
    expect(m.drafts[0]).toEqual(DEFAULT_PROP);
    expect(m.q('[data-testid="prop-wizard"]').getAttribute('data-step')).toBe('size');
    expect([...m.r.container.querySelectorAll('[role="tab"]')].map((x) => x.getAttribute('data-step-tab'))).toEqual(['size', 'blade', 'review']);
    expect((m.q('[data-testid="prop-back"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(m.q('[data-testid="prop-next"]'));
    expect(m.q('[data-testid="prop-wizard"]').getAttribute('data-step')).toBe('blade');
    fireEvent.click(m.q('[data-testid="prop-next"]'));
    expect(m.q('[data-testid="prop-wizard"]').getAttribute('data-step')).toBe('review');
    expect(m.q('[data-testid="prop-next"]')).toBeNull();
    fireEvent.click(m.q('[data-testid="prop-back"]'));
    expect(m.q('[data-testid="prop-wizard"]').getAttribute('data-step')).toBe('blade');
  });

  it('an edit of a built propeller does not re-preview on open and says Apply', () => {
    const m = mount({ ...DEFAULT_PROP, diameter: 150 }, { edit: true, name: 'Propeller', step: 'review' });
    expect(m.drafts.length).toBe(0);
    expect(m.q('.fedit-title').textContent).toContain('Propeller');
    expect(m.q('[data-testid="prop-create"]').textContent).toBe('Apply');
  });

  it('size step: a change sends the WHOLE record as a draft; blade count rounds to a whole number; the marine family is offered but disabled', () => {
    const m = mount();
    m.set('diameter', '150');
    expect(m.drafts.at(-1)).toMatchObject({ diameter: 150, hubDia: 24, blades: 3 });
    m.set('blades', '4.6');
    expect(m.drafts.at(-1)!.blades).toBe(5);
    const marine = m.q('[data-value="marine"]') as HTMLButtonElement;
    expect(marine.disabled).toBe(true);
    expect(marine.textContent).toMatch(/coming soon/);
    fireEvent.click(m.q('[data-value="ccw"]'));
    fireEvent.click(m.q('[data-value="cw"]'));
    expect(m.drafts.at(-1)!.direction).toBe('cw');
  });

  it('a preset fills the sizes and keeps the variable prefix', () => {
    const m = mount({ ...DEFAULT_PROP, varPrefix: 'prop2' });
    fireEvent.change(m.q('[data-path="preset"] select'), { target: { value: 'deskFan' } });
    const d = m.drafts.at(-1)!;
    expect(d).toMatchObject({ diameter: 160, blades: 5, varPrefix: 'prop2' });
  });

  it('blade step: the twist mode decides which fields show; the chord graph handles move with the arrow keys (Shift = ten steps)', () => {
    const m = mount();
    m.go('blade');
    expect(m.input('pitch')).toBeTruthy();
    expect(m.input('pitchAngle')).toBeNull();
    fireEvent.click(m.q('[data-value="angle"]'));
    expect(m.drafts.at(-1)!.twist).toBe('angle');
    expect(m.input('pitchAngle')).toBeTruthy(); expect(m.input('pitch')).toBeNull();
    fireEvent.click(m.q('[data-value="linear"]'));
    expect(m.input('rootAngle')).toBeTruthy(); expect(m.input('tipAngle')).toBeTruthy();
    const root = m.q('[data-curve="chord"] [data-handle="root"]');
    fireEvent.keyDown(root, { key: 'ArrowUp' });
    expect(m.drafts.at(-1)!.chordRoot).toBe(18.5);
    fireEvent.keyDown(m.q('[data-curve="chord"] [data-handle="tip"]'), { key: 'ArrowDown', shiftKey: true });
    expect(m.drafts.at(-1)!.chordTip).toBe(4);
    fireEvent.keyDown(m.q('[data-curve="thick"] [data-handle="mid"]'), { key: 'ArrowUp' });
    expect(m.drafts.at(-1)!.thickMid).toBeCloseTo(0.105, 6);
    expect(m.q('[data-curve="chord"] [data-handle="mid"]').getAttribute('aria-valuenow')).toBe('20');
  });

  it('the airfoil choice changes the options (camber position only for NACA, no camber for a flat plate) and shows the section outline', () => {
    const m = mount();
    m.go('blade');
    expect(m.input('camberPos')).toBeTruthy();
    fireEvent.click(m.q('[data-value="arc"]'));
    expect(m.drafts.at(-1)!.airfoil).toBe('arc');
    expect(m.input('camberPos')).toBeNull(); expect(m.input('camber')).toBeTruthy();
    fireEvent.click(m.q('[data-value="plate"]'));
    expect(m.input('camber')).toBeNull();
    expect(m.q('[data-testid="prop-airfoil"] path').getAttribute('d')).toMatch(/^M/);
  });

  it('review step: the readout, no issues for the defaults, the no-fillet note, Create sends the record', () => {
    const m = mount();
    m.go('review');
    expect(m.q('[data-k="pitch"]').textContent).toBe('90 mm/rev');
    expect(m.q('[data-k="pitchRatio"]').textContent).toBe('0.75');
    expect(m.q('[data-k="blades"]').textContent).toBe('3');
    expect(m.q('[data-testid="prop-issues"]').textContent).toMatch(/No problems/);
    expect(m.q('[data-testid="prop-nofillet"]').textContent).toMatch(/without a root fillet/);
    fireEvent.click(m.q('[data-testid="prop-create"]'));
    expect(m.creates).toEqual([DEFAULT_PROP]);
  });

  it('review step: an error blocks Create and names both sizes; a warning does not block; a preview failure shows its hint', () => {
    const bad = mount({ ...DEFAULT_PROP, hubDia: 130 }, { step: 'review' });
    const create = bad.q('[data-testid="prop-create"]') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(bad.creates.length).toBe(0);
    const iss = bad.q('[data-issue="hubTooBig"]');
    expect(iss.getAttribute('data-severity')).toBe('error');
    expect(iss.textContent).toMatch(/130/); expect(iss.textContent).toMatch(/120/);
    cleanup();
    const warn = mount({ ...DEFAULT_PROP, hubLength: 6 }, { step: 'review', hint: 'F9: loftProfile' });
    expect(warn.q('[data-issue="rootOverhang"]').getAttribute('data-severity')).toBe('warning');
    expect((warn.q('[data-testid="prop-create"]') as HTMLButtonElement).disabled).toBe(false);
    expect(warn.q('[data-testid="prop-hint"]').textContent).toBe('F9: loftProfile');
  });

  it('Escape cancels, Enter on the review step creates, Enter on the other steps does not', () => {
    const m = mount();
    fireEvent.keyDown(m.q('[data-testid="prop-wizard"]'), { key: 'Enter' });
    expect(m.creates.length).toBe(0);
    m.go('review');
    fireEvent.keyDown(m.q('[data-testid="prop-wizard"]'), { key: 'Enter' });
    expect(m.creates.length).toBe(1);
    fireEvent.keyDown(m.q('[data-testid="prop-wizard"]'), { key: 'Escape' });
    expect(m.cancelled()).toBe(1);
    fireEvent.click(m.q('.fedit-cancel'));
    expect(m.cancelled()).toBe(2);
  });

  it('every validation code the engine can raise has a translated message (no raw keys)', () => {
    const samples: PropParams[] = [
      { ...DEFAULT_PROP, hubDia: 130 }, { ...DEFAULT_PROP, boreDia: 23 }, { ...DEFAULT_PROP, boreDia: 12, rootEmbed: 0.4 }, { ...DEFAULT_PROP, blades: 1 }, { ...DEFAULT_PROP, sections: 4 }, { ...DEFAULT_PROP, pitch: 0 },
      { ...DEFAULT_PROP, twist: 'angle', pitchAngle: 85 }, { ...DEFAULT_PROP, thickTip: 0.01 }, { ...DEFAULT_PROP, camber: 0.3 }, { ...DEFAULT_PROP, chordTip: 0.2 }, { ...DEFAULT_PROP, diameter: 5 }, { ...DEFAULT_PROP, diameter: NaN },
      { ...DEFAULT_PROP, skew: 40 }, { ...DEFAULT_PROP, hubLength: 6 }, { ...DEFAULT_PROP, blades: 8, chordRoot: 30 }, { ...DEFAULT_PROP, chordTip: 3, thickTip: 0.04 }, { ...DEFAULT_PROP, pitch: 400 },
      { ...DEFAULT_PROP, camberPos: 0.95 }, { ...DEFAULT_PROP, pivot: 2 }, { ...DEFAULT_PROP, rake: 80 }, { ...DEFAULT_PROP, chordExp: 9 }, { ...DEFAULT_PROP, hubLength: 0 }, { ...DEFAULT_PROP, hubDia: 0 }, { ...DEFAULT_PROP, refRadius: 3, twist: 'angle' },
      { ...DEFAULT_PROP, twist: 'linear', rootAngle: 90 }, { ...DEFAULT_PROP, rootEmbed: 0.1 }, { ...DEFAULT_PROP, boreDia: -1 },
    ];
    const seen = new Set<string>();
    for (const p of samples) for (const i of validateProp(p)) {
      seen.add(i.code);
      const text = issueText(i);
      expect(text, i.code).not.toMatch(/^prop\.issue\./);
      expect(text, i.code).not.toMatch(/\{[a-z]+\}/);   // every placeholder filled
    }
    expect(seen.size).toBeGreaterThan(20);
  });
});

describe('CurveGraph', () => {
  it('clamps to the range and rounds to the step', () => {
    const got: Array<[number, number, number]> = [];
    const r = render(<CurveGraph name="c" title="Chord" values={[10, 12, 6]} exp={1} min={1} max={30} step={0.5} onChange={(v) => got.push(v)} />);
    const tip = r.container.querySelector('[data-handle="tip"]')!;
    for (let i = 0; i < 3; i++) fireEvent.keyDown(tip, { key: 'ArrowDown', shiftKey: true });
    expect(got.at(-1)![2]).toBe(1);   // 6 - 5 -> 1, the following steps hold at the minimum
    fireEvent.keyDown(r.container.querySelector('[data-handle="root"]')!, { key: 'ArrowUp', shiftKey: true });
    expect(got.at(-1)![0]).toBe(15);
    expect(r.container.querySelector('[data-handle="mid"]')!.getAttribute('aria-valuetext')).toBe('Mid: 12');
  });
});
