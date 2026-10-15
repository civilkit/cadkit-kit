import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { HoleEditor } from './HoleEditor';
import type { HoleThread } from './holeThread';
import type { ThreadRow, ThreadStd } from './threadData';
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
  const num = (path: string) => q(path)!.querySelector("input") as HTMLInputElement;
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

const trow = (size: string, major: number, tapDrill: number, pitch: number, standard = 'metric'): ThreadRow => ({
  size, standard, major, pitch, minorInternal: major - 1.0825 * pitch, minorExternal: major - 1.2269 * pitch, tapDrill, classInternal: standard === 'UNC' ? '2B' : '6H', classExternal: standard === 'UNC' ? '2A' : '6g',
});
const TABLE: Record<string, ThreadRow[]> = {
  metric: [trow('M5', 5, 4.2, 0.8), trow('M6', 6, 5, 1), trow('M8', 8, 6.8, 1.25), trow('M10', 10, 8.5, 1.5)],
  UNC: [trow('1/4-20', 6.35, 5.105, 1.27, 'UNC'), trow('5/16-18', 7.94, 6.5, 1.411, 'UNC')],
};
const STDS: ThreadStd[] = [{ id: 'metric', description: 'ISO metric coarse', count: 4 }, { id: 'UNC', description: 'UNC', count: 2 }];
const API = { loadStandards: async () => STDS, loadSizes: async (s: string) => TABLE[s] ?? [] };

