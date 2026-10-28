import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { ThreadEditor, type ThreadEditorProps } from './ThreadEditor';
import { loadThreadPrefs, newThread, type ThreadRow, type ThreadStd } from './threadData';
import './i18n';

afterEach(() => { cleanup(); try { localStorage.clear(); } catch { /* none */ } });

const row = (size: string, major: number, tapDrill: number, pitch: number, std = 'metric'): ThreadRow => ({
  size, standard: std, major, pitch, minorInternal: major - 1.0825 * pitch, minorExternal: major - 1.2269 * pitch, tapDrill, tapDrillName: undefined, classInternal: '6H', classExternal: '6g',
});
const TABLE: Record<string, ThreadRow[]> = {
  metric: [row('M4', 4, 3.3, 0.7), row('M5', 5, 4.2, 0.8), row('M6', 6, 5, 1), row('M8', 8, 6.8, 1.25), row('M10', 10, 8.5, 1.5)],
  UNC: [{ ...row('1/4-20', 6.35, 5.105, 1.27, 'UNC'), tapDrillName: '#7', classInternal: '2B', classExternal: '2A' }, { ...row('5/16-18', 7.94, 6.5, 1.411, 'UNC'), classInternal: '2B', classExternal: '2A' }],
};
const STDS: ThreadStd[] = [
  { id: 'metric', description: 'ISO metric coarse', count: 5 }, { id: 'metric-fine', description: 'f', count: 1 }, { id: 'UNC', description: 'UNC', count: 2 }, { id: 'UNF', description: 'UNF', count: 1 },
  { id: 'BSP', description: 'b', count: 1 }, { id: 'NPT', description: 'n', count: 1 }, { id: 'Tr', description: 't', count: 1 }, { id: 'Acme', description: 'a', count: 1 },
];
const THREAD = { type: 'thread', id: 'F5', face: 'F4.S.c1', standard: 'metric', size: 'M6', class: '6H', length: 'full', hand: 'right', modeled: false };
type Wire = Record<string, unknown>;

async function mount(feature: Wire = THREAD, extra: Partial<ThreadEditorProps> = {}) {
  const drafts: Wire[] = [];
  const confirms: Wire[] = [];
  let cancelled = 0;
  const props = { feature, onDraft: (d: Wire) => drafts.push(d), onConfirm: (d: Wire) => confirms.push(d), onCancel: () => { cancelled++; },
    loadStandards: async () => STDS, loadSizes: async (s: string) => TABLE[s] ?? [], ...extra };
  const r = render(<ThreadEditor {...props} />);
  const q = (path: string) => r.container.querySelector(`[data-path="${path}"]`) as HTMLElement | null;
  const sel = (path: string) => q(path)!.querySelector('select') as HTMLSelectElement;
  const combo = () => r.container.querySelector('input[role="combobox"]') as HTMLInputElement;
  const seg = (path: string, value: string) => q(path)!.querySelector(`[data-value="${value}"]`) as HTMLElement;
  await waitFor(() => expect(r.container.querySelector('[data-testid="thread-readout"] dd, .thread-hint[data-testid="thread-readout"]')).not.toBeNull());
  return { ...r, drafts, confirms, cancelled: () => cancelled, q, sel, combo, seg, rerender: (e: Partial<ThreadEditorProps>) => r.rerender(<ThreadEditor {...props} {...e} />) };
}
const text = (c: Element, id: string) => c.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;
const dd = (c: Element, k: string) => c.querySelector(`[data-testid="thread-readout"] [data-k="${k}"]`)?.textContent;

