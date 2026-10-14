import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { DiscardDialog } from './DiscardDialog';
import './i18n';

afterEach(cleanup);
describe('DiscardDialog', () => {
  it('names the part and offers Cancel, Don\'t save and Save; Escape cancels', () => {
    const on = { onSave: vi.fn(), onDiscard: vi.fn(), onCancel: vi.fn() };
    render(<DiscardDialog name="Bracket" {...on} />);
    expect(screen.getByRole('alertdialog').textContent).toContain('"Bracket"');
    fireEvent.click(screen.getByText('Save'));
    fireEvent.click(screen.getByText("Don't save"));
    fireEvent.click(screen.getByText('Cancel'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect([on.onSave.mock.calls.length, on.onDiscard.mock.calls.length, on.onCancel.mock.calls.length]).toEqual([1, 1, 2]);
  });
});
