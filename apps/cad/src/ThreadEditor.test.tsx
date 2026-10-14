import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { ThreadEditor, type ThreadEditorProps } from './ThreadEditor';
import type { ThreadRow, ThreadStd } from './threadData';
import './i18n';

afterEach(cleanup);

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
  const r = render(<ThreadEditor feature={feature} onDraft={(d) => drafts.push(d)} onConfirm={(d) => confirms.push(d)} onCancel={() => {}}
    loadStandards={async () => STDS} loadSizes={async (s) => TABLE[s] ?? []} {...extra} />);
  const q = (path: string) => r.container.querySelector(`[data-path="${path}"]`) as HTMLElement | null;
  const sel = (path: string) => q(path)!.querySelector('select') as HTMLSelectElement;
  await waitFor(() => expect(sel('size').options.length).toBeGreaterThan(1));
  return { ...r, drafts, confirms, q, sel };
}

describe('ThreadEditor', () => {
  it('has Thread, Length and hand, Options sections', async () => {
    const m = await mount();
    expect([...m.container.querySelectorAll('.fedit-sec-head')].map((h) => h.textContent)).toEqual(['Thread', 'Length and hand', 'Options']);
  });

  it('Standard dropdown lists the eight standards with their names', async () => {
    const m = await mount();
    expect([...m.sel('standard').options].map((o) => o.textContent)).toEqual(['ISO metric coarse', 'ISO metric fine', 'UNC', 'UNF', 'BSP parallel (G)', 'NPT (tapered)', 'Trapezoidal (Tr)', 'Acme']);
    expect(m.sel('standard').value).toBe('metric');
  });

  it('Size lists the sizes of the standard, the nearest to the face first and marked', async () => {
    const m = await mount(THREAD, { faceDiameter: 6.9, internal: true });
    const groups = [...m.sel('size').querySelectorAll('optgroup')];
    expect(groups[0].getAttribute('label')).toBe('Nearest to Ø 6.9 mm');
    expect([...groups[0].querySelectorAll('option')].map((o) => o.textContent)).toEqual(['M8 (nearest)', 'M10 (nearest)', 'M6 (nearest)']);
    expect([...groups[1].querySelectorAll('option')].map((o) => o.textContent)).toEqual(['M4', 'M5']);
    expect(m.sel('size').value).toBe('M6');
  });

  it('without a face diameter the sizes are plainly listed', async () => {
    const m = await mount();
    expect(m.sel('size').querySelectorAll('optgroup').length).toBe(1);
    expect(m.sel('size').options.length).toBe(5);
  });

  it('reads pitch, major, minor and tap drill of the size', async () => {
    const m = await mount(THREAD, { internal: true });
    const dd = (k: string) => m.container.querySelector(`[data-testid="thread-readout"] [data-k="${k}"]`)!.textContent;
    expect(dd('pitch')).toBe('1 mm');
    expect(dd('major')).toBe('6 mm');
    expect(dd('tapDrill')).toBe('5 mm');
    expect(dd('minor')).toContain('4.918');
    fireEvent.change(m.sel('size'), { target: { value: 'M8' } });
    expect(dd('pitch')).toBe('1.25 mm');
    expect(dd('tapDrill')).toBe('6.8 mm');
  });

  it('changing the size drafts it with the class of the reading', async () => {
    const m = await mount(THREAD, { internal: false });
    fireEvent.change(m.sel('size'), { target: { value: 'M8' } });
    expect(m.drafts.at(-1)).toEqual({ size: 'M8', class: '6g' });
  });

  it('changing the standard loads its sizes and picks the nearest to the face', async () => {
    const m = await mount(THREAD, { faceDiameter: 5.1, internal: true });
    fireEvent.change(m.sel('standard'), { target: { value: 'UNC' } });
    await waitFor(() => expect(m.drafts.some((d) => d.size === '1/4-20')).toBe(true));
    const last = m.drafts.at(-1)!;
    expect(last).toMatchObject({ standard: 'UNC', size: '1/4-20', class: '2B' });
    expect([...m.sel('size').options].map((o) => o.value)).toContain('5/16-18');
  });

  it('class is free text with the table classes as suggestions', async () => {
    const m = await mount();
    const input = m.q('class')!.querySelector('input') as HTMLInputElement;
    expect([...m.container.querySelectorAll('#thread-classes option')].map((o) => (o as HTMLOptionElement).value)).toEqual(['6H', '6g']);
    fireEvent.change(input, { target: { value: '7H' } });
    expect(m.drafts.at(-1)).toEqual({ class: '7H' });
  });

  it('length: full thread, or a number', async () => {
    const m = await mount();
    const full = m.q('length')!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(full.checked).toBe(true);
    expect(m.q('length')!.querySelector('input[type="number"]')).toBeNull();
    fireEvent.click(full);
    expect(typeof m.drafts.at(-1)!.length).toBe('number');
    const num = m.q('length')!.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(num, { target: { value: '12' } });
    expect(m.drafts.at(-1)).toMatchObject({ length: 12 });
    fireEvent.click(m.q('length')!.querySelector('input[type="checkbox"]')!);
    expect(m.drafts.at(-1)).toMatchObject({ length: 'full' });
  });

  it('hand and start; Open end removes the start field', async () => {
    const m = await mount({ ...THREAD, start: 'top' });
    expect(m.sel('start').value).toBe('top');
    expect([...m.sel('start').options].map((o) => o.textContent)).toEqual(['Open end', 'Top', 'Bottom']);
    fireEvent.change(m.sel('hand'), { target: { value: 'left' } });
    expect(m.drafts.at(-1)).toMatchObject({ hand: 'left' });
    fireEvent.change(m.sel('start'), { target: { value: 'open' } });
    expect(m.drafts.at(-1)).toMatchObject({ start: null });
  });

  it('the modeled checkbox', async () => {
    const m = await mount();
    const box = m.q('modeled')!.querySelector('input') as HTMLInputElement;
    expect(m.q('modeled')!.textContent).toBe('Model the thread (real helix, slower)');
    fireEvent.click(box);
    expect(m.drafts.at(-1)).toMatchObject({ modeled: true });
  });

  it('shows the kernel diameter warning in amber with a one-click Use M8', async () => {
    const warning = { code: 'threadDiameterMismatch', hint: 'hole is 6.8, M6 tap drill is 5: drill the hole to 5, or choose M8 (tap drill 6.8)', params: { nearest: 'M8' } };
    const m = await mount(THREAD, { warning, internal: true });
    const w = m.container.querySelector('.fedit-warn[data-warning="threadDiameterMismatch"]')!;
    expect(w.textContent).toContain('or choose M8');
    fireEvent.click(m.container.querySelector('[data-testid="thread-use"]')!);
    expect(m.drafts.at(-1)).toEqual({ size: 'M8', class: '6H' });
  });

  it('no Use button when the suggestion is the current size; the fallback warning is shown', async () => {
    const m = await mount({ ...THREAD, size: 'M8', modeled: true }, { warning: { code: 'threadModelFallback', hint: 'thread not modeled: NPT is tapered', all: [
      { code: 'threadDiameterMismatch', hint: 'mismatch', params: { nearest: 'M8' } }, { code: 'threadModelFallback', hint: 'thread not modeled: NPT is tapered' }] } });
    expect(m.container.querySelector('[data-testid="thread-use"]')).toBeNull();
    expect(m.container.querySelector('.fedit-warn[data-warning="threadModelFallback"]')!.textContent).toContain('not modeled');
  });

  it('shows the face, its diameter and internal / external', async () => {
    const m = await mount(THREAD, { faceDiameter: 5, internal: true });
    expect(m.container.querySelector('[data-testid="thread-face"]')!.textContent).toBe('F4.S.c1 · Ø 5 mm · internal (hole)');
  });

  it('Enter confirms with the draft, Escape cancels, the tick confirms', async () => {
    let cancelled = 0;
    const m = await mount(THREAD, { onCancel: () => { cancelled++; } });
    fireEvent.change(m.sel('hand'), { target: { value: 'left' } });
    fireEvent.keyDown(m.container.querySelector('.thread-editor')!, { key: 'Enter' });
    expect(m.confirms.at(-1)).toEqual({ hand: 'left' });
    fireEvent.keyDown(m.container.querySelector('.thread-editor')!, { key: 'Escape' });
    expect(cancelled).toBe(1);
    fireEvent.click(m.container.querySelector('.fedit-confirm')!);
    expect(m.confirms).toHaveLength(2);
  });
});
