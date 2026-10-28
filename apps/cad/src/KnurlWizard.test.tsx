import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { KnurlWizard } from './KnurlWizard';
import { DEFAULT_KNURL, type KnurlParams } from './knurl';
import './i18n';

afterEach(() => cleanup());

const withTarget = (o: Partial<KnurlParams> = {}): KnurlParams => ({ ...DEFAULT_KNURL, count: 24, depth: 0.6, target: { axis: 'z', center: [0, 0], radius: 10, from: 0, to: 12 }, ...o });
function mount(params: KnurlParams, o: { reason?: string; hint?: string } = {}) {
  const drafts: KnurlParams[] = [], applies: KnurlParams[] = [];
  let cancelled = 0;
  const r = render(<KnurlWizard params={params} reason={o.reason} hint={o.hint} onDraft={(d) => drafts.push(d)} onApply={(d) => applies.push(d)} onCancel={() => { cancelled++; }} />);
  const q = (sel: string) => r.container.querySelector(sel) as HTMLElement;
  const input = (path: string) => r.container.querySelector(`[data-path="${path}"] input`) as HTMLInputElement;
  const set = (path: string, v: string) => fireEvent.change(input(path), { target: { value: v } });
  return { r, drafts, applies, cancelled: () => cancelled, q, input, set };
}

