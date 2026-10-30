import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { KnurlWizard } from './KnurlWizard';
import { DEFAULT_KNURL, type KnurlParams } from './knurl';
import { readFileSync } from 'node:fs';
import './i18n';

afterEach(() => cleanup());

const withTarget = (o: Partial<KnurlParams> = {}): KnurlParams => ({ ...DEFAULT_KNURL, count: 24, depth: 0.6, target: { axis: 'z', center: [0, 0], radius: 10, from: 0, to: 12 }, ...o });
function mount(params: KnurlParams, o: { face?: string | null; edges?: unknown[]; reason?: string; hint?: string; edit?: boolean; refusal?: string | null; scriptNote?: boolean } = {}) {
  const drafts: KnurlParams[] = [], applies: KnurlParams[] = [];
  let cancelled = 0;
  const ui = (face: string | null | undefined) => <KnurlWizard params={params} face={face} edges={o.edges as never} reason={o.reason} hint={o.hint} edit={o.edit} refusal={o.refusal} scriptNote={o.scriptNote} onDraft={(d) => drafts.push(d)} onApply={(d) => applies.push(d)} onCancel={() => { cancelled++; }} />;
  const r = render(ui(o.face));
  const q = (sel: string) => r.container.querySelector(sel) as HTMLElement;
  const input = (path: string) => r.container.querySelector(`[data-path="${path}"] input`) as HTMLInputElement;
  const set = (path: string, v: string) => fireEvent.change(input(path), { target: { value: v } });
  const pick = (face: string | null) => r.rerender(ui(face));
  return { r, pick, drafts, applies, cancelled: () => cancelled, q, input, set };
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
  it('grooves that overlap block a real cut, say why and are not previewed', () => {
    const m = mount(withTarget({ cosmetic: false }));
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
  it('Cosmetic (instant) is on for every pattern by default; unticking it makes a real cut and says so', () => {
    const m = mount(withTarget());
    const box = () => m.r.container.querySelector('[data-path="cosmetic"] input') as HTMLInputElement;
    const pat = (v: string) => fireEvent.change(m.r.container.querySelector('[data-path="pattern"] select') as HTMLSelectElement, { target: { value: v } });
    expect(DEFAULT_KNURL.cosmetic).toBe(true);
    expect(box().checked).toBe(true);
    expect(m.drafts.at(-1)).toMatchObject({ cosmetic: true });
    expect(m.q('[data-testid="knurl-mode-note"]').textContent).toMatch(/Instant, display only.*Untick Cosmetic to make a real cut that changes the solid/);
    pat('diamond');
    expect(box().checked).toBe(true);
    expect(m.drafts.at(-1)).toMatchObject({ pattern: 'diamond', cosmetic: true, method: 'faceted' });
    pat('pyramid');
    expect(box().checked).toBe(true);
    expect(m.r.container.textContent).not.toMatch(/take several seconds/);   // no slow-preview warning for a cosmetic knurl
    fireEvent.click(box());
    expect(m.drafts.at(-1)).toMatchObject({ cosmetic: false });
    expect(m.q('[data-testid="knurl-mode-note"]').textContent).toMatch(/real cut|take several seconds/);
    fireEvent.click(m.q('[data-testid="knurl-apply"]'));
    expect(m.applies.at(-1)).toMatchObject({ pattern: 'pyramid', cosmetic: false });
  });
  it('straight knurl: unticking Cosmetic shows the note that the cut is in mass and exports', () => {
    const m = mount(withTarget());
    fireEvent.click(m.r.container.querySelector('[data-path="cosmetic"] input') as HTMLInputElement);
    expect(m.q('[data-testid="knurl-mode-note"]').textContent).toMatch(/real cut.*mass and exports include them/);
  });
  it('the Cosmetic checkbox is a compact checkbox row, not a control-width block', () => {
    const m = mount(withTarget());
    const row = m.q('[data-path="cosmetic"]');
    const box = row.querySelector('input') as HTMLInputElement;
    expect(row.tagName).toBe('LABEL');
    expect(row.classList.contains('fedit-fld') && row.classList.contains('bool')).toBe(true);   // the shared checkbox row (as Thin wall / Flip direction)
    expect(box.type).toBe('checkbox');
    expect(row.querySelectorAll('input')).toHaveLength(1);
    expect(box.nextElementSibling?.textContent).toContain('Cosmetic (instant)');
  });
  it('the stylesheet sizes every checkbox in a field row to its box, so the focus ring cannot span the control column', () => {
    const css = readFileSync(`${process.cwd()}/apps/cad/src/app.css`, 'utf8');
    const rule = /\.fedit-fld input\[type="checkbox"\]\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/width:\s*auto/);
    expect(rule![1]).toMatch(/justify-self:\s*start/);
  });
  it('a choice of the user is kept when the pattern changes; a dense diamond is previewed and applied as cosmetic', () => {
    const m = mount(withTarget());
    const box = () => m.r.container.querySelector('[data-path="cosmetic"] input') as HTMLInputElement;
    const pat = (v: string) => fireEvent.change(m.r.container.querySelector('[data-path="pattern"] select') as HTMLSelectElement, { target: { value: v } });
    fireEvent.click(box()); fireEvent.click(box());   // off, then on again: now the user's own choice
    expect(m.drafts.at(-1)?.cosmetic).toBe(true);
    pat('straight');
    expect(box().checked).toBe(true);
    pat('diamond');
    m.set('count', '120'); m.set('depth', '0.2'); m.set('helixAngle', '45');
    expect(m.q('[data-issue]')).toBeNull();   // the real cut would refuse this
    expect(m.drafts.at(-1)).toMatchObject({ count: 120, cosmetic: true });
    fireEvent.click(m.q('[data-testid="knurl-apply"]'));
    expect(m.applies.at(-1)).toMatchObject({ pattern: 'diamond', count: 120, cosmetic: true });
    fireEvent.change(m.r.container.querySelector('[data-path="method"] select') as HTMLSelectElement, { target: { value: 'boolean' } });
    fireEvent.click(box());   // off with the boolean build: the cut refuses this density and says so
    expect(m.q('[data-issue="kernel"]')).not.toBeNull();
  });
  it('a user who unticks Cosmetic keeps the real cut when the pattern changes', () => {
    const m = mount(withTarget());
    const box = () => m.r.container.querySelector('[data-path="cosmetic"] input') as HTMLInputElement;
    fireEvent.click(box());
    fireEvent.change(m.r.container.querySelector('[data-path="pattern"] select') as HTMLSelectElement, { target: { value: 'diamond' } });
    expect(box().checked).toBe(false);
    expect(m.drafts.at(-1)).toMatchObject({ pattern: 'diamond', cosmetic: false });
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

describe('KnurlWizard editing an existing knurl', () => {
  it('opens on the knurl\'s own values, says it is an edit and applies the changed record', () => {
    const m = mount(withTarget({ pattern: 'diamond', count: 18, depth: 0.45, helixAngle: 35, cosmetic: false }), { edit: true });
    expect(m.q('.fedit-title').textContent).toBe('Edit knurl');
    expect(m.input('count').value).toBe('18');
    expect(m.input('depth').value).toBe('0.45');
    expect(m.input('helixAngle').value).toBe('35');
    expect(m.q('[data-testid="knurl-apply"]').textContent).toBe('Update');
    m.set('count', '20');
    fireEvent.click(m.q('[data-testid="knurl-apply"]'));
    expect(m.applies).toHaveLength(1);
    expect(m.applies[0]).toMatchObject({ pattern: 'diamond', count: 20, depth: 0.45, helixAngle: 35, cosmetic: false });
  });
  it('Cancel and Escape change nothing: no apply, only onCancel', () => {
    const m = mount(withTarget(), { edit: true });
    m.set('count', '30');
    fireEvent.click(m.q('[data-testid="knurl-cancel"]'));
    fireEvent.keyDown(m.q('[data-testid="knurl-wizard"]'), { key: 'Escape' });
    expect(m.cancelled()).toBe(2);
    expect(m.applies).toHaveLength(0);
  });
  it('the cut/cosmetic choice is not offered, and a cosmetic knurl stays cosmetic when its pattern changes', () => {
    const m = mount(withTarget({ cosmetic: true }), { edit: true });
    expect(m.q('[data-path="cosmetic"]')).toBeNull();
    fireEvent.change(m.r.container.querySelector('[data-path="pattern"] select') as HTMLSelectElement, { target: { value: 'diamond' } });
    expect(m.drafts.at(-1)).toMatchObject({ pattern: 'diamond', cosmetic: true });
    fireEvent.click(m.q('[data-testid="knurl-apply"]'));
    expect(m.applies.at(-1)).toMatchObject({ cosmetic: true });
  });
  it('a count change drops a ring pitch kept from the old knurl', () => {
    const m = mount(withTarget({ pattern: 'pyramid', ringPitch: 4 }), { edit: true });
    m.set('count', '30');
    expect(m.drafts.at(-1)?.ringPitch).toBeUndefined();
  });
  it('a refusal (later features use this knurl) is shown, blocks Update and Enter, and nothing is previewed', () => {
    const m = mount(withTarget(), { edit: true, refusal: 'F6 uses this knurl' });
    expect(m.drafts).toHaveLength(0);
    expect(m.q('[data-testid="knurl-refusal"]').textContent).toBe('F6 uses this knurl');
    expect((m.q('[data-testid="knurl-apply"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(m.q('[data-testid="knurl-wizard"]'), { key: 'Enter' });
    expect(m.applies).toHaveLength(0);
  });
  it('a script-built part gets a one-line note; a new knurl does not', () => {
    expect(mount(withTarget(), { edit: true, scriptNote: true }).q('[data-testid="knurl-script-note"]')).not.toBeNull();
    cleanup();
    expect(mount(withTarget(), { edit: true }).q('[data-testid="knurl-script-note"]')).toBeNull();
    cleanup();
    expect(mount(withTarget()).q('.fedit-title').textContent).toBe('Knurl');
  });

  describe('picking the face while the wizard is open', () => {
    const ring = (r: number, h: number, n = 48) => Array.from({ length: n + 1 }, (_, i) => { const a = (2 * Math.PI * i) / n; return [r * Math.cos(a), r * Math.sin(a), h]; });
    const edges = [
      { faces: ['F2.S.c1', 'F2.S.b'], pts: ring(10, 0) },
      { faces: ['F2.S.c1', 'F2.S.t'], pts: ring(10, 12) },
      { faces: ['F3.S.flat', 'F3.S.side'], pts: [[0, 0, 5], [10, 0, 5], [10, 10, 5], [0, 10, 5], [0, 0, 5]] },
    ];
    const empty = { ...DEFAULT_KNURL, target: null };
    const apply = (m: ReturnType<typeof mount>) => m.q('[data-testid="knurl-apply"]') as HTMLButtonElement;

    it('with nothing selected it shows a hint (not an error) and a disabled Knurl button; picking a round face fills the target and enables it', () => {
      const m = mount(empty, { face: null, edges });
      expect(m.q('[data-testid="knurl-pick"]').textContent).toBe('Click a round face of the part');
      expect(m.q('[data-testid="knurl-reason"]')).toBeNull();
      expect(apply(m).disabled).toBe(true);
      expect(m.drafts.length).toBe(0);
      m.pick('F2.S.c1');
      expect(m.q('[data-testid="knurl-target"]').textContent).toMatch(/radius 10 mm, axis Z, from 0 to 12 mm/);
      expect(m.q('[data-testid="knurl-pick"]')).toBeNull();
      expect(apply(m).disabled).toBe(false);
      expect(m.drafts.at(-1)?.target).toMatchObject({ axis: 'z', radius: 10, from: 0, to: 12 });
      fireEvent.click(apply(m));
      expect(m.applies[0].target).toMatchObject({ radius: 10 });
    });
    it('a flat face is refused with the reason and the wizard keeps waiting; a round face afterwards is taken', () => {
      const m = mount(empty, { face: null, edges });
      m.pick('F3.S.flat');
      expect(m.q('[data-testid="knurl-reason"]').textContent).toMatch(/not round/);
      expect(apply(m).disabled).toBe(true);
      expect(m.drafts.length).toBe(0);
      m.pick('F2.S.c1');
      expect(m.q('[data-testid="knurl-reason"]')).toBeNull();
      expect(apply(m).disabled).toBe(false);
    });
    it('Escape cancels while waiting, even when the focus is not in the wizard', () => {
      const m = mount(empty, { face: null, edges });
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(m.cancelled()).toBe(1);
    });
    it('opened with a valid selection nothing changes: the target is set, one preview, no hint, and a later pick is ignored', () => {
      const m = mount(withTarget(), { face: 'F2.S.c1', edges });
      expect(m.drafts.length).toBe(1);
      expect(m.q('[data-testid="knurl-pick"]')).toBeNull();
      expect(apply(m).disabled).toBe(false);
      m.pick('F3.S.flat');
      expect(m.q('[data-testid="knurl-reason"]')).toBeNull();
      expect(m.drafts.length).toBe(1);
      expect(m.q('[data-testid="knurl-target"]').textContent).toMatch(/radius 10 mm/);
    });
  });
});