describe('ThreadEditor: form', () => {
  it('has Thread and Thread options sections, reachable by keyboard', async () => {
    const m = await mount();
    const heads = [...m.container.querySelectorAll('.fedit-sec-head')] as HTMLElement[];
    expect(heads.map((h) => h.textContent)).toEqual(['Thread', 'Thread options']);
    expect(heads.every((h) => h.tabIndex === 0 && h.getAttribute('role') === 'button')).toBe(true);
    fireEvent.keyDown(heads[1], { key: 'Enter' });
    expect(m.confirms).toHaveLength(0);           // Enter on a section head toggles it, it does not confirm
    expect(m.q('modeled')).toBeNull();
    expect(heads[1].textContent).toContain('Full');   // the collapsed header carries the summary (length, hand)
    try { localStorage.clear(); } catch { /* none */ }
  });

  it('Standard dropdown lists the eight standards with their names', async () => {
    const m = await mount();
    expect([...m.sel('standard').options].map((o) => o.textContent)).toEqual(['ISO metric coarse', 'ISO metric fine', 'UNC', 'UNF', 'BSP parallel (G)', 'NPT (tapered)', 'Trapezoidal (Tr)', 'Acme']);
    expect(m.sel('standard').value).toBe('metric');
  });

  it('the face is a chip: kind and diameter, the persistent name muted and in the tooltip', async () => {
    const shaft = await mount(THREAD, { faceDiameter: 10, internal: false });
    const chip = shaft.container.querySelector('[data-testid="thread-face"]') as HTMLElement;
    expect(chip.querySelector('span')!.textContent).toBe('Shaft, Ø 10 mm');
    expect(chip.title).toBe('F4.S.c1');
    expect(chip.querySelector('.thread-chip-name')!.textContent).toBe('F4.S.c1');
    cleanup();
    const hole = await mount(THREAD, { faceDiameter: 8.5, internal: true });
    expect(text(hole.container, 'thread-face')).toContain('Hole, Ø 8.5 mm');
  });
});

