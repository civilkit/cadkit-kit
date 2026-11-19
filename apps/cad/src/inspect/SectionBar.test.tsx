import '../i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { SectionBar, type SectionBarProps } from './SectionBar';

afterEach(cleanup);
const base = (o: Partial<SectionBarProps> = {}): SectionBarProps => ({ section: { on: false, plane: 'front', faceId: null, offset: 0, flip: false }, range: [0, 10], sketchPlane: null, onToggle: vi.fn(), onPlane: vi.fn(), onChange: vi.fn(), ...o });

describe('SectionBar', () => {
  it('off: only the toggle; on: planes, the sketch plane, offset and flip', () => {
    const off = base();
    const a = render(<SectionBar {...off} />);
    expect(a.container.querySelector('input')).toBeNull();
    fireEvent.click(a.getByText('Section')); expect(off.onToggle).toHaveBeenCalled();
    cleanup();
    const on = base({ section: { on: true, plane: 'front', faceId: null, offset: 5, flip: false }, sketchPlane: { plane: 'face', faceId: 'F2.C1' } });
    const b = render(<SectionBar {...on} />);
    fireEvent.click(b.getByText('Top')); expect(on.onPlane).toHaveBeenCalledWith('top');
    fireEvent.click(b.getByText('Sketch plane')); expect(on.onPlane).toHaveBeenCalledWith('face', 'F2.C1');
    fireEvent.input(b.container.querySelector('input[type="range"]')!, { target: { value: '7' } }); expect(on.onChange).toHaveBeenCalledWith({ offset: 7 });
    fireEvent.click(b.container.querySelector('input[type="checkbox"]')!); expect(on.onChange).toHaveBeenCalledWith({ flip: true });
  });
});