describe('KnurlWizard', () => {
  it('previews its defaults at once, shows the cylinder and the groove spacing', () => {
    const m = mount(withTarget());
    expect(m.drafts.length).toBe(1);
    expect(m.q('[data-testid="knurl-target"]').textContent).toMatch(/radius 10 mm, axis Z/);
    expect(m.q('[data-testid="knurl-pitch"]').textContent).toMatch(/2\.62/);
    expect(m.input('helixAngle')).toBeNull();   // only a diamond has a helix angle
  });
  it('every change is a preview of the whole record; changing the pattern to diamond shows the helix angle', () => {
    const m = mount(withTarget());
    m.set('count', '16');
    expect(m.drafts.at(-1)).toMatchObject({ count: 16, pattern: 'straight' });
    fireEvent.change(m.r.container.querySelector('[data-path="pattern"] select') as HTMLSelectElement, { target: { value: 'diamond' } });
    expect(m.drafts.at(-1)?.pattern).toBe('diamond');
    expect(m.input('helixAngle')).not.toBeNull();
    m.set('helixAngle', '40');
    expect(m.drafts.at(-1)?.helixAngle).toBe(40);
    m.set('from', '2');
    expect(m.drafts.at(-1)?.range).toEqual([2, 12]);
  });
  it('the build method is offered for a V diamond or pyramid only, faceted by default', () => {
    const m = mount(withTarget());
    expect(m.q('[data-path="method"]')).toBeNull();
    fireEvent.change(m.r.container.querySelector('[data-path="pattern"] select') as HTMLSelectElement, { target: { value: 'pyramid' } });
    const sel = m.r.container.querySelector('[data-path="method"] select') as HTMLSelectElement;
    expect(sel.value).toBe('faceted');
    fireEvent.change(sel, { target: { value: 'boolean' } });
    expect(m.drafts.at(-1)).toMatchObject({ pattern: 'pyramid', method: 'boolean' });
    fireEvent.change(m.r.container.querySelector('[data-path="profile"] select') as HTMLSelectElement, { target: { value: 'round' } });
    expect(m.q('[data-path="method"]')).toBeNull();
  });
  it('grooves that overlap block Knurl, say why and are not previewed', () => {
    const m = mount(withTarget());
    const before = m.drafts.length;
    m.set('count', '90');
    expect(m.drafts.length).toBe(before);
    expect(m.q('[data-issue="kernel"]').textContent).toMatch(/overlap/);
    expect((m.q('[data-testid="knurl-apply"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(m.q('[data-testid="knurl-apply"]'));
    expect(m.applies.length).toBe(0);
  });
  it('Knurl applies the record; Escape and the cross cancel', () => {
    const m = mount(withTarget());
    fireEvent.click(m.q('[data-testid="knurl-apply"]'));
    expect(m.applies.length).toBe(1);
    expect(m.applies[0].count).toBe(24);
    fireEvent.keyDown(m.q('[data-testid="knurl-wizard"]'), { key: 'Escape' });
    expect(m.cancelled()).toBe(1);
    fireEvent.click(m.q('[data-testid="knurl-cancel"]'));
    expect(m.cancelled()).toBe(2);
  });
  it('Cosmetic is off for every pattern by default, and ticking it shows the note that mass and exports ignore it', () => {
    const m = mount(withTarget());
    const box = () => m.r.container.querySelector('[data-path="cosmetic"] input') as HTMLInputElement;
    const pat = (v: string) => fireEvent.change(m.r.container.querySelector('[data-path="pattern"] select') as HTMLSelectElement, { target: { value: v } });
    expect(box().checked).toBe(false);
    expect(m.q('[data-testid="knurl-mode-note"]').textContent).toMatch(/cut into the solid/);
    pat('diamond');
    expect(box().checked).toBe(false);
    expect(m.drafts.at(-1)).toMatchObject({ pattern: 'diamond', cosmetic: false, method: 'faceted' });
    pat('pyramid');
    expect(box().checked).toBe(false);
    fireEvent.click(box());
    expect(m.drafts.at(-1)).toMatchObject({ cosmetic: true });
    expect(m.q('[data-testid="knurl-mode-note"]').textContent).toMatch(/mass and exports ignore it/);
    expect(m.r.container.textContent).not.toMatch(/take several seconds/);   // no slow-preview warning for a cosmetic knurl
  });
  it('a choice of the user is kept when the pattern changes; a dense diamond is previewed and applied as cosmetic', () => {
    const m = mount(withTarget());
    const box = () => m.r.container.querySelector('[data-path="cosmetic"] input') as HTMLInputElement;
    fireEvent.click(box());   // on, for a straight knurl
    expect(m.drafts.at(-1)?.cosmetic).toBe(true);
    fireEvent.change(m.r.container.querySelector('[data-path="pattern"] select') as HTMLSelectElement, { target: { value: 'straight' } });
    expect(box().checked).toBe(true);
    fireEvent.change(m.r.container.querySelector('[data-path="pattern"] select') as HTMLSelectElement, { target: { value: 'diamond' } });
    m.set('count', '120'); m.set('depth', '0.2'); m.set('helixAngle', '45');
    expect(m.q('[data-issue]')).toBeNull();   // the real cut would refuse this
    expect(m.drafts.at(-1)).toMatchObject({ count: 120, cosmetic: true });
    fireEvent.click(m.q('[data-testid="knurl-apply"]'));
    expect(m.applies.at(-1)).toMatchObject({ pattern: 'diamond', count: 120, cosmetic: true });
    fireEvent.change(m.r.container.querySelector('[data-path="method"] select') as HTMLSelectElement, { target: { value: 'boolean' } });
    fireEvent.click(box());   // off again with the boolean build: the cut refuses this density and says so
    expect(m.q('[data-issue="kernel"]')).not.toBeNull();
  });
  it('with no cylinder it says why and cannot apply', () => {
    const m = mount({ ...DEFAULT_KNURL, target: null }, { reason: 'oblique' });
    expect(m.drafts.length).toBe(0);
    expect(m.q('[data-testid="knurl-reason"]').textContent).toMatch(/tilted/);
    expect((m.q('[data-testid="knurl-apply"]') as HTMLButtonElement).disabled).toBe(true);
  });
  it('shows the live preview failure', () => {
    const m = mount(withTarget(), { hint: 'the kernel said no' });
    expect(m.q('[data-testid="knurl-hint"]').textContent).toBe('the kernel said no');
  });
});
