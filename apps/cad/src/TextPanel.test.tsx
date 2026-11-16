import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { TextPanel } from './TextPanel';
import { en as catalogue } from './locales/en';
const en = (k: string): string => String((catalogue as Record<string, unknown>)[k]);
import './i18n';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const fields = { string: 'RPM', font: 'gauge' as const, height: 4, anchor: ['left', 'baseline'] as ['left', 'baseline'], angle: 0, spacing: 1, mirror: false, arc: null, x: 0, y: 0 };
const props = () => ({ fields, notes: [], onPatch: vi.fn(), onDone: vi.fn(), onDelete: vi.fn(), onPickCentre: vi.fn(), picking: false });

describe('TextPanel', () => {
  it('applies the string after the debounce and on Enter; an empty string is not applied and says so', () => {
    vi.useFakeTimers();
    const p = props();
    render(<TextPanel {...p} />);
    const input = screen.getByLabelText(en('app.sketch.text.string')) as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'KNOTS' } });
    expect(p.onPatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(p.onPatch).toHaveBeenCalledWith({ string: 'KNOTS' });
    p.onPatch.mockClear();
    fireEvent.input(input, { target: { value: '  ' } });
    vi.advanceTimersByTime(400);
    expect(p.onPatch).not.toHaveBeenCalled();
    expect(screen.getByText(en('app.sketch.text.err.Empty'))).toBeTruthy();
  });
  it('edits the height, the font, the anchor grid, mirror and the arc', () => {
    const p = props();
    const { container } = render(<TextPanel {...p} />);
    const h = screen.getByLabelText(en('app.sketch.text.height')) as HTMLInputElement;
    fireEvent.input(h, { target: { value: '6' } });
    fireEvent.keyDown(h, { key: 'Enter' });
    expect(p.onPatch).toHaveBeenCalledWith({ height: 6 });
    fireEvent.change(screen.getByLabelText(en('app.sketch.text.font')), { target: { value: 'engrave' } });
    expect(p.onPatch).toHaveBeenCalledWith({ font: 'engrave' });
    fireEvent.click(container.querySelector('[data-anchor="center middle"]')!);
    expect(p.onPatch).toHaveBeenCalledWith({ anchor: ['center', 'middle'] });
    fireEvent.click(screen.getByLabelText(en('app.sketch.text.mirror')));
    expect(p.onPatch).toHaveBeenCalledWith({ mirror: true });
    fireEvent.click(container.querySelector('[data-field="onArc"] input')!);
    expect(p.onPatch).toHaveBeenCalledWith({ arc: {} });
  });
  it('shows the arc fields and the pick-centre button when the text is on an arc; warnings and a small height are listed', () => {
    const p = { ...props(), fields: { ...fields, height: 0.5, arc: { radius: 28, angleCentre: 90, side: 'outside' as const, centre: { x: 0, y: 0 } } }, notes: [{ key: 'app.sketch.text.warn.MissingGlyph', params: { detail: '€' } }] };
    const { container } = render(<TextPanel {...p} />);
    fireEvent.click(container.querySelector('[data-act="pick"]')!);
    expect(p.onPickCentre).toHaveBeenCalled();
    const r = screen.getByLabelText(en('app.sketch.text.radius')) as HTMLInputElement;
    fireEvent.input(r, { target: { value: '30' } });
    fireEvent.keyDown(r, { key: 'Enter' });
    expect(p.onPatch).toHaveBeenCalledWith({ arc: { radius: 30 } });
    expect(screen.getByText(en('app.sketch.text.warn.TooSmall'))).toBeTruthy();
    expect(container.querySelector('[data-note="app.sketch.text.warn.MissingGlyph"]')).toBeTruthy();
  });
  it('every key it uses is in the English catalogue', () => {
    for (const k of ['title', 'done', 'delete', 'string', 'height', 'font', 'anchor', 'angle', 'spacing', 'mirror', 'onArc', 'radius', 'direction', 'centreX', 'centreY', 'pickCentre', 'picking', 'side', 'side.outside', 'side.inside', 'font.gauge', 'font.engrave',
      'anchor.left', 'anchor.center', 'anchor.right', 'anchor.top', 'anchor.middle', 'anchor.baseline', 'warn.TooSmall', 'warn.MissingGlyph', 'warn.Truncated', 'warn.SpacingAdjusted', 'warn.Overlap',
      'err.Empty', 'err.NothingToDraw', 'err.BadFont', 'err.BadHeight', 'err.BadArc', 'err.BadValue', 'err.Other']) expect((catalogue as Record<string, unknown>)['app.sketch.text.' + k], k).toBeTruthy();
    expect((catalogue as Record<string, unknown>)['app.sketch.tool.text']).toBeTruthy();
    expect((catalogue as Record<string, unknown>)['app.sketch.hint.textPlace']).toBeTruthy();
  });
});

describe('TextPanel along a curve', () => {
  it('"Along a curve" switches it on; with a curve picked the pick button, flip and slide edit it', () => {
    const p = { ...props(), onPickPath: vi.fn(), pickingPath: false };
    const { container } = render(<TextPanel {...p} />);
    fireEvent.click(container.querySelector('[data-field="onPath"] input')!);
    expect(p.onPatch).toHaveBeenCalledWith({ path: {} });
    cleanup();
    const q = { ...props(), onPickPath: vi.fn(), pickingPath: false, fields: { ...fields, path: { id: 'e1', offset: 0, flip: false } } };
    const r = render(<TextPanel {...q} />);
    fireEvent.click(r.container.querySelector('[data-act="pickPath"]')!);
    expect(q.onPickPath).toHaveBeenCalled();
    expect(r.container.querySelector('[data-act="pickPath"]')!.textContent).toBe(en('app.sketch.text.changePath'));
    fireEvent.click(r.container.querySelector('[data-field="pathFlip"] input')!);
    expect(q.onPatch).toHaveBeenCalledWith({ path: { flip: true } });
    const off = screen.getByLabelText(en('app.sketch.text.pathOffset')) as HTMLInputElement;
    fireEvent.input(off, { target: { value: '5' } });
    fireEvent.keyDown(off, { key: 'Enter' });
    expect(q.onPatch).toHaveBeenCalledWith({ path: { offset: 5 } });
  });
});
