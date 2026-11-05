import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { KnurlExportAsk, KnurlExportFailed } from './KnurlExportDialog';
import './i18n';

afterEach(cleanup);
describe('KnurlExportAsk', () => {
  it('names the count and offers include, without and cancel; the tick is sent with include and without, never with cancel', () => {
    const onAnswer = vi.fn();
    render(<KnurlExportAsk count={2} onAnswer={onAnswer} />);
    expect(screen.getByRole('alertdialog').textContent).toContain('2 cosmetic knurl(s)');
    fireEvent.click(screen.getByText('Include the knurls'));
    expect(onAnswer).toHaveBeenLastCalledWith({ choice: 'include', remember: false });
    fireEvent.click(screen.getByLabelText(/Do not ask again/));
    fireEvent.click(screen.getByText('Export without'));
    expect(onAnswer).toHaveBeenLastCalledWith({ choice: 'plain', remember: true });
    fireEvent.click(screen.getByText('Include the knurls'));
    expect(onAnswer).toHaveBeenLastCalledWith({ choice: 'include', remember: true });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onAnswer).toHaveBeenLastCalledWith({ choice: 'cancel', remember: false });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onAnswer).toHaveBeenLastCalledWith({ choice: 'cancel', remember: false });
  });
});
describe('KnurlExportFailed', () => {
  it('gives the reason and offers the plain export or cancel (Escape cancels); a time limit says so', () => {
    const onChoose = vi.fn();
    const { unmount } = render(<KnurlExportFailed reason="failed" message="the cut removed nothing" onChoose={onChoose} />);
    expect(screen.getByRole('alertdialog').textContent).toContain('the cut removed nothing');
    expect(screen.getByRole('alertdialog').textContent).toContain('The open part is unchanged');
    fireEvent.click(screen.getByText('Export without the knurl'));
    expect(onChoose).toHaveBeenLastCalledWith('plain');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onChoose).toHaveBeenLastCalledWith('cancel');
    unmount();
    render(<KnurlExportFailed reason="timeout" message="the cutting took more than 120 s" onChoose={onChoose} />);
    expect(screen.getByRole('alertdialog').textContent).toContain('took too long');
    fireEvent.click(screen.getByText('Cancel'));
    expect(onChoose).toHaveBeenLastCalledWith('cancel');
  });
});
