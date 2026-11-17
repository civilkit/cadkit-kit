import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { optionsFor } from './FeatureOptions';
import './i18n';

afterEach(cleanup);
const move = { type: 'moveFace', id: 'F5', faces: ['F2.C1'], mode: 'offset', distance: 4 };
const press = { type: 'pressPull', id: 'F5', faces: ['F2.C1'], continue: 'straight', distance: 10 };
const form = (eff: Record<string, unknown>, change = vi.fn(), faceRun?: (f: string[], id?: string) => Promise<Array<{ found?: boolean; flat?: boolean; reach?: number }> | null>) => {
  const r = optionsFor({ eff, change }, null, { closeWithLine() {}, asSurface() {}, faceRun } as never);
  return { ...render(<div>{r!.node}</div>), change };
};

describe('Press Pull form', () => {
  it('Continue lists Offset, Straight and Along the walls marked later and disabled', () => {
    const { container } = form(move);
    const sel = container.querySelector('[data-path="continue"] select') as HTMLSelectElement;
    expect([...sel.options].map((o) => [o.value, o.textContent, o.disabled])).toEqual([['offset', 'Offset', false], ['straight', 'Straight', false], ['along', 'Along the walls (later)', true]]);
    expect(sel.value).toBe('offset');
    expect(container.querySelector('[data-path="distance"]')).toBeNull();   // Offset keeps the generic distance field
  });
  it('choosing Straight sends the conversion patch', () => {
    const { container, change } = form(move);
    fireEvent.change(container.querySelector('[data-path="continue"] select')!, { target: { value: 'straight' } });
    expect(change).toHaveBeenCalledWith({ type: 'pressPull', continue: 'straight', mode: null, translate: null, flip: null, distance: 4, taper: null });
  });
  it('Straight shows Distance and the Taper type, with the angle or the end scale of the chosen type', () => {
    const none = form(press).container;
    expect(none.querySelector('[data-path="distance"]')).not.toBeNull();
    expect((none.querySelector('[data-path="taper"] select') as HTMLSelectElement).value).toBe('none');
    expect(none.querySelector('[data-path="taper.angle"]')).toBeNull();
    expect(none.querySelector('[data-path="taper.endScale"]')).toBeNull();
    cleanup();
    expect(form({ ...press, taper: { type: 'draft', angle: -3 } }).container.querySelector('[data-path="taper.angle"]')).not.toBeNull();
    cleanup();
    const sc = form({ ...press, taper: { type: 'scale', endScale: 1.1 } }).container;
    expect(sc.querySelector('[data-path="taper.endScale"]')).not.toBeNull();
    expect(sc.querySelector('[data-path="taper.angle"]')).toBeNull();
  });
  it('choosing a taper type sends the taper patch', () => {
    const { container, change } = form(press);
    fireEvent.change(container.querySelector('[data-path="taper"] select')!, { target: { value: 'scale' } });
    expect(change).toHaveBeenCalledWith({ taper: { type: 'scale', endScale: 1.2 } });
  });
  it('a scale taper reads the angle from the face reach (asked before this feature)', async () => {
    const faceRun = vi.fn(async () => [{ found: true, flat: true, reach: 10 }]);
    const { container } = form({ ...press, taper: { type: 'scale', endScale: 1.1 } }, vi.fn(), faceRun);
    await waitFor(() => expect(container.querySelector('[data-path="taper.readout"] input')).not.toBeNull());
    expect((container.querySelector('[data-path="taper.readout"] input') as HTMLInputElement).value).toBe('5.71°');
    expect(faceRun).toHaveBeenCalledWith(['F2.C1'], 'F5');
  });
  it('has no readout when the kernel cannot say (no reach) or for a draft taper', async () => {
    const faceRun = vi.fn(async () => null);
    const sc = form({ ...press, taper: { type: 'scale', endScale: 1.1 } }, vi.fn(), faceRun).container;
    await waitFor(() => expect(faceRun).toHaveBeenCalled());
    expect(sc.querySelector('[data-path="taper.readout"]')).toBeNull();
    cleanup();
    const run2 = vi.fn(async () => [{ reach: 10 }]);
    expect(form({ ...press, taper: { type: 'draft', angle: 3 } }, vi.fn(), run2).container.querySelector('[data-path="taper.readout"]')).toBeNull();
    expect(run2).not.toHaveBeenCalled();
  });
});
