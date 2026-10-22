import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { MarineWizard, marineIssueText, type MarineStep } from './MarineWizard';
import { DEFAULT_MARINE, MARINE_PRESETS, validateMarine, type MarineParams } from './marineData';
import './i18n';

afterEach(() => cleanup());

function mount(params: MarineParams = DEFAULT_MARINE, o: { edit?: boolean; name?: string; step?: MarineStep; hint?: string } = {}) {
  const drafts: MarineParams[] = [], creates: MarineParams[] = [], families: string[] = [];
  let cancelled = 0;
  const r = render(<MarineWizard params={params} edit={o.edit} name={o.name} step={o.step} hint={o.hint} onDraft={(d) => drafts.push(d)} onCreate={(d) => creates.push(d)} onCancel={() => { cancelled++; }} onFamily={(f) => families.push(f)} />);
  const q = (sel: string) => r.container.querySelector(sel) as HTMLElement;
  const input = (path: string) => r.container.querySelector(`[data-path="${path}"] input`) as HTMLInputElement;
  const set = (path: string, v: string) => fireEvent.change(input(path), { target: { value: v } });
  const go = (step: string) => fireEvent.click(q(`[data-step-tab="${step}"]`));
  return { r, drafts, creates, families, cancelled: () => cancelled, q, input, set, go };
}