describe('ThreadEditor: size', () => {
  it('quick chips: the standard\'s short list, only sizes the table has, the current one marked, a click picks with the class', async () => {
    const m = await mount(THREAD, { internal: false });
    const chips = [...m.container.querySelectorAll('.thread-chipbtn')] as HTMLElement[];
    expect(chips.map((c) => c.textContent)).toEqual(['M4', 'M5', 'M6', 'M8', 'M10']);     // M3 and M12 are not in the test table
    expect(chips.find((c) => c.textContent === 'M6')!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chips.find((c) => c.textContent === 'M8')!);
    expect(m.drafts.at(-1)).toEqual({ size: 'M8', class: '6g' });
  });

  it('the last used size of the standard comes first', async () => {
    const a = await mount(THREAD, { internal: true });
    fireEvent.click(a.container.querySelector('.thread-chipbtn[data-size="M10"]')!);
    cleanup();
    const b = await mount(THREAD, { internal: true });
    expect([...b.container.querySelectorAll('.thread-chipbtn')].map((c) => c.textContent)[0]).toBe('M10');
  });

  it('the size field is a combobox: focus opens the listbox, nearest sizes first and marked, pitch next to each entry', async () => {
    const m = await mount(THREAD, { faceDiameter: 6.9, internal: true });
    const c = m.combo();
    expect(c.getAttribute('role')).toBe('combobox');
    expect(c.value).toBe('M6 × 1 coarse');
    fireEvent.focus(c);
    const list = m.container.querySelector('[role="listbox"]')!;
    expect(c.getAttribute('aria-expanded')).toBe('true');
    expect(c.getAttribute('aria-controls')).toBe(list.id);
    expect([...list.querySelectorAll('li[role="presentation"]')].map((x) => x.textContent)).toEqual(['Nearest to Ø 6.9 mm', 'Coarse pitch']);
    expect([...list.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(['M8 × 1.25 coarse', 'M10 × 1.5 coarse', 'M6 × 1 coarse', 'M5 × 0.8 coarse', 'M4 × 0.7 coarse']);
    expect(list.querySelector('[aria-selected="true"]')!.textContent).toBe('M6 × 1 coarse');
  });

  it('typing filters; arrows move, Enter picks without confirming the editor', async () => {
    const m = await mount(THREAD, { internal: true });
    const c = m.combo();
    fireEvent.focus(c);
    fireEvent.input(c, { target: { value: 'm1' } });
    expect([...m.container.querySelectorAll('[role="option"]')].map((o) => (o as HTMLElement).dataset.size)).toEqual(['M10']);
    fireEvent.input(c, { target: { value: '8' } });
    expect([...m.container.querySelectorAll('[role="option"]')].map((o) => (o as HTMLElement).dataset.size)).toEqual(['M8']);
    fireEvent.input(c, { target: { value: '' } });
    fireEvent.keyDown(c, { key: 'ArrowDown' });
    fireEvent.keyDown(c, { key: 'ArrowDown' });
    expect(c.getAttribute('aria-activedescendant')).toBe('thread-size-opt-2');
    fireEvent.keyDown(c, { key: 'Enter' });
    expect(m.confirms).toHaveLength(0);
    expect(m.drafts.at(-1)).toEqual({ size: 'M6', class: '6H' });
    expect(m.container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('Escape closes the list first; the next Escape cancels the editor', async () => {
    const m = await mount();
    const c = m.combo();
    fireEvent.focus(c);
    fireEvent.keyDown(c, { key: 'Escape' });
    expect(m.cancelled()).toBe(0);
    expect(m.container.querySelector('[role="listbox"]')).toBeNull();
    fireEvent.keyDown(c, { key: 'Escape' });
    expect(m.cancelled()).toBe(1);
  });

  it('clicking an option drafts the size with the class of the reading', async () => {
    const m = await mount(THREAD, { internal: false });
    fireEvent.focus(m.combo());
    fireEvent.mouseDown(m.container.querySelector('[role="option"][data-size="M8"]')!);
    expect(m.drafts.at(-1)).toEqual({ size: 'M8', class: '6g' });
  });

  it('changing the standard loads its sizes and picks the nearest to the face', async () => {
    const m = await mount(THREAD, { faceDiameter: 5.1, internal: true });
    fireEvent.change(m.sel('standard'), { target: { value: 'UNC' } });
    await waitFor(() => expect(m.drafts.some((d) => d.size === '1/4-20')).toBe(true));
    expect(m.drafts.at(-1)).toMatchObject({ standard: 'UNC', size: '1/4-20', class: '2B' });
    fireEvent.focus(m.combo());
    expect([...m.container.querySelectorAll('[role="option"]')].map((o) => (o as HTMLElement).dataset.size)).toContain('5/16-18');
  });
});

describe('ThreadEditor: fit and readout', () => {
  it('green when the face matches the size (shaft against major, hole against tap drill)', async () => {
    const m = await mount({ ...THREAD, size: 'M10' }, { faceDiameter: 10, internal: false });
    expect(text(m.container, 'thread-fit')).toBe('Fits: shaft Ø 10 matches M10 major diameter');
    cleanup();
    const h = await mount({ ...THREAD, size: 'M10' }, { faceDiameter: 8.5, internal: true });
    expect(text(h.container, 'thread-fit')).toBe('Fits: hole Ø 8.5 matches M10 tap drill');
  });

  it('amber with the kernel hint and a one-click Use M8', async () => {
    const warning = { code: 'threadDiameterMismatch', hint: 'hole is 6.8, M6 tap drill is 5: drill the hole to 5, or choose M8 (tap drill 6.8)', params: { nearest: 'M8' } };
    const m = await mount(THREAD, { warning, internal: true, faceDiameter: 6.8 });
    const w = m.container.querySelector('[data-testid="thread-fit"][data-warning="threadDiameterMismatch"]')!;
    expect(w.textContent).toContain('or choose M8');
    expect(w.className).toContain('warn');
    fireEvent.click(m.container.querySelector('[data-testid="thread-use"]')!);
    expect(m.drafts.at(-1)).toEqual({ size: 'M8', class: '6H' });
  });

  it('no Use button when the suggestion is the current size; other warnings are listed', async () => {
    const m = await mount({ ...THREAD, size: 'M8' }, { warning: { code: 'x', hint: 'a', all: [{ code: 'threadDiameterMismatch', hint: 'mismatch', params: { nearest: 'M8' } }, { code: 'other', hint: 'something else' }] } });
    expect(m.container.querySelector('[data-testid="thread-use"]')).toBeNull();
    expect(m.container.querySelector('.fedit-warn[data-warning="other"]')!.textContent).toBe('something else');
  });

  it('a shaft reads major, root (d3) and pitch; a hole tap drill, minor (D1) and pitch', async () => {
    const m = await mount(THREAD, { internal: false });
    const labels = () => [...m.container.querySelectorAll('[data-testid="thread-readout"] dt')].map((x) => x.textContent);
    expect(labels()).toEqual(['Major diameter', 'Root diameter (d3)', 'Pitch']);
    expect(dd(m.container, 'root')).toContain('4.773');
    cleanup();
    const h = await mount(THREAD, { internal: true });
    expect([...h.container.querySelectorAll('[data-testid="thread-readout"] dt')].map((x) => x.textContent)).toEqual(['Tap drill', 'Minor diameter (D1)', 'Pitch']);
    expect(dd(h.container, 'tapDrill')).toBe('5 mm');
    expect(dd(h.container, 'minor')).toContain('4.918');
    expect(dd(h.container, 'pitch')).toBe('1 mm');
  });
});

describe('ThreadEditor: class', () => {
  it('is a dropdown of the standard\'s classes with a note that it does not change the geometry', async () => {
    const m = await mount();
    expect([...m.sel('class').options].map((o) => o.value)).toEqual(['', '6H', '6g']);
    expect(m.q('class')!.getAttribute('title')).toContain('does not change the geometry');
    fireEvent.change(m.sel('class'), { target: { value: '6g' } });
    expect(m.drafts.at(-1)).toEqual({ class: '6g' });
    fireEvent.change(m.sel('class'), { target: { value: '' } });
    expect(m.drafts.at(-1)).toMatchObject({ class: null });
  });
});

describe('ThreadEditor: length, hand, start', () => {
  const num = (m: { q(p: string): HTMLElement | null }) => m.q('length')!.querySelector('input[type="number"]') as HTMLInputElement;
  it('Full | Custom: the number sits next to the control and shows only for Custom (Full shows the face length as text)', async () => {
    const m = await mount(THREAD, { extent: { length: 30, open: [true, false] } });
    expect(m.seg('lengthMode', 'full').getAttribute('aria-checked')).toBe('true');
    expect(m.q('length')).toBeNull();                          // no number box while Full
    expect(text(m.container, 'thread-fulllen')).toBe('30 mm');
    fireEvent.click(m.seg('lengthMode', 'custom'));
    expect(m.drafts.at(-1)).toEqual({ length: 8 });         // 8 pitches of M6
    await waitFor(() => expect(num(m)).not.toBeNull());
    expect(num(m).max).toBe('30');
    fireEvent.click(m.seg('lengthMode', 'full'));
    expect(m.drafts.at(-1)).toMatchObject({ length: 'full' });
  });

  it('a typed length is held to the face length and to one pitch', async () => {
    const m = await mount({ ...THREAD, length: 12 }, { extent: { length: 30, open: [true, false] } });
    fireEvent.change(num(m), { target: { value: '99' } });
    expect(m.drafts.at(-1)).toMatchObject({ length: 30 });
    fireEvent.change(num(m), { target: { value: '0.2' } });
    expect(m.drafts.at(-1)).toMatchObject({ length: 1 });
    fireEvent.change(num(m), { target: { value: '12.5' } });
    expect(m.drafts.at(-1)).toMatchObject({ length: 12.5 });
  });

  it('the length handle value from the part lands in the draft', async () => {
    const m = await mount(THREAD, { extent: { length: 30, open: [true, false] }, inject: null });
    m.rerender({ extent: { length: 30, open: [true, false] }, inject: { seq: 1, patch: { length: 17.5 } } });
    await waitFor(() => expect(m.drafts.at(-1)).toMatchObject({ length: 17.5 }));
  });

  it('Hand is a Right / Left segmented control with helix icons', async () => {
    const m = await mount();
    expect(m.seg('hand', 'right').getAttribute('aria-checked')).toBe('true');
    expect(m.seg('hand', 'left').querySelector('svg')!.getAttribute('data-icon')).toBe('helix-left');
    expect(m.seg('hand', 'right').querySelector('svg')!.getAttribute('data-icon')).toBe('helix-right');
    fireEvent.click(m.seg('hand', 'left'));
    expect(m.drafts.at(-1)).toMatchObject({ hand: 'left' });
    fireEvent.keyDown(m.seg('hand', 'left'), { key: 'ArrowLeft' });
    expect(m.drafts.at(-1)).toMatchObject({ hand: 'right' });
  });

  it('Start shows only when both ends are open or neither (or unknown), with arrow icons; Open end removes the field', async () => {
    const one = await mount(THREAD, { extent: { length: 30, open: [true, false] } });
    expect(one.q('start')).toBeNull();
    cleanup();
    const both = await mount({ ...THREAD, start: 'top' }, { extent: { length: 30, open: [true, true] } });
    expect(both.q('start')).not.toBeNull();
    expect(both.seg('start', 'top').querySelector('svg')!.getAttribute('data-icon')).toBe('arrow-up');
    expect(both.seg('start', 'bottom').querySelector('svg')!.getAttribute('data-icon')).toBe('arrow-down');
    expect([...both.q('start')!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Open end', 'Top', 'Bottom']);
    fireEvent.click(both.seg('start', 'open'));
    expect(both.drafts.at(-1)).toMatchObject({ start: null });
    cleanup();
    const unknown = await mount(THREAD);
    expect(unknown.q('start')).not.toBeNull();
    cleanup();
    const forced = await mount({ ...THREAD, start: 'bottom' }, { extent: { length: 30, open: [true, false] } });
    expect(forced.q('start')).not.toBeNull();       // an explicit start stays visible so it can be reset
  });
});

describe('ThreadEditor: print clearance', () => {
  it('shows only for a modeled thread; Wider and Narrower write the signed millimetres, None removes the field', async () => {
    const off = await mount();
    expect(off.q('clearance')).toBeNull();
    cleanup();
    const m = await mount({ ...THREAD, modeled: true });
    expect(m.q('clearanceValue')).toBeNull();
    fireEvent.click(m.seg('clearance', 'wider'));
    expect(m.drafts.at(-1)).toMatchObject({ clearance: 0.2 });
    fireEvent.change(m.q('clearanceValue')!.querySelector('input')!, { target: { value: '0.35' } });
    expect(m.drafts.at(-1)).toMatchObject({ clearance: 0.35 });
    fireEvent.click(m.seg('clearance', 'narrower'));
    expect(m.drafts.at(-1)).toMatchObject({ clearance: -0.35 });
    fireEvent.click(m.seg('clearance', 'none'));
    expect(m.drafts.at(-1)!.clearance).toBeNull();   // null in a draft removes the field
  });
  it('an existing feature shows its direction and value', async () => {
    const m = await mount({ ...THREAD, modeled: true, clearance: -0.25 });
    expect(m.seg('clearance', 'narrower').getAttribute('aria-checked')).toBe('true');
    expect((m.q('clearanceValue')!.querySelector('input') as HTMLInputElement).value).toBe('0.25');
  });
});

describe('ThreadEditor: modeled option', () => {
  it('the checkbox shows a cost note, from the last measured rebuild when there is one', async () => {
    const m = await mount();
    expect(m.container.querySelector('[data-testid="thread-cost"]')).toBeNull();
    fireEvent.click(m.q('modeled')!.querySelector('input')!);
    expect(m.drafts.at(-1)).toMatchObject({ modeled: true });
    expect(text(m.container, 'thread-cost')).toBe('Slower to rebuild, many more triangles.');
    cleanup();
    const t2 = await mount({ ...THREAD, modeled: true }, { modeledMs: 2400 });
    expect(text(t2.container, 'thread-cost')).toBe('About 2 s to rebuild, many more triangles.');
  });

  it('remembers the choice as the default for new threads', async () => {
    const m = await mount();
    fireEvent.click(m.q('modeled')!.querySelector('input')!);
    expect(loadThreadPrefs().modeled).toBe(true);
    expect(newThread('F1.S.c1', 6, TABLE.metric, false)).toMatchObject({ modeled: true });
    fireEvent.click(m.q('modeled')!.querySelector('input')!);
    expect(newThread('F1.S.c1', 6, TABLE.metric, false)).toMatchObject({ modeled: false });
  });

  it('says why the kernel did not build it when the committed entry is not modeled', async () => {
    const warning = { code: 'threadModelFallback', hint: 'thread not modeled: NPT is tapered' };
    const m = await mount({ ...THREAD, modeled: true }, { warning, entryModeled: false });
    expect(text(m.container, 'thread-notbuilt')).toBe('Not built: thread not modeled: NPT is tapered');
    cleanup();
    const ok = await mount({ ...THREAD, modeled: true }, { entryModeled: true });
    expect(ok.container.querySelector('[data-testid="thread-notbuilt"]')).toBeNull();
    cleanup();
    const bare = await mount({ ...THREAD, modeled: true }, { entryModeled: false });
    expect(text(bare.container, 'thread-notbuilt')).toBe('Not built: the kernel kept it cosmetic');
  });
});

describe('ThreadEditor: keyboard', () => {
  it('Enter confirms with the draft, Escape cancels, the tick confirms', async () => {
    const m = await mount();
    fireEvent.click(m.seg('hand', 'left'));
    fireEvent.keyDown(m.container.querySelector('.thread-editor')!, { key: 'Enter' });
    expect(m.confirms.at(-1)).toEqual({ hand: 'left' });
    fireEvent.keyDown(m.container.querySelector('.thread-editor')!, { key: 'Escape' });
    expect(m.cancelled()).toBe(1);
    fireEvent.click(m.container.querySelector('.fedit-confirm')!);
    expect(m.confirms).toHaveLength(2);
  });

  it('Enter on a button or a dropdown does not confirm; Enter in a number field does', async () => {
    const m = await mount({ ...THREAD, length: 10 });
    fireEvent.keyDown(m.seg('hand', 'left'), { key: 'Enter' });
    fireEvent.keyDown(m.sel('standard'), { key: 'Enter' });
    expect(m.confirms).toHaveLength(0);
    fireEvent.keyDown(m.q('length')!.querySelector('input[type="number"]')!, { key: 'Enter' });
    expect(m.confirms).toHaveLength(1);
  });

  it('takes the keyboard focus when it opens, so Enter / Esc work without a click', async () => {
    const m = await mount();
    expect(document.activeElement).toBe(m.container.querySelector('.thread-editor'));
  });
});

describe('ThreadEditor: several faces', () => {
  const GROUP = [
    { id: 'F5', face: 'F4.S.h1~0', dia: 5, internal: true }, { id: 'F6', face: 'F4.S.h1~1', dia: 5, internal: true },
    { id: 'F7', face: 'F4.S.h1~2', dia: 5, internal: true }, { id: 'F8', face: 'F4.S.h1~3', dia: 5, internal: true },
  ];
  it('the chip counts the faces and gives the diameter, the fit line says every face fits', async () => {
    const m = await mount({ ...THREAD, face: 'F4.S.h1~0', size: 'M6' }, { group: GROUP, warnings: {}, internal: true, faceDiameter: 5 });
    expect(text(m.container, 'thread-face')).toContain('4 holes, Ø 5 mm');
    expect(text(m.container, 'thread-fit')).toBe('Fits: all 4 holes match M6 tap drill');
  });
  it('the fit line flags the faces the kernel says do not fit, with the size it suggests', async () => {
    const warnings = { F6: { code: 'threadDiameterMismatch', hint: 'x', params: { nearest: ['M6'] } }, F8: { code: 'threadDiameterMismatch', hint: 'x', params: { nearest: ['M6'] } } };
    const m = await mount({ ...THREAD, face: 'F4.S.h1~0', size: 'M10' }, { group: GROUP, warnings, internal: true, faceDiameter: 5 });
    const fit = m.container.querySelector('[data-testid="thread-fit"]')!;
    expect(fit.getAttribute('data-warning')).toBe('threadDiameterMismatch');
    expect(fit.textContent).toContain('2 of 4 faces do not fit M10: F4.S.h1~1, F4.S.h1~3');
    fireEvent.click(m.container.querySelector('[data-testid="thread-use"]')!);
    expect(m.drafts.at(-1)).toMatchObject({ size: 'M6' });
  });
  it('mixed faces say "faces" and a range; a single thread keeps its single chip', async () => {
    const mixed = [{ id: 'A', face: 'a', dia: 4, internal: true }, { id: 'B', face: 'b', dia: 6, internal: false }];
    const m = await mount(THREAD, { group: mixed, warnings: {} });
    expect(text(m.container, 'thread-face')).toContain('2 faces, Ø 4 - 6 mm');
    cleanup();
    const one = await mount(THREAD, { group: [mixed[0]], faceDiameter: 4, internal: true });
    expect(text(one.container, 'thread-face')).toContain('Hole, Ø 4 mm');
  });
});
