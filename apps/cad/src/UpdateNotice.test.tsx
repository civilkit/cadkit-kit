import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import './files/strings';
import { UpdateNotice } from './UpdateNotice';
import { UpdateRow } from './SettingsDialog';

afterEach(cleanup);

describe('UpdateNotice', () => {
  it('names the version and offers Reload and Later', () => {
    const onReload = vi.fn(), onLater = vi.fn();
    render(<UpdateNotice version="0.6.5" onReload={onReload} onLater={onLater} />);
    expect(screen.getByRole('status').textContent).toContain('A new version (0.6.5) is available.');
    expect(screen.queryByText(/unsaved changes/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(onReload).toHaveBeenCalledTimes(1); expect(onLater).toHaveBeenCalledTimes(1);
  });
  it('shows the generic text when the version is unknown', () => {
    render(<UpdateNotice onReload={() => {}} onLater={() => {}} />);
    expect(screen.getByRole('status').textContent).toContain('A new version is available.');
  });
  it('says to save first when there are unsaved changes', () => {
    render(<UpdateNotice version="0.6.5" dirty onReload={() => {}} onLater={() => {}} />);
    expect(screen.getByRole('status').textContent).toContain('You have unsaved changes: save first, then reload.');
  });
});

describe('Settings update row', () => {
  it('shows the answer and the time of the check', async () => {
    const check = vi.fn().mockResolvedValueOnce({ state: 'latest' }).mockResolvedValueOnce({ state: 'newer', version: '0.7.0' });
    render(<UpdateRow check={check} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('You have the latest version'));
    expect(screen.getByRole('status').textContent).toContain('Last checked:');
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Version 0.7.0 is available'));
  });
  it('without a version number it still says a newer one is available', async () => {
    render(<UpdateRow check={async () => ({ state: 'newer' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('A newer version is available'));
  });
  it('says so when the check could not be made', async () => {
    render(<UpdateRow check={async () => ({ state: 'unknown' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Could not check for updates'));
  });
});
