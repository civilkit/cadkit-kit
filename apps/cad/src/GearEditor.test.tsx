import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { GearEditor } from './GearEditor';
import { DEFAULT_GEAR, type GearParams } from './gearData';
import './i18n';

afterEach(() => cleanup());

function mount(params: GearParams = DEFAULT_GEAR) {
  const drafts: GearParams[] = [], confirms: GearParams[] = [];
  let cancelled = 0;
  const r = render(<GearEditor params={params} name="Gear 20T" onDraft={(d) => drafts.push(d)} onConfirm={(d) => confirms.push(d)} onCancel={() => { cancelled++; }} />);
  const input = (path: string) => r.container.querySelector(`[data-path="${path}"] input`) as HTMLInputElement;
  const set = (path: string, v: string) => fireEvent.change(input(path), { target: { value: v } });
  const ro = (k: string) => r.container.querySelector(`[data-k="${k}"]`)?.textContent;
  return { r, drafts, confirms, cancelled: () => cancelled, input, set, ro };
}

describe('GearEditor', () => {
  it('shows the readout for the record', () => {
    const m = mount();
    expect(m.ro('pitchDia')).toBe('40 mm');
    expect(m.ro('outsideDia')).toBe('44 mm');
    expect(m.ro('rootDia')).toBe('35 mm');
    expect(m.ro('minTeeth')).toBe('18');
  });
  it('a change sends the whole record as a draft and updates the readout; Enter confirms it, Escape cancels', () => {
    const m = mount();
    m.set('teeth', '30');
    expect(m.drafts.at(-1)).toMatchObject({ teeth: 30, module: 2 });
    expect(m.ro('pitchDia')).toBe('60 mm');
    fireEvent.keyDown(m.r.container.querySelector('.gear-editor')!, { key: 'Enter' });
    expect(m.confirms[0].teeth).toBe(30);
    fireEvent.keyDown(m.r.container.querySelector('.gear-editor')!, { key: 'Escape' });
    expect(m.cancelled()).toBe(1);
  });
  it('diametral pitch sizing converts the module, helical shows the angle, rack hides the bore', () => {
    const m = mount();
    fireEvent.click(m.r.container.querySelector('[data-value="dp"]')!);
    expect(m.drafts.at(-1)).toMatchObject({ sizing: 'dp', dp: 12.7 });
    fireEvent.click(m.r.container.querySelector('[data-value="helical"]')!);
    expect(m.input('helixAngle')).toBeTruthy();
    expect(m.ro('pitchDia')).not.toBe('40 mm');
    fireEvent.click(m.r.container.querySelector('[data-value="rack"]')!);
    expect(m.r.container.querySelector('[data-path="boreDia"]')).toBeNull();
    expect(m.ro('length')).toBeTruthy();
  });
  it('warns of undercut and the shift button fixes it; the mating gear section sets the centre distance', () => {
    const m = mount({ ...DEFAULT_GEAR, teeth: 12 });
    expect(m.r.container.querySelector('[data-warning="undercut"]')).toBeTruthy();
    fireEvent.click(m.r.container.querySelector('[data-testid="gear-use-shift"]')!);
    expect(m.drafts.at(-1)!.shift).toBeGreaterThan(0.3);
    expect(m.r.container.querySelector('[data-warning="undercut"]')).toBeNull();
    fireEvent.click(m.r.container.querySelector('[data-path="mate"] input')!);
    expect(m.drafts.at(-1)!.mate?.teeth).toBe(24);
    expect(m.r.container.querySelector('[data-testid="gear-centre"]')!.textContent).toMatch(/36 mm/);
  });
});
