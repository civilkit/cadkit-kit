import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { autoCutFlip, cutProblem, defaultShellThickness, editorFixes, suggestedThickness } from './editorFixes';
import { shellOps } from './featureCommands';
import { DiagnosticsCard } from './DiagnosticsCard';
import { diagnose } from './errorSummary';
import './i18n';

afterEach(cleanup);

describe('default shell wall', () => {
  it('1.0 mm or 2% of the smallest bounding-box side, whichever is larger, to 0.1', () => {
    expect(defaultShellThickness({ min: [0, 0, 0], max: [40, 30, 20] })).toBe(1);        // 2% of 20 = 0.4
    expect(defaultShellThickness({ min: [0, 0, 0], max: [400, 300, 200] })).toBe(4);     // 2% of 200
    expect(defaultShellThickness({ min: [0, 0, 0], max: [123, 80, 77] })).toBe(1.5);     // 1.54 -> 1.5
    expect(defaultShellThickness({ min: [0, 0, 0], max: [100, 100, 0] })).toBe(2);       // a flat box: the real sides
    expect(defaultShellThickness(null)).toBe(1);
  });
  it('the Shell tool starts from it', () => {
    const ctx = { doc: { features: [] }, selection: ['F2.C1'], mode: 'face', box: { min: [0, 0, 0], max: [400, 300, 200] }, edges: [] };
    const ops = shellOps(ctx as never)!;
    expect((ops[0] as unknown as { feature: { thickness: number } }).feature.thickness).toBe(4);
  });
});

describe('suggested thickness', () => {
  it('rounds down to 0.1 under the kernel maximum', () => {
    expect(suggestedThickness(0.87)).toBe(0.8);
    expect(suggestedThickness(0.8)).toBe(0.7);
    expect(suggestedThickness(0.07)).toBe(0.06);
    expect(suggestedThickness(0)).toBeNull();
    expect(suggestedThickness(undefined)).toBeNull();
  });
});

describe('editor fixes', () => {
  it('a shell refusal that carries maxThickness offers Use suggested thickness', () => {
    const r = editorFixes({ code: 'shellTooThick', params: { maxThickness: 0.87 } }, { type: 'shell', thickness: 1 });
    expect(r.fixes).toEqual([{ key: 'thickness', label: 'Use suggested thickness (0.8 mm)', path: 'thickness', value: 0.8 }]);
    expect(editorFixes({ code: 'shellTooThick', params: { detail: 'an edge reverses' } }, { type: 'shell' }).fixes).toEqual([]);
  });
  it('a cut that misses the body offers Flip with the plain question; flipping again flips back', () => {
    const r = editorFixes({ code: 'cutNoEffect' }, { type: 'extrude', op: 'cut' });
    expect(r.message).toBe('The cut does not touch the body in this direction. Flip?');
    expect(r.fixes).toEqual([{ key: 'flip', label: 'Flip direction', path: 'flip', value: true }]);
    expect(editorFixes({ code: 'cutNoEffect' }, { type: 'extrude', op: 'cut', flip: true }).fixes[0].value).toBe(false);
    expect(editorFixes({ code: 'cutNoEffect' }, { type: 'extrude', op: 'cut' }, { flip: true }).fixes[0].value).toBe(false);
    expect(editorFixes({ code: 'cutNoEffect' }, { type: 'extrude', op: 'add' }).fixes).toEqual([]);
  });
  it('the card shows the message and a button per fix', () => {
    const d = diagnose([{ id: 'F5', code: 'cutNoEffect' }], [{ id: 'F5', type: 'extrude' }]);
    const run = vi.fn();
    const { container } = render(<DiagnosticsCard diagnosis={d} variant="editor" onSelect={() => {}} message="The cut does not touch the body in this direction. Flip?" fixes={[{ key: 'flip', label: 'Flip direction', run }]} />);
    expect(container.querySelector('.diag-advice')!.textContent).toBe('The cut does not touch the body in this direction. Flip?');
    fireEvent.click(container.querySelector('[data-fix="flip"]')!);
    expect(run).toHaveBeenCalled();
  });
});

describe('auto cut direction', () => {
  const probeOf = (works: boolean[]) => vi.fn(async (flip: boolean) => (works[flip ? 1 : 0] ? { ok: true, codes: [] } : { ok: false, codes: ['cutNoEffect'] }));
  it('keeps the first side when it cuts, tries the other when it does not', async () => {
    const a = probeOf([true, true]);
    expect(await autoCutFlip(false, a)).toEqual({ flip: false, ok: true });
    expect(a).toHaveBeenCalledTimes(1);
    expect(await autoCutFlip(false, probeOf([false, true]))).toEqual({ flip: true, ok: true });
    expect(await autoCutFlip(true, probeOf([true, false]))).toEqual({ flip: false, ok: true });
  });
  it('neither side touches the body: not ok, the first side stays (the editor opens with the Flip question)', async () => {
    expect(await autoCutFlip(true, probeOf([false, false]))).toEqual({ flip: true, ok: false });
  });
  it('another kind of failure is not a direction problem', async () => {
    const p = vi.fn(async () => ({ ok: false, codes: ['noClosedProfile'] }));
    expect(await autoCutFlip(false, p)).toEqual({ flip: false, ok: false });
    expect(p).toHaveBeenCalledTimes(1);
  });
});

describe('cutProblem', () => {
  const cut = { type: 'extrude', op: 'cut' };
  it('names a cut with no body, and a cut that misses the body', () => {
    expect(cutProblem(cut, [{ code: 'nothingToCut' }])).toBe('nothing');
    expect(cutProblem(cut, [{ code: 'cutNoEffect' }])).toBe('miss');
  });
  it('is silent for an add, other errors, and no error', () => {
    expect(cutProblem({ type: 'extrude', op: 'add' }, [{ code: 'nothingToCut' }])).toBeNull();
    expect(cutProblem(cut, [{ code: 'noClosedProfile' }])).toBeNull();
    expect(cutProblem(cut, null)).toBeNull();
    expect(cutProblem(null, [{ code: 'nothingToCut' }])).toBeNull();
  });
});
