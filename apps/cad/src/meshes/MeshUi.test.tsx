import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { meshToStl } from '@kit/io';
import { cube } from '../../../../packages/io/src/testmesh';
import { meshRecFromStl } from './meshDoc';
import { readStl } from '@kit/io';
import { MeshImportDialog } from './MeshImportDialog';
import { MeshPanel } from './MeshPanel';
import { probeStl } from './meshImport';
import '../i18n';

afterEach(() => cleanup());
const bytes = meshToStl({ positions: cube(0.1) }).data as Uint8Array;

describe('MeshImportDialog', () => {
  const pr = probeStl(bytes);
  if (!pr.ok) throw new Error('probe');
  it('shows the counts, the size in the chosen unit, and a hint when the size looks wrong; Import passes unit and ground', () => {
    const onImport = vi.fn();
    const r = render(<MeshImportDialog name="a.stl" probe={pr.probe} unit="mm" onImport={onImport} onCancel={() => {}} />);
    expect(r.getByTestId('mesh-import-summary').textContent).toMatch(/12 triangles, 8 vertices/);
    expect(r.getByTestId('mesh-import-size').textContent).toMatch(/0\.1 x 0\.1 x 0\.1 mm/);
    expect(r.getByTestId('mesh-import-hint')).toBeTruthy();
    fireEvent.change(r.getByTestId('mesh-import-unit'), { target: { value: 'cm' } });
    expect(r.getByTestId('mesh-import-size').textContent).toMatch(/1 x 1 x 1 mm/);
    fireEvent.click(r.getByTestId('mesh-import-ground'));
    fireEvent.click(r.getByTestId('mesh-import-ok'));
    expect(onImport).toHaveBeenCalledWith('cm', true);
  });
  it('Escape cancels', () => {
    const onCancel = vi.fn();
    render(<MeshImportDialog name="a.stl" probe={pr.probe} unit="mm" onImport={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('MeshPanel', () => {
  const rec = meshRecFromStl(readStl(meshToStl({ positions: cube(10) }).data as Uint8Array), 'mesh1', 'Box', 'mm');
  const mount = () => {
    const calls = { change: [] as unknown[], apply: [] as unknown[], cancel: 0, del: 0 };
    const r = render(<MeshPanel rec={rec} upAxis="z" onChange={(x) => calls.change.push(x)} onApply={(x) => calls.apply.push(x)} onCancel={() => { calls.cancel++; }} onDelete={() => { calls.del++; }} onSketchOn={() => {}} onDraw={() => {}} />);
    return { r, calls };
  };
  it('opacity previews live and Done applies the edited record once', () => {
    const { r, calls } = mount();
    fireEvent.input(r.getByTestId('mesh-opacity'), { target: { value: '30' } });
    expect((calls.change.at(-1) as { opacity: number }).opacity).toBeCloseTo(0.3);
    fireEvent.change(r.getByTestId('mesh-scale'), { target: { value: '2' } });
    fireEvent.click(r.getByTestId('mesh-done'));
    expect(calls.apply).toHaveLength(1);
    expect(calls.apply[0]).toMatchObject({ opacity: 0.3, scale: 2, id: 'mesh1' });
  });
  it('position, turn, ground, delete and cancel', () => {
    const { r, calls } = mount();
    fireEvent.change(r.container.querySelector('[data-field="pos"][data-axis="x"]')!, { target: { value: '25' } });
    expect((calls.change.at(-1) as { pos: number[] }).pos[0]).toBe(25);
    fireEvent.click(r.container.querySelector('[data-turn="x"]')!);
    expect((calls.change.at(-1) as { rot: number[] }).rot[0]).toBeCloseTo(90);
    fireEvent.click(r.getByTestId('mesh-ground'));
    fireEvent.click(r.getByTestId('mesh-delete'));
    fireEvent.click(r.getByTestId('mesh-cancel'));
    expect(calls.del).toBe(1);
    expect(calls.cancel).toBe(1);
  });
});
