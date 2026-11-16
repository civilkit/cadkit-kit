import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { TrayWizard } from './TrayWizard';
import { DEFAULT_TRAY, type TrayParams } from './tray';
import './i18n';

afterEach(() => cleanup());

function mount(params: TrayParams = DEFAULT_TRAY, extra: { hint?: string; hasOthers?: boolean } = {}) {
  const drafts: TrayParams[] = [], applies: TrayParams[] = [];
  let cancelled = 0;
  const r = render(<TrayWizard params={params} {...extra} onDraft={(d) => drafts.push(d)} onApply={(d) => applies.push(d)} onCancel={() => { cancelled++; }} />);
  const q = (sel: string) => r.container.querySelector(sel) as HTMLElement;
  const input = (path: string) => r.container.querySelector(`[data-path="${path}"] input`) as HTMLInputElement;
  const select = (path: string) => r.container.querySelector(`[data-path="${path}"] select`) as HTMLSelectElement;
  return { r, drafts, applies, cancelled: () => cancelled, q, input, select };
}

describe('TrayWizard', () => {
  it('shows the defaults, previews them at once and says what is not included', () => {
    const m = mount();
    expect(m.drafts).toHaveLength(1);
    expect(m.input('widthUnits').value).toBe('1');
    expect(m.input('lengthUnits').value).toBe('4');
    expect(m.input('heightUnits').value).toBe('4');
    expect(m.input('scoopRadius').value).toBe('8');
    expect(m.select('endWalls').value).toBe('none');
    expect(m.select('printer').value).toBe('bambu-x1c');
    expect(m.input('bed').value).toBe('256');
    expect(m.q('[data-testid="tray-summary"]').textContent).toContain('Outside 41.5 x 167.5 x 28 mm');
    expect(m.q('[data-testid="tray-not-included"]').textContent).toMatch(/stacking flange/);
    expect(m.q('[data-testid="tray-bed"]').textContent).toMatch(/fits the 256 mm bed/);
    expect(m.q('[data-testid="tray-fit"]')).toBeNull();
    expect(m.q('[data-testid="tray-others"]')).toBeNull();
  });
  it('every valid change drafts the whole record', () => {
    const m = mount();
    fireEvent.change(m.input('lengthUnits'), { target: { value: '5.5' } });
    expect(m.drafts.at(-1)).toMatchObject({ lengthUnits: 5.5 });
    fireEvent.change(m.select('endWalls'), { target: { value: 'both' } });
    expect(m.drafts.at(-1)?.endWalls).toBe('both');
    fireEvent.change(m.input('x'), { target: { value: '5' } });
    expect(m.drafts.at(-1)?.origin).toEqual([5, 0, 0]);
  });
  it('a drawer size shows what it takes, and Fill the length sets the length and height', () => {
    const m = mount();
    fireEvent.change(m.input('drawerWidth'), { target: { value: '480' } });
    expect(m.q('[data-testid="tray-fit"]')).toBeNull();   // the depth is still missing
    fireEvent.change(m.input('drawerDepth'), { target: { value: '336' } });
    fireEvent.change(m.input('drawerHeight'), { target: { value: '70' } });
    expect(m.q('[data-testid="tray-fit"]').textContent).toMatch(/takes 11 x 8 units, 10 high/);
    fireEvent.click(m.q('[data-testid="tray-fill"]'));
    expect(m.drafts.at(-1)).toMatchObject({ lengthUnits: 8, heightUnits: 10 });
    expect(m.q('[data-testid="tray-fits"]').textContent).toMatch(/fits the drawer/);
  });
  it('a part longer than the bed says so, and changing the printer changes the verdict', () => {
    const m = mount();
    fireEvent.change(m.input('lengthUnits'), { target: { value: '7' } });
    expect(m.q('[data-testid="tray-bed"]').textContent).toMatch(/will not print in one piece/);
    fireEvent.change(m.select('printer'), { target: { value: 'creality-k1-max' } });
    expect(m.input('bed').value).toBe('300');
    expect(m.q('[data-testid="tray-bed"]').textContent).toMatch(/fits the 300 mm bed/);
  });
  it('a problem blocks Add and the preview, and says why in plain words', () => {
    const m = mount();
    const before = m.drafts.length;
    fireEvent.change(m.input('wall'), { target: { value: '0.2' } });
    expect(m.drafts.length).toBe(before);
    expect((m.q('[data-testid="tray-apply"]') as HTMLButtonElement).disabled).toBe(true);
    expect(m.q('[data-issue="wall"]').textContent).toBe('The wall must be at least 0.4 mm');
    fireEvent.click(m.q('[data-testid="tray-apply"]'));
    expect(m.applies).toHaveLength(0);
    fireEvent.change(m.input('wall'), { target: { value: '1.2' } });
    fireEvent.change(m.input('scoopRadius'), { target: { value: '30' } });
    expect(m.q('[data-issue="scoop"]').textContent).toMatch(/at most half of the inside width/);
  });
  it('Add applies the current record; Cancel and Escape cancel; Enter in a number field applies', () => {
    const m = mount();
    fireEvent.change(m.input('widthUnits'), { target: { value: '2' } });
    fireEvent.click(m.q('[data-testid="tray-apply"]'));
    expect(m.applies).toHaveLength(1);
    expect(m.applies[0]).toMatchObject({ widthUnits: 2 });
    fireEvent.keyDown(m.input('lengthUnits'), { key: 'Enter' });
    expect(m.applies).toHaveLength(2);
    fireEvent.click(m.q('[data-testid="tray-cancel"]'));
    fireEvent.keyDown(m.q('[data-testid="tray-wizard"]'), { key: 'Escape' });
    expect(m.cancelled()).toBe(2);
  });
  it('mentions other bodies and shows the preview failure the app hands in', () => {
    expect(mount(DEFAULT_TRAY, { hasOthers: true }).q('[data-testid="tray-others"]')).not.toBeNull();
    expect(mount(DEFAULT_TRAY, { hint: 'kernel said no' }).q('[data-testid="tray-hint"]').textContent).toBe('kernel said no');
  });
  it('Baseplate: tray-only fields go, the plate fields and summary show, and the draft carries the kind', () => {
    const m = mount();
    fireEvent.change(m.select('kind'), { target: { value: 'baseplate' } });
    expect(m.drafts.at(-1)?.kind).toBe('baseplate');
    expect(m.q('[data-path="heightUnits"]')).toBeNull();
    expect(m.q('[data-path="magnets"]')).toBeNull();
    expect(m.input('base').value).toBe('1.2');
    expect(m.input('clearance').value).toBe('0.1');
    expect(m.q('[data-testid="tray-summary"]').textContent).toContain('Baseplate 42 x 168 x 5.95 mm');
    expect(m.q('[data-testid="tray-not-included"]')).toBeNull();
  });
});
