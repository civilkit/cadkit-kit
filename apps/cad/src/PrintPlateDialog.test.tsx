// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { PrintPlateDialog } from './PrintPlateDialog';
import type { PlateBodyInput } from './printPlate';

function makeBox(w: number, d: number, h: number): Float32Array {
  const tris: number[] = [];
  const quad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    e: [number, number, number],
  ) => {
    tris.push(...a, ...b, ...c, ...a, ...c, ...e);
  };
  quad([0, 0, 0], [0, d, 0], [w, d, 0], [w, 0, 0]);
  quad([0, 0, h], [w, 0, h], [w, d, h], [0, d, h]);
  quad([0, 0, 0], [w, 0, 0], [w, 0, h], [0, 0, h]);
  quad([0, d, 0], [0, d, h], [w, d, h], [w, d, 0]);
  quad([0, 0, 0], [0, 0, h], [0, d, h], [0, d, 0]);
  quad([w, 0, 0], [w, d, 0], [w, d, h], [w, 0, h]);
  return new Float32Array(tris);
}

const sampleBodies = (): PlateBodyInput[] => [
  { id: 'b1', name: 'Base', positions: makeBox(120, 90, 12), color: '#4c8bf5' },
  { id: 'b2', name: 'Lid', positions: makeBox(120, 90, 8), color: '#3fb950' },
];

afterEach(cleanup);

describe('PrintPlateDialog', () => {
  it('renders top-down SVG preview, placed bodies, and summary', () => {
    const { getByTestId } = render(
      <PrintPlateDialog
        bodies={sampleBodies()}
        partName="Box"
        detectSlicers={async () => []}
        onExportPlate={vi.fn()}
        onSendToSlicer={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(getByTestId('print-plate-svg')).toBeTruthy();
    expect(getByTestId('plate-body-rect-b1')).toBeTruthy();
    expect(getByTestId('plate-body-rect-b2')).toBeTruthy();
    expect(getByTestId('print-plate-summary').textContent).toContain('2 of 2');
  });

  it('highlights overflow when switching to a smaller bed preset', () => {
    const { getByTestId, queryByTestId } = render(
      <PrintPlateDialog
        bodies={sampleBodies()}
        detectSlicers={async () => []}
        onExportPlate={vi.fn()}
        onSendToSlicer={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(queryByTestId('print-plate-overflow')).toBeNull();
    // Switch to Bambu A1 Mini (180x180, usable 170x170): two 120x90 bodies cannot both fit
    fireEvent.change(getByTestId('print-plate-preset'), { target: { value: 'bambu-a1-mini' } });
    expect((getByTestId('print-plate-width') as HTMLInputElement).value).toBe('180');
    expect(getByTestId('print-plate-overflow')).toBeTruthy();
    expect(getByTestId('print-plate-summary').textContent).toContain('1 of 2');
  });

  it('supports per-body include/exclude and lay-flat toggles', () => {
    const { getByTestId, queryByTestId } = render(
      <PrintPlateDialog
        bodies={[{ id: 'tall', name: 'Wall', positions: makeBox(10, 40, 80) }]}
        detectSlicers={async () => []}
        onExportPlate={vi.fn()}
        onSendToSlicer={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // With lay-flat on (default), the 10x40x80 slab lies flat so height is 10 mm
    expect(getByTestId('plate-body-row-tall').textContent).toContain('× 10 mm');
    // Uncheck lay-flat -> height returns to 80 mm
    fireEvent.click(getByTestId('plate-layflat-tall'));
    expect(getByTestId('plate-body-row-tall').textContent).toContain('× 80 mm');
    // Uncheck include -> removed from plate and export/send disabled
    fireEvent.click(getByTestId('plate-include-tall'));
    expect(queryByTestId('plate-body-rect-tall')).toBeNull();
    expect((getByTestId('print-plate-export') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('print-plate-send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows detected desktop slicers and sends to the chosen slicer', async () => {
    const onSend = vi.fn();
    const onExport = vi.fn();
    const { getByTestId } = render(
      <PrintPlateDialog
        bodies={sampleBodies()}
        detectSlicers={async () => [
          { id: 'bambu-studio', name: 'Bambu Studio' },
          { id: 'orcaslicer', name: 'OrcaSlicer' },
        ]}
        onExportPlate={onExport}
        onSendToSlicer={onSend}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(getByTestId('print-plate-slicer-select')).toBeTruthy());
    fireEvent.change(getByTestId('print-plate-slicer-select'), { target: { value: 'orcaslicer' } });
    fireEvent.click(getByTestId('print-plate-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe('orcaslicer');
    expect(onSend.mock.calls[0][1]).toBe('OrcaSlicer');
    expect(onSend.mock.calls[0][2].fittedCount).toBe(2);

    fireEvent.click(getByTestId('print-plate-export'));
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
  });

  it('closes on Escape and Close button', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(
      <PrintPlateDialog
        bodies={sampleBodies()}
        detectSlicers={async () => []}
        onExportPlate={vi.fn()}
        onSendToSlicer={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(getByTestId('print-plate-close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
