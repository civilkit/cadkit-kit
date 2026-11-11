import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { ImportKindDialog, readChoice, writeChoice } from './ImportKindDialog';
import '../i18n';

afterEach(() => { cleanup(); try { localStorage.clear(); } catch { /* none */ } });

describe('ImportKindDialog', () => {
  it('SketchUp: reference mesh is the default, View only is the other option, hidden geometry is a tick', () => {
    const onImport = vi.fn();
    const r = render(<ImportKindDialog kind="skp" name="house.skp" initial="saved" onImport={onImport} onCancel={() => {}} />);
    expect(r.getByText(/Reference mesh \(draw on it, saved with the part\)/)).toBeTruthy();
    expect(r.getByText('View only')).toBeTruthy();
    expect((r.getByTestId('import-kind-saved') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(r.getByTestId('import-kind-hidden'));
    fireEvent.click(r.getByTestId('import-kind-ok'));
    expect(onImport).toHaveBeenCalledWith('saved', true);
  });
  it('STEP: a part feature by default; View only is remembered for the next import', () => {
    const onImport = vi.fn();
    const r = render(<ImportKindDialog kind="step" name="bracket.step" initial={readChoice('step')} onImport={onImport} onCancel={() => {}} />);
    expect(r.getByText(/Part feature \(saved with the part\)/)).toBeTruthy();
    expect(r.queryByTestId('import-kind-hidden')).toBeNull();
    fireEvent.click(r.getByTestId('import-kind-view'));
    fireEvent.click(r.getByTestId('import-kind-ok'));
    expect(onImport).toHaveBeenCalledWith('view', false);
    expect(readChoice('step')).toBe('view');
    expect(readChoice('skp')).toBe('saved');
  });
  it('the choice is stored per kind and a broken storage gives the default', () => {
    writeChoice('skp', 'view');
    expect(readChoice('skp')).toBe('view');
    expect(readChoice('skp', { getItem: () => { throw new Error('blocked'); } })).toBe('saved');
  });
  it('Escape and the Cancel button cancel without importing', () => {
    const onCancel = vi.fn(), onImport = vi.fn();
    const r = render(<ImportKindDialog kind="step" name="a.step" initial="saved" onImport={onImport} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(r.getByTestId('import-kind-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onImport).not.toHaveBeenCalled();
  });
});
