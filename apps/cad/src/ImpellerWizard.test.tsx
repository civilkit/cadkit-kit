import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { ImpellerWizard, impellerIssueText, type ImpellerStep } from './ImpellerWizard';
import { DEFAULT_IMPELLER, IMPELLER_PRESETS, validateImpeller, type ImpellerParams } from './impellerData';
import './i18n';

afterEach(() => cleanup());

function mount(params: ImpellerParams = DEFAULT_IMPELLER, o: { edit?: boolean; name?: string; step?: ImpellerStep; hint?: string } = {}) {
  const drafts: ImpellerParams[] = [], creates: ImpellerParams[] = [];
  let cancelled = 0;
  const r = render(<ImpellerWizard params={params} edit={o.edit} name={o.name} step={o.step} hint={o.hint} onDraft={(d) => drafts.push(d)} onCreate={(d) => creates.push(d)} onCancel={() => { cancelled++; }} />);
  const q = (sel: string) => r.container.querySelector(sel) as HTMLElement;
  const input = (path: string) => r.container.querySelector(`[data-path="${path}"] input`) as HTMLInputElement;
  const set = (path: string, v: string) => fireEvent.change(input(path), { target: { value: v } });
  const go = (step: string) => fireEvent.click(q(`[data-step-tab="${step}"]`));
  return { r, drafts, creates, cancelled: () => cancelled, q, input, set, go };
}

describe('ImpellerWizard', () => {
  it('a new impeller previews its defaults at once; the three steps are tabs; Next and Back walk them', () => {
    const m = mount();
    expect(m.drafts).toEqual([DEFAULT_IMPELLER]);
    expect([...m.r.container.querySelectorAll('[role="tab"]')].map((x) => x.getAttribute('data-step-tab'))).toEqual(['hub', 'blade', 'review']);
    expect((m.q('[data-testid="impeller-back"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(m.q('[data-testid="impeller-next"]'));
    expect(m.q('[data-testid="impeller-wizard"]').getAttribute('data-step')).toBe('blade');
    fireEvent.click(m.q('[data-testid="impeller-next"]'));
    expect(m.q('[data-testid="impeller-wizard"]').getAttribute('data-step')).toBe('review');
    expect(m.q('[data-testid="impeller-next"]')).toBeNull();
  });

  it('an edit shows the name and does not draft on mount', () => {
    const e = mount(DEFAULT_IMPELLER, { edit: true, name: 'Turbo impeller' });
    expect(e.drafts.length).toBe(0);
    expect(e.q('.fedit-title').textContent).toContain('Turbo impeller');
  });

  it('a change sends the WHOLE record as a draft; the blade counts round to whole numbers', () => {
    const m = mount();
    m.set('exducerDiameter', '50');
    expect(m.drafts.at(-1)).toMatchObject({ exducerDiameter: 50, inducerDiameter: 20, mainBlades: 7, splitterBlades: 7 });
    m.set('mainBlades', '5.6');
    expect(m.drafts.at(-1)!.mainBlades).toBe(6);
  });

  it('a preset fills the sizes and every preset validates without errors', () => {
    const m = mount();
    fireEvent.change(m.q('[data-path="preset"] select'), { target: { value: 'wide9' } });
    expect(m.drafts.at(-1)).toMatchObject({ mainBlades: 9, exducerDiameter: 63, wrapDeg: 100 });
    for (const k of Object.keys(IMPELLER_PRESETS)) expect(validateImpeller({ ...DEFAULT_IMPELLER, ...IMPELLER_PRESETS[k] }).filter((i) => i.level === 'error'), k).toEqual([]);
  });

  it('blade step: the wrap, thicknesses, splitter start, span, embed and station fields are there and drive the record', () => {
    const m = mount();
    m.go('blade');
    for (const k of ['wrapDeg', 'bladeThickness', 'tipThickness', 'splitterStart', 'spanZ', 'spanR', 'rootEmbed', 'stations']) expect(m.input(k), k).toBeTruthy();
    m.set('wrapDeg', '90');
    m.set('stations', '14');
    m.set('splitterStart', '0.5');
    expect(m.drafts.at(-1)).toMatchObject({ wrapDeg: 90, stations: 14, splitterStart: 0.5 });
  });

  it('review: the readout shows the radii, counts and wrap; no issues says so; an error blocks Create and names the reason', () => {
    const m = mount(DEFAULT_IMPELLER, { step: 'review' });
    expect(m.q('[data-k="exducer"]').textContent).toContain('22.5');
    expect(m.q('[data-k="mainBlades"]').textContent).toBe('7');
    expect(m.q('[data-testid="impeller-issues"]').textContent).toMatch(/No problems|no problems|ok/i);
    fireEvent.click(m.q('[data-testid="impeller-create"]'));
    expect(m.creates).toEqual([DEFAULT_IMPELLER]);
    cleanup();
    const b = mount({ ...DEFAULT_IMPELLER, mainBlades: 1 }, { step: 'review' });
    expect((b.q('[data-testid="impeller-create"]') as HTMLButtonElement).disabled).toBe(true);
    expect(b.q('[data-issue="mainBlades"]').textContent).toMatch(/whole number/i);
    fireEvent.click(b.q('[data-testid="impeller-create"]'));
    expect(b.creates).toEqual([]);
  });

  it('warnings do not block Create; the live preview failure is shown; Enter creates on the review step and Escape cancels', () => {
    const m = mount({ ...DEFAULT_IMPELLER, tipThickness: 0.3 }, { step: 'review', hint: 'the hub fuse failed' });
    expect(m.q('[data-issue="thinTip"]').getAttribute('data-severity')).toBe('warning');
    expect(m.q('[data-testid="impeller-hint"]').textContent).toBe('the hub fuse failed');
    expect((m.q('[data-testid="impeller-create"]') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.keyDown(m.q('[data-testid="impeller-wizard"]'), { key: 'Enter' });
    expect(m.creates.length).toBe(1);
    fireEvent.keyDown(m.q('[data-testid="impeller-wizard"]'), { key: 'Escape' });
    expect(m.cancelled()).toBe(1);
  });

  it('every issue code has a catalogue text', () => {
    for (const o of [{ mainBlades: 1 }, { exducerDiameter: 0 }, { inducerDiameter: 90 }, { boreDiameter: 19 }, { wrapDeg: 5 }, { tipThickness: 0.05 }, { rootEmbed: 9 }, { stations: 2 }, { tipThickness: 0.3 }, { stations: 20 }, { wrapDeg: 150 }]) {
      for (const i of validateImpeller({ ...DEFAULT_IMPELLER, ...o })) {
        const txt = impellerIssueText(i);
        expect(txt.length, i.code).toBeGreaterThan(5);
        expect(txt, i.code).not.toMatch(/^impeller\.issue\./);
      }
    }
  });
});
