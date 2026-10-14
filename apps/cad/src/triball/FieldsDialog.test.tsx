import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { FieldsDialog } from './FieldsDialog';

afterEach(cleanup);

describe('FieldsDialog', () => {
  const fields = [
    { key: 'number', label: 'Number of copies', value: 3, integer: true, min: 1 },
    { key: 'distance', label: 'Distance', value: 12.5, unit: 'mm' },
    { key: 'angle', label: 'Angle', value: 60, disabled: true },
    { key: 'how', label: 'Action', type: 'choice' as const, value: 'move', options: [{ value: 'move', label: 'Move' }, { value: 'copy', label: 'Copy' }] },
  ];
  it('OK returns every value by key as numbers (a disabled field keeps its value, a choice its string)', () => {
    const onOk = vi.fn();
    render(<FieldsDialog title="Repeated copy" fields={fields} onOk={onOk} onCancel={() => {}} />);
    fireEvent.input(screen.getByLabelText('Distance'), { target: { value: '20.25' } });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'copy' } });
    fireEvent.click(screen.getByText('OK'));
    expect(onOk).toHaveBeenCalledWith({ number: 3, distance: 20.25, angle: 60, how: 'copy' });
  });
  it('rejects blanks, text, a fraction in a whole-number field and values below the minimum: OK stays disabled', () => {
    const onOk = vi.fn();
    render(<FieldsDialog title="t" fields={fields} onOk={onOk} onCancel={() => {}} />);
    const ok = screen.getByText('OK') as HTMLButtonElement;
    for (const [label, bad] of [['Distance', ''], ['Distance', 'abc'], ['Number of copies', '2.5'], ['Number of copies', '0']] as const) {
      fireEvent.input(screen.getByLabelText(label), { target: { value: bad } });
      expect(ok.disabled).toBe(true);
      fireEvent.click(ok);
      fireEvent.input(screen.getByLabelText(label), { target: { value: label === 'Distance' ? '1' : '2' } });
      expect(ok.disabled).toBe(false);
    }
    expect(onOk).not.toHaveBeenCalled();
  });
  it('Enter confirms, Escape cancels, and the keys do not reach the app shortcuts', () => {
    const onOk = vi.fn(), onCancel = vi.fn(), outer = vi.fn();
    document.addEventListener('keydown', outer);
    render(<FieldsDialog title="t" fields={fields} onOk={onOk} onCancel={onCancel} />);
    const input = screen.getByLabelText('Distance');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onOk).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'f' });
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener('keydown', outer);
  });
});