describe('MarineWizard', () => {
  it('a new propeller previews its defaults at once; the three steps are tabs; Next and Back walk them', () => {
    const m = mount();
    expect(m.drafts).toEqual([DEFAULT_MARINE]);
    expect([...m.r.container.querySelectorAll('[role="tab"]')].map((x) => x.getAttribute('data-step-tab'))).toEqual(['size', 'blade', 'review']);
    expect((m.q('[data-testid="marine-back"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(m.q('[data-testid="marine-next"]'));
    expect(m.q('[data-testid="marine-wizard"]').getAttribute('data-step')).toBe('blade');
    fireEvent.click(m.q('[data-testid="marine-next"]'));
    expect(m.q('[data-testid="marine-wizard"]').getAttribute('data-step')).toBe('review');
    expect(m.q('[data-testid="marine-next"]')).toBeNull();
  });

  it('the family control is on the size step of a new propeller and goes back to the airfoil; an edit does not show it', () => {
    const m = mount();
    expect(m.q('[data-value="marine"]').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(m.q('[data-value="airfoil"]'));
    expect(m.families).toEqual(['airfoil']);
    cleanup();
    const e = mount(DEFAULT_MARINE, { edit: true, name: 'Marine propeller' });
    expect(e.q('[data-path="family"]')).toBeNull();
    expect(e.drafts.length).toBe(0);
    expect(e.q('.fedit-title').textContent).toContain('Marine propeller');
  });

  it('a change sends the WHOLE record as a draft; the blade count rounds to a whole number; the direction toggles', () => {
    const m = mount();
    m.set('diameter', '300');
    expect(m.drafts.at(-1)).toMatchObject({ diameter: 300, hubDia: 50, blades: 3, direction: 'rh' });
    m.set('blades', '4.6');
    expect(m.drafts.at(-1)!.blades).toBe(5);
    fireEvent.click(m.q('[data-value="lh"]'));
    expect(m.drafts.at(-1)!.direction).toBe('lh');
  });

  it('a preset fills the sizes', () => {
    const m = mount();
    fireEvent.change(m.q('[data-path="preset"] select'), { target: { value: 'inboard4' } });
    expect(m.drafts.at(-1)).toMatchObject({ diameter: 400, blades: 4, hubLength: 200 });
    for (const k of Object.keys(MARINE_PRESETS)) expect(validateMarine({ ...DEFAULT_MARINE, ...MARINE_PRESETS[k] }).filter((i) => i.level === 'error'), k).toEqual([]);
  });

  it('blade step: the pitch, area ratio, chord shape, skew, thickness, root embed and section spacing fields are there and drive the record', () => {
    const m = mount();
    m.go('blade');
    for (const k of ['pitchRatio', 'ear', 'peak', 'rootRatio', 'tipRatio', 'skew', 'thickRoot', 'thickTip', 'rootEmbed', 'raySpacing']) expect(m.input(k), k).toBeTruthy();
    m.set('pitchRatio', '1.3');
    m.set('skew', '25');
    m.set('raySpacing', '7');
    expect(m.drafts.at(-1)).toMatchObject({ pitchRatio: 1.3, skew: 25, raySpacing: 7 });
  });

  it('blade step: rake and progressive pitch are fields with tips; they drive the record, rake and pitch are not mentioned as missing anywhere', () => {
    const m = mount();
    m.go('blade');
    for (const k of ['rake', 'pitchProgress']) {
      expect(m.input(k), k).toBeTruthy();
      expect(m.input(k).getAttribute('title')?.length, k).toBeGreaterThan(20);
    }
    expect(m.input('rake').value).toBe('0'); expect(m.input('pitchProgress').value).toBe('0');
    m.set('rake', '12');
    expect(m.drafts.at(-1)).toMatchObject({ rake: 12, pitchProgress: 0 });
    m.set('pitchProgress', '0.25');
    expect(m.drafts.at(-1)).toMatchObject({ rake: 12, pitchProgress: 0.25 });
    m.set('rake', '-8');
    expect(m.drafts.at(-1)!.rake).toBe(-8);
    // the review notes no longer say that rake and progressive pitch are missing
    m.go('review');
    expect(m.r.container.textContent).not.toMatch(/no rake|progressive pitch yet|Constant pitch only/i);
  });

  it('review: the pitch at the hub and the rake appear in the readout only when they are set; an out-of-range value is an error that blocks Create', () => {
    const plain = mount(DEFAULT_MARINE, { step: 'review' });
    expect(plain.q('[data-k="pitchRoot"]')).toBeNull(); expect(plain.q('[data-k="rake"]')).toBeNull();
    cleanup();
    const m = mount({ ...DEFAULT_MARINE, rake: 10, pitchProgress: 0.2, hubLength: 120 }, { step: 'review' });
    expect(m.q('[data-k="pitchRoot"]').textContent).toContain('300');
    expect(m.q('[data-k="rake"]').textContent).toContain('10');
    expect(m.q('[data-k="pitch"]').textContent).toContain('250');
    cleanup();
    const bad = mount({ ...DEFAULT_MARINE, rake: 45 }, { step: 'review' });
    expect(bad.q('[data-issue="rake"]').getAttribute('data-severity')).toBe('error');
    expect(bad.q('[data-issue="rake"]').textContent).toMatch(/rake must be between/i);
    expect((bad.q('[data-testid="marine-create"]') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const low = mount({ ...DEFAULT_MARINE, pitchRatio: 0.75 }, { step: 'review' });
    expect(low.q('[data-issue="rootPitch"]').getAttribute('data-severity')).toBe('warning');
    expect((low.q('[data-testid="marine-create"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('review: the readout shows the pitch, the angles and the area ratio; no issues says so; an error blocks Create and names the hub length needed', () => {
    const m = mount(DEFAULT_MARINE, { step: 'review' });
    expect(m.q('[data-k="pitch"]').textContent).toContain('250');
    expect(m.q('[data-k="ear"]').textContent).toBe('0.5');
    expect(m.q('[data-testid="marine-issues"]').textContent).toMatch(/No problems|no problems|ok/i);
    fireEvent.click(m.q('[data-testid="marine-create"]'));
    expect(m.creates).toEqual([DEFAULT_MARINE]);
    cleanup();
    const b = mount({ ...DEFAULT_MARINE, hubLength: 20 }, { step: 'review' });
    expect((b.q('[data-testid="marine-create"]') as HTMLButtonElement).disabled).toBe(true);
    expect(b.q('[data-issue="hubShort"]').textContent).toMatch(/hub is too short/i);
    fireEvent.click(b.q('[data-testid="marine-create"]'));
    expect(b.creates).toEqual([]);
  });

  it('warnings do not block Create; the live preview failure is shown; Enter creates on the review step and Escape cancels', () => {
    const m = mount({ ...DEFAULT_MARINE, thickTip: 0.001 }, { step: 'review', hint: 'the hub fuse failed' });
    expect(m.q('[data-issue="thinTip"]').getAttribute('data-severity')).toBe('warning');
    expect(m.q('[data-testid="marine-hint"]').textContent).toBe('the hub fuse failed');
    expect((m.q('[data-testid="marine-create"]') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.keyDown(m.q('[data-testid="marine-wizard"]'), { key: 'Enter' });
    expect(m.creates.length).toBe(1);
    fireEvent.keyDown(m.q('[data-testid="marine-wizard"]'), { key: 'Escape' });
    expect(m.cancelled()).toBe(1);
  });

  it('every issue code has a catalogue text (the hub length is the generator message)', () => {
    for (const o of [{ blades: 1 }, { pitchRatio: 0.2 }, { ear: 3 }, { thickTip: 0.001 }, { thickTip: 0.05, thickRoot: 0.01 }, { raySpacing: 1 }, { rootEmbed: 2 }, { diameter: 0 }, { hubLength: 10 }, { rake: 40 }, { pitchProgress: 0.9 }, { pitchRatio: 0.7 }]) {
      for (const i of validateMarine({ ...DEFAULT_MARINE, ...o })) {
        const txt = marineIssueText(i);
        expect(txt.length, i.code).toBeGreaterThan(5);
        expect(txt, i.code).not.toMatch(/^marine\.issue\./);
      }
    }
  });
});