describe('HoleEditor: Threaded', () => {
  type Ev = { hole: Wire; thread: HoleThread | null | undefined };
  async function mountT(feature: Wire = HOLE, extra: Partial<Parameters<typeof HoleEditor>[0]> = {}) {
    const drafts: Ev[] = [];
    const confirms: Ev[] = [];
    const r = render(<HoleEditor feature={feature} onDraft={(h, t) => drafts.push({ hole: h, thread: t })} onConfirm={(h, t) => confirms.push({ hole: h, thread: t })} onCancel={() => {}} threads={API} {...extra} />);
    const q = (path: string) => r.container.querySelector(`[data-path="${path}"]`) as HTMLElement | null;
    const box = () => q('threaded')!.querySelector('input') as HTMLInputElement;
    return { ...r, drafts, confirms, q, box, last: () => drafts.at(-1)!, dia: () => r.container.querySelector('[data-testid="hole-diameter"]')?.textContent };
  }

  it('has the Threaded box at the top of Size, unchecked, and no thread section; without the thread tables there is none', async () => {
    const m = await mountT();
    expect([...m.container.querySelectorAll('.fedit-sec-head')].map((h) => h.textContent)).toEqual(['Type', 'Size', 'End', 'Options']);
    expect(m.box().checked).toBe(false);
    expect(m.q('standard')).toBeNull();
    cleanup();
    const bare = render(<HoleEditor feature={HOLE} onDraft={() => {}} onConfirm={() => {}} onCancel={() => {}} />);
    expect(bare.container.querySelector('[data-section="thread"]')).toBeNull();
  });

  it('ticking Threaded drills the hole to the tap drill of its own size, starts a metric thread of that size, and shows the controls', async () => {
    const m = await mountT({ ...HOLE, size: 'M8', fit: 'normal' });
    expect(m.dia()).toContain('9');
    fireEvent.click(m.box());
    await waitFor(() => expect(m.drafts.length).toBe(1));
    expect(m.last().hole).toMatchObject({ size: 'M8', fit: 'tap' });   // no `diameter` to remove on this hole
    expect(m.last().thread).toEqual({ standard: 'metric', size: 'M8', class: '6H', length: 'full', hand: 'right', modeled: false });
    expect(m.dia()).toBeUndefined();   // the hole diameter row is gone: the readout card carries the tap drill
    expect(m.q('size')).not.toBeNull();   // the thread's Size field; the hole's own size and fit selects are gone
    expect(m.q('fit')).toBeNull();
    expect([...m.container.querySelectorAll('.fedit-sec-head')].map((h) => h.textContent)).toEqual(['Type', 'Size', 'Thread options', 'End', 'Options']);
    for (const p of ['standard', 'class', 'lengthMode', 'hand', 'modeled']) expect(m.q(p), p).not.toBeNull();
    expect(m.q('length')).toBeNull();   // the number only shows for Custom
    await waitFor(() => expect(m.container.querySelector('[data-testid="thread-readout"] [data-k="tapDrill"]')).not.toBeNull());
    expect(m.container.querySelector('[data-testid="thread-readout"] [data-k="tapDrill"]')!.textContent).toContain('6.8');
  });

  it('layout: Size holds the picker (toggle first, readout card after the size), options hold length / hand / model with the cost as a second line; collapsing is remembered', async () => {
    try { localStorage.clear(); } catch { /* none */ }
    const m = await mountT({ ...HOLE, size: 'M8' });
    fireEvent.click(m.box());
    await waitFor(() => expect(m.container.querySelector('[data-testid="thread-card"]')).not.toBeNull());
    const size = m.container.querySelector('[data-section="size"]')!;
    const order = [...size.querySelectorAll('[data-path], [data-testid="thread-chips"], [data-testid="thread-card"]')].map((e) => e.getAttribute('data-path') ?? e.getAttribute('data-testid'));
    expect(order).toEqual(['threaded', 'standard', 'thread-chips', 'size', 'class', 'thread-card']);
    expect(size.querySelectorAll('[data-testid="thread-readout"] dt')).toHaveLength(3);
    const opts = m.container.querySelector('[data-section="thread"]')!;
    expect(opts.querySelector('[data-path="modeled"] .fedit-sub')!.textContent).toContain('slower');
    fireEvent.click(m.q('lengthMode')!.querySelector('[data-value="custom"]')!);
    expect(opts.querySelector('[data-path="lengthMode"] [data-path="length"] input')).not.toBeNull();   // the number is inside the control column
    fireEvent.click(opts.querySelector('.fedit-sec-head')!);
    expect(opts.querySelector('.fedit-sec-sum')!.textContent).toContain('mm');
    expect(JSON.parse(localStorage.getItem('kit.editor.collapsed')!)).toEqual({ thread: true });
    cleanup();
    const again = await mountT({ ...HOLE, size: 'M8' }, { linked: [{ type: 'thread', id: 'F5', face: 'F4.S.h1', standard: 'metric', size: 'M8', length: 'full', hand: 'right', modeled: false }] });
    expect(again.container.querySelector('[data-section="thread"]')!.classList.contains('closed')).toBe(true);
    try { localStorage.clear(); } catch { /* none */ }
  });

  it('size, standard, class, length, hand and model all go into the thread of the same draft; an inch size makes a plain diameter', async () => {
    const m = await mountT({ ...HOLE, size: 'M8' });
    fireEvent.click(m.box());
    await waitFor(() => expect(m.drafts.length).toBe(1));
    await waitFor(() => expect(m.container.querySelector('[data-testid="thread-chips"] [data-size="M10"]')).not.toBeNull());
    fireEvent.click(m.container.querySelector('[data-testid="thread-chips"] [data-size="M10"]')!);
    await waitFor(() => expect(m.last().thread).toMatchObject({ size: 'M10' }));
    expect(m.last().hole).toMatchObject({ size: 'M10', fit: 'tap' });
    await waitFor(() => expect(m.container.querySelector('[data-testid="thread-readout"] [data-k="tapDrill"]')!.textContent).toContain('8.5'));
    fireEvent.click(m.q('hand')!.querySelector('[data-value="left"]')!);
    expect(m.last().thread).toMatchObject({ hand: 'left' });
    fireEvent.click(m.q('lengthMode')!.querySelector('[data-value="custom"]')!);
    expect(typeof m.last().thread!.length).toBe('number');
    fireEvent.change(m.q('length')!.querySelector('input')!, { target: { value: '12' } });
    expect(m.last().thread).toMatchObject({ length: 12 });
    fireEvent.click(m.q('modeled')!.querySelector('input')!);
    expect(m.last().thread).toMatchObject({ modeled: true });
    expect(m.container.querySelector('[data-testid="thread-cost"]')).not.toBeNull();
    fireEvent.change(m.q('standard')!.querySelector('select')!, { target: { value: 'UNC' } });
    await waitFor(() => expect(m.last().thread).toMatchObject({ standard: 'UNC', size: '5/16-18', class: '2B' }));   // nearest tap drill to the 8.5 mm hole
    expect(m.last().hole).toMatchObject({ diameter: 6.5, size: null, fit: null });
    expect(m.drafts.at(-1)!.hole).toMatchObject({ diameter: 6.5 });
  });

  it('a blind hole caps the custom length at its depth, also when the depth shrinks afterwards', async () => {
    const m = await mountT({ ...HOLE, size: 'M8', end: 'blind', depth: 14 });
    fireEvent.click(m.box());
    await waitFor(() => expect(m.drafts.length).toBe(1));
    expect(m.container.querySelector('[data-testid="hole-thread-cap"]')!.textContent).toContain('14');
    fireEvent.click(m.q('lengthMode')!.querySelector('[data-value="custom"]')!);
    fireEvent.change(m.q('length')!.querySelector('input')!, { target: { value: '40' } });
    expect(m.last().thread).toMatchObject({ length: 14 });
    fireEvent.change(m.q('depth')!.querySelector('input')!, { target: { value: '9' } });
    expect(m.last().thread).toMatchObject({ length: 9 });
    expect(m.last().hole).toMatchObject({ depth: 9 });
  });

  it('opens checked for a hole that already has a thread; clearing it asks for none and gives the hole its own size back', async () => {
    const linked = [{ type: 'thread', id: 'F5', face: 'F4.S.h1', standard: 'metric', size: 'M8', class: '6H', length: 7, hand: 'left', modeled: false }];
    const m = await mountT({ ...HOLE, size: 'M8', fit: 'tap' }, { linked });
    expect(m.box().checked).toBe(true);
    await waitFor(() => expect(m.container.querySelector('[data-testid="thread-readout"] dd')).not.toBeNull());
    expect(m.q('hand')!.querySelector('[aria-checked="true"]')!.getAttribute('data-value')).toBe('left');
    expect((m.q('length')!.querySelector('input') as HTMLInputElement).value).toBe('7');
    fireEvent.click(m.box());
    expect(m.last().thread).toBeNull();
    expect(m.box().checked).toBe(false);
    expect(m.q('fit')).not.toBeNull();   // the hole's own Size and Fit are back
  });

  it('ticking then clearing puts the hole back as it was; confirming sends the thread with the hole', async () => {
    const m = await mountT({ ...HOLE, size: 'M6', fit: 'normal' });
    fireEvent.click(m.box());
    await waitFor(() => expect(m.drafts.length).toBe(1));
    fireEvent.click(m.box());
    expect(m.last().thread).toBeNull();
    expect(m.last().hole).toMatchObject({ size: 'M6', fit: 'normal' });
    expect(m.dia()).toContain('6.6');
    fireEvent.click(m.box());
    await waitFor(() => expect(m.drafts.length).toBe(3));
    fireEvent.click(m.container.querySelector('.fedit-confirm')!);
    expect(m.confirms).toHaveLength(1);
    expect(m.confirms[0].thread).toMatchObject({ size: 'M6' });
  });

  it('a counterbore hole cannot be threaded: the box is disabled with a note; changing the type drops a thread', async () => {
    const cb = await mountT({ ...HOLE, kind: 'cbore', cboreDiameter: 11, cboreDepth: 6.4 });
    expect(cb.box().disabled).toBe(true);
    expect(cb.container.querySelector('[data-testid="hole-thread-simple"]')).not.toBeNull();
    cleanup();
    const m = await mountT({ ...HOLE, size: 'M6', fit: 'tap' });
    fireEvent.click(m.box());
    await waitFor(() => expect(m.drafts.length).toBe(1));
    fireEvent.change(m.q('kind')!.querySelector('select')!, { target: { value: 'cbore' } });
    expect(m.last().thread).toBeNull();
  });

  it('shows the kernel\'s "not built" note for a modeled thread the kernel kept cosmetic', async () => {
    const linked = [{ type: 'thread', id: 'F5', face: 'F4.S.h1', standard: 'metric', size: 'M8', length: 'full', hand: 'right', modeled: true }];
    const m = await mountT({ ...HOLE, size: 'M8', fit: 'tap' }, { linked, threads: { ...API, entryModeled: false, warning: { code: 'threadModelFallback', hint: 'bore too small' } } });
    expect(m.container.querySelector('[data-testid="thread-notbuilt"]')!.textContent).toContain('bore too small');
  });
});
