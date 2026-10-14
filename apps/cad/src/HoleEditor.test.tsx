import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { HoleEditor } from './HoleEditor';
import './i18n';

afterEach(cleanup);

const HOLE = { type: 'hole', id: 'F4', sketch: 'F3', kind: 'simple', size: 'M6', fit: 'normal', end: 'through' };
type Wire = Record<string, unknown>;
function mount(feature: Wire = HOLE, extra: Partial<Parameters<typeof HoleEditor>[0]> = {}) {
  const drafts: Wire[] = [];
  const confirms: Wire[] = [];
  const r = render(<HoleEditor feature={feature} onDraft={(d) => drafts.push(d)} onConfirm={(d) => confirms.push(d)} onCancel={() => {}} {...extra} />);
  const q = (path: string) => r.container.querySelector(`[data-path="${path}"]`) as HTMLElement | null;
  const sel = (path: string) => q(path)!.querySelector('select') as HTMLSelectElement;
  const num = (path: string) => q(path)!.querySelector('input[type="number"]') as HTMLInputElement;
  return { ...r, drafts, confirms, q, sel, num, dia: () => r.container.querySelector('[data-testid="hole-diameter"]')?.textContent };
}

describe('HoleEditor', () => {
  it('has Type, Size, End and Options sections and shows the resulting diameter as read-only text', () => {
    const m = mount();
    const heads = [...m.container.querySelectorAll('.fedit-sec-head')].map((h) => h.textContent);
    expect(heads).toEqual(['Type', 'Size', 'End', 'Options']);
    expect(m.sel('kind').value).toBe('simple');
    expect([...m.sel('kind').options].map((o) => o.textContent)).toEqual(['Simple', 'Counterbore', 'Countersink']);
    expect(m.sel('size').options.length).toBe(13);   // M2..M24 and Custom diameter
    expect(m.sel('size').value).toBe('M6');
    expect([...m.sel('fit').options].map((o) => o.textContent)).toEqual(['Tap drill', 'Close', 'Normal', 'Loose']);
    expect(m.dia()).toContain('6.6');
    expect(m.container.querySelector('.hole-dia')!.tagName).toBe('SPAN');
    expect(m.q('depth')).toBeNull();                 // through: no depth
    expect(m.q('cboreDiameter')).toBeNull();
  });

  it('size and fit update the diameter and the draft', () => {
    const m = mount();
    fireEvent.change(m.sel('fit'), { target: { value: 'tap' } });
    expect(m.dia()).toContain('5');
    fireEvent.change(m.sel('size'), { target: { value: 'M10' } });
    expect(m.dia()).toContain('8.5');
    expect(m.drafts.at(-1)).toEqual({ size: 'M10', fit: 'tap' });
  });

  it('custom diameter shows the diameter field and hides fit; choosing a size again removes the diameter', () => {
    const m = mount();
    fireEvent.change(m.sel('size'), { target: { value: 'custom' } });
    expect(m.drafts.at(-1)).toMatchObject({ size: null, fit: null, diameter: 6.6 });
    expect(m.num('diameter').value).toBe('6.6');
    expect(m.q('fit')).toBeNull();
    fireEvent.change(m.num('diameter'), { target: { value: '4.2' } });
    expect(m.drafts.at(-1)).toMatchObject({ diameter: 4.2 });
    fireEvent.change(m.sel('size'), { target: { value: 'M4' } });
    expect(m.drafts.at(-1)).toMatchObject({ size: 'M4', diameter: null });
    expect(m.q('diameter')).toBeNull();
    expect(m.dia()).toContain('4.5');
  });

  it('opens an old bare-diameter hole as Custom diameter', () => {
    const m = mount({ type: 'hole', id: 'F4', sketch: 'F3', kind: 'simple', diameter: 3.2, end: 'through' });
    expect(m.sel('size').value).toBe('custom');
    expect(m.num('diameter').value).toBe('3.2');
  });

  it('a bare-diameter hole gets its diameter removed (null) once a size is chosen', () => {
    const m = mount({ type: 'hole', id: 'F4', sketch: 'F3', kind: 'simple', diameter: 3.2, end: 'through' });
    fireEvent.change(m.sel('size'), { target: { value: 'M3' } });
    expect(m.drafts.at(-1)).toEqual({ size: 'M3', diameter: null, fit: 'normal' });
  });

  it('counterbore and countersink fields appear only for those types, with the ISO defaults', () => {
    const m = mount();
    fireEvent.change(m.sel('kind'), { target: { value: 'cbore' } });
    expect(m.num('cboreDiameter').value).toBe('11');
    expect(m.num('cboreDepth').value).toBe('6.4');
    expect(m.q('cskDiameter')).toBeNull();
    expect([...m.sel('fit').options].map((o) => o.value)).toEqual(['close', 'normal', 'loose']);   // tap is a plain hole fit
    expect(m.container.querySelector('[data-note="dims"]')).toBeNull();   // the kernel honours the sizes now: no warning note
    fireEvent.change(m.sel('kind'), { target: { value: 'csink' } });
    expect(m.num('cskDiameter').value).toBe('12.4');
    expect(m.num('cskAngle').value).toBe('90');
    expect(m.q('cboreDiameter')).toBeNull();
    expect(m.drafts.at(-1)).toMatchObject({ kind: 'csink', cskDiameter: 12.4, cskAngle: 90, cboreDiameter: null, cboreDepth: null });
    fireEvent.change(m.num('cskAngle'), { target: { value: '82' } });
    expect(m.drafts.at(-1)).toMatchObject({ cskAngle: 82 });
    fireEvent.change(m.sel('kind'), { target: { value: 'simple' } });
    expect(m.q('cskDiameter')).toBeNull();
    expect(m.drafts.at(-1)).toMatchObject({ kind: 'simple', cskDiameter: null, cskAngle: null });
  });

  it('counterbore dimensions follow the size', () => {
    const m = mount({ ...HOLE, kind: 'cbore', cboreDiameter: 11, cboreDepth: 6.4 });
    fireEvent.change(m.sel('size'), { target: { value: 'M10' } });
    expect(m.num('cboreDiameter').value).toBe('18');
    expect(m.num('cboreDepth').value).toBe('10.6');
  });

  it('end condition: blind shows depth (with a default) and the drill tip with its angle', () => {
    const m = mount();
    expect(m.q('tip')).toBeNull();
    fireEvent.change(m.sel('end'), { target: { value: 'blind' } });
    expect(m.drafts.at(-1)).toMatchObject({ end: 'blind', depth: 13.2 });
    expect(m.num('depth').value).toBe('13.2');
    fireEvent.change(m.num('depth'), { target: { value: '8' } });
    const tip = m.q('tip')!;
    expect(tip.textContent).toContain('118');
    fireEvent.click(tip.querySelector('input')!);
    expect(m.drafts.at(-1)).toMatchObject({ end: 'blind', depth: 8, tip: true });
    fireEvent.change(m.sel('end'), { target: { value: 'upToNext' } });
    expect(m.q('depth')).toBeNull();
    expect(m.q('tip')).toBeNull();
  });

  it('confirm sends the draft and remembers type, size and fit; Escape cancels', () => {
    try { localStorage.clear(); } catch { /* none */ }
    let cancelled = 0;
    const m = mount(HOLE, { onCancel: () => { cancelled += 1; } });
    fireEvent.change(m.sel('size'), { target: { value: 'M8' } });
    fireEvent.change(m.sel('fit'), { target: { value: 'loose' } });
    fireEvent.click(m.container.querySelector('.fedit-confirm')!);
    expect(m.confirms).toEqual([{ size: 'M8', fit: 'loose' }]);
    expect(JSON.parse(localStorage.getItem('kit.hole.prefs')!)).toEqual({ kind: 'simple', size: 'M8', fit: 'loose' });
    fireEvent.keyDown(m.container.querySelector('.fedit')!, { key: 'Escape' });
    expect(cancelled).toBe(1);
  });

  describe('thread extension point', () => {
    it('draws no Thread section by default', () => {
      expect(mount().container.querySelector('[data-section="thread"]')).toBeNull();
    });
    it('hosts a threadSection element after Options', () => {
      const m = mount(HOLE, { threadSection: <div data-testid="t">thread controls</div> });
      const secs = [...m.container.querySelectorAll('.fedit-sec')].map((s) => s.getAttribute('data-section'));
      expect(secs).toEqual(['type', 'size', 'end', 'options', 'thread']);
      expect(m.container.querySelector('[data-slot="thread"] [data-testid="t"]')!.textContent).toBe('thread controls');
    });
    it('a threadSection function receives the hole with the draft applied', () => {
      const m = mount(HOLE, { threadSection: (h) => <span data-testid="t">{String(h.size)}</span> });
      expect(m.container.querySelector('[data-testid="t"]')!.textContent).toBe('M6');
      fireEvent.change(m.sel('size'), { target: { value: 'M12' } });
      expect(m.container.querySelector('[data-testid="t"]')!.textContent).toBe('M12');
    });
  });
});
