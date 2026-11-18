import { describe, expect, it, vi } from 'vitest';
import { emptyDrawing, type DView, type ViewData } from './model';
import { addSection, fetchViews, type DrawingQuery } from './layout';
import { viewFailureText } from './viewError';

const g: ViewData = { min: [0, 0], max: [10, 10], lines: [{ k: 'e', v: true, p: [0, 0, 10, 0], e: 0 }], edges: [{ faces: ['F1.C0'], at: [0, 0, 0], mid: [5, 0], ends: [[0, 0], [10, 0]] }] };
const view = (id: string, extra: Partial<DView> = {}): DView => ({ id, kind: 'std', label: id, x: [1, 0, 0], y: [0, 1, 0], pos: [0, 0], scale: null, hidden: true, tangent: false, centerlines: true, showLabel: true, ...extra });
const docOf = (...vs: DView[]) => ({ ...emptyDrawing('P'), views: vs });
const FAIL = { error: 'cutNoEffect', detail: 'boolean failed at the counterbore', hint: 'move the cut line off the hole axis' };

describe('fetchViews: a view the kernel could not make is reported, not dropped silently', () => {
  it('one view at a time (several views): onError gets error, detail and hint; the other views still arrive', async () => {
    const doc = docOf(view('V1'), view('V2'));
    const query: DrawingQuery = async ([r]) => [r.section ? FAIL : g];
    const sec = { ...doc, views: [doc.views[0], view('V2', { kind: 'section', parent: 'V1', cut: { dir: 'v', at: 0, letter: 'A' } })] };
    const onError = vi.fn();
    const out = await fetchViews(sec, query, undefined, { onError });
    expect(Object.keys(out)).toEqual(['V1']);
    expect(onError).toHaveBeenCalledWith('V2', FAIL);
  });
  it('a single view asked for on its own', async () => {
    const onError = vi.fn();
    const out = await fetchViews(docOf(view('V1')), async () => [FAIL], undefined, { onError });
    expect(out).toEqual({});
    expect(onError).toHaveBeenCalledWith('V1', FAIL);
  });
  it('works with kernels that send no detail or hint, and with a reply that has neither lines nor error', async () => {
    const onError = vi.fn();
    await fetchViews(docOf(view('V1')), async () => [{ error: 'cutNoEffect' }], undefined, { onError });
    expect(onError).toHaveBeenCalledWith('V1', { error: 'cutNoEffect' });
    const e2 = vi.fn();
    await fetchViews(docOf(view('V1')), async () => [{}], undefined, { onError: e2 });
    expect(e2).toHaveBeenCalledWith('V1', { error: 'noGeometry' });
    // no callback: still no throw
    await expect(fetchViews(docOf(view('V1')), async () => [FAIL])).resolves.toEqual({});
  });
  it('addSection hands the failure to its callback and returns null', async () => {
    const doc = docOf(view('V1'));
    const onError = vi.fn();
    const r = await addSection(doc, async () => [FAIL], { V1: g }, 'V1', 'v', 5, onError);
    expect(r).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.any(String), FAIL);
  });
});

describe('viewFailureText', () => {
  const tr = (k: string, p?: Record<string, string | number>) => ({
    'drawing.kind.section': 'Section view', 'drawing.msg.sectionMisses': 'MISSES',
    'drawing.msg.viewFailed': 'The {view} could not be made: {reason}.', 'drawing.msg.err.cutNoEffect': 'cut failed', 'drawing.msg.err.other': 'kernel said {error}',
  } as Record<string, string>)[k]?.replace(/\{(\w+)\}/g, (_m, a: string) => String(p?.[a])) ?? k;
  it('says what failed, then the kernel detail and hint', () => {
    expect(viewFailureText(FAIL, 'section', tr)).toBe('The Section view could not be made: cut failed. boolean failed at the counterbore. move the cut line off the hole axis');
  });
  it('without detail or hint a cut that had no effect means the line misses the part; other codes are quoted', () => {
    expect(viewFailureText({ error: 'cutNoEffect' }, 'section', tr)).toBe('MISSES');
    expect(viewFailureText({ error: 'weird' }, 'section', tr)).toBe('The Section view could not be made: kernel said weird.');
  });
});
