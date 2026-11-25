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
  it('pressure angle stops at 26 degrees and root fillet at 0.5 module: the kernel builds a bad solid beyond them at common tooth counts', () => {
    const m = mount();
    m.set('pressureAngle', '30');
    expect(m.drafts.at(-1)).toMatchObject({ pressureAngle: 26 });
    m.set('rootFillet', '0.6');
    expect(m.drafts.at(-1)).toMatchObject({ rootFillet: 0.5 });
  });
  it('the limits are always shown under the fields, and a value above one says it was set to the limit', () => {
    const m = mount();
    const note = (path: string) => m.r.container.querySelector(`[data-path="${path}"] .fedit-fld-note`) as HTMLElement | null;
    expect(note('pressureAngle')?.textContent).toBe('Up to 26 deg: a steeper angle makes an invalid gear');
    expect(note('rootFillet')?.textContent).toBe('Up to 0.5 x module: a larger fillet makes an invalid gear');
    expect(note('pressureAngle')?.dataset.note).toBe('range');
    m.set('pressureAngle', '30');
    expect(note('pressureAngle')?.textContent).toBe('Set to the limit (26)');
    expect(note('pressureAngle')?.dataset.note).toBe('clamped');
    expect(note('rootFillet')?.dataset.note).toBe('range');   // the other field is untouched
    m.set('pressureAngle', '22');
    expect(note('pressureAngle')?.dataset.note).toBe('range');
    m.set('rootFillet', '0.6');
    expect(note('rootFillet')?.textContent).toBe('Set to the limit (0.5)');
  });
  it('every clamped field says so: helix angle and profile shift show their range, and a value below the minimum is set to it with the note', () => {
    const m = mount({ ...DEFAULT_GEAR, type: 'helical' });
    const note = (path: string) => m.r.container.querySelector(`[data-path="${path}"] .fedit-fld-note`) as HTMLElement | null;
    expect(note('helixAngle')?.textContent).toBe('From 1 to 45 deg');
    expect(note('shift')?.textContent).toBe('From -1 to 1.5 x module');
    m.set('helixAngle', '60');
    expect(note('helixAngle')?.textContent).toBe('Set to the limit (45)');
    m.set('pressureAngle', '5');
    expect(note('pressureAngle')?.textContent).toBe('Set to the limit (10)');
    expect(m.drafts.at(-1)).toMatchObject({ pressureAngle: 10 });
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
  it('herringbone: chevron toggle and groove field instead of the helical hand, defaults 30 degrees and a groove of 3 modules capped at a quarter of the face, warns on a wide groove', () => {
    const m = mount();
    fireEvent.click(m.r.container.querySelector('[data-value="herringbone"]')!);
    expect(m.drafts.at(-1)).toMatchObject({ type: 'herringbone', helixAngle: 30, grooveWidth: 2.5 });
    expect(m.input('helixAngle').value).toBe('30');
    expect(m.input('grooveWidth')).toBeTruthy();
    expect(m.r.container.querySelector('[data-path="hand"] [data-value="right"]')!.textContent).toMatch(/Apex leading/);
    expect(m.r.container.querySelector('[data-testid="gear-twist"]')).toBeNull();
    expect(m.r.container.querySelector('[data-path="mate"]')).toBeTruthy();
    expect(m.ro('groove')).toBe('2.5 mm');
    expect(m.ro('faceWidth')).toBe('10 mm');
    expect(m.ro('overlapHalf')).toBeTruthy();
    expect(m.r.container.querySelector('[data-testid="gear-hb-note"]')).toBeTruthy();
    expect(m.r.container.querySelector('[data-warning="grooveWide"]')).toBeNull();
    m.set('grooveWidth', '10');
    expect(m.drafts.at(-1)!.grooveWidth).toBe(10);
    expect(m.r.container.querySelector('[data-warning="grooveWide"]')).toBeTruthy();
    fireEvent.click(m.r.container.querySelector('[data-value="spur"]')!);
    expect(m.r.container.querySelector('[data-path="grooveWidth"]')).toBeNull();
    expect(m.r.container.querySelector('[data-path="helixAngle"]')).toBeNull();
  });
});
