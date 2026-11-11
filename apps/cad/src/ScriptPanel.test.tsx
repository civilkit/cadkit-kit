import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { ScriptPanel } from './ScriptPanel';

afterEach(cleanup);
describe('ScriptPanel', () => {
  it('shows line numbers and runs the code on Ctrl+Enter, listing errors', async () => {
    const onRun = vi.fn().mockResolvedValue([{ line: 2, message: 'boom' }]);
    render(<ScriptPanel saved={'a\nb\nc'} onRun={onRun} />);
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.value).toBe('a\nb\nc');
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await vi.waitFor(() => expect(screen.getByText('Line 2: boom')).toBeTruthy());
    expect(onRun).toHaveBeenCalledWith('a\nb\nc', expect.anything());
  });
  it('loads an example into the box', () => {
    render(<ScriptPanel saved="" onRun={async () => []} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'box' } });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('Thin box');
  });
});

describe('ScriptPanel errors and focus', () => {
  it('shows a run error as a banner with the message and line, marks the line, and keeps it until the next Run', async () => {
    let n = 0;
    const onRun = vi.fn(async () => (n++ === 0 ? [{ line: 2, message: "'plane' is a script API helper" }] : []));
    const { container } = render(<ScriptPanel saved={'a\nb\nc'} onRun={onRun} />);
    fireEvent.click(screen.getByText('Run'));
    const banner = await screen.findByTestId('script-error-banner');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain("Line 2: 'plane' is a script API helper");
    expect(container.querySelector('.script-band[data-line="2"]')).toBeTruthy();
    // unrelated edits do not clear it
    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'a\nb\nc\nd' } });
    expect(screen.queryByTestId('script-error-banner')).toBeTruthy();
    fireEvent.click(screen.getByText('Run'));
    await vi.waitFor(() => expect(screen.queryByTestId('script-error-banner')).toBeNull());
    expect(container.querySelector('.script-band')).toBeNull();
  });
  it('focuses the editor when the tab opens and returns focus to it after Run', async () => {
    render(<ScriptPanel saved="a" onRun={async () => []} />);
    const box = screen.getByRole('textbox');
    expect(document.activeElement).toBe(box);
    const run = screen.getByText('Run');
    run.focus();
    expect(document.activeElement).toBe(run);
    fireEvent.click(run);
    await vi.waitFor(() => expect(document.activeElement).toBe(box));
  });
  it('keeps the banner when the run stores the code it ran as the document script', async () => {
    const onRun = vi.fn(async () => [{ line: 1, message: 'bad' }]);
    const { rerender } = render(<ScriptPanel saved="" onRun={onRun} />);
    fireEvent.click(screen.getByText('Run'));
    await screen.findByTestId('script-error-banner');
    rerender(<ScriptPanel saved={(screen.getByRole('textbox') as HTMLTextAreaElement).value} onRun={onRun} />);   // same script text comes back through `saved`
    expect(screen.queryByTestId('script-error-banner')).toBeTruthy();
    rerender(<ScriptPanel saved="other file" onRun={onRun} />);   // another document's script replaces the box and its errors
    expect(screen.queryByTestId('script-error-banner')).toBeNull();
  });
});

describe('ScriptPanel result rows', () => {
  it('shows the run result and a pass / fail row per check, and clears them on the next Run', async () => {
    let n = 0;
    const onRun = vi.fn(async () => (n++ === 0
      ? { errors: [{ line: 2, message: 'expected volume 25000, got 24000 (tolerance 1e-6 relative)' }], checks: [{ line: 1, ok: true, message: 'volume 24000 (1e-6)' }, { line: 2, ok: false, message: 'expected volume 25000, got 24000 (tolerance 1e-6 relative)' }], features: 2 }
      : { errors: [], checks: [{ line: 1, ok: true, message: 'volume 24000 (1e-6)' }], features: 2 }));
    render(<ScriptPanel saved={'a\nb'} onRun={onRun} />);
    fireEvent.click(screen.getByText('Run'));
    const rows = await screen.findByTestId('script-checks');
    expect(rows.querySelectorAll('li.pass')).toHaveLength(1);
    expect(rows.querySelectorAll('li.fail')).toHaveLength(1);
    expect(screen.getByTestId('script-error-banner').textContent).toContain('expected volume 25000');
    expect(screen.queryByTestId('script-ok')).toBeNull();
    fireEvent.click(screen.getByText('Run'));
    const ok = await screen.findByTestId('script-ok');
    expect(ok.textContent).toContain('2 features');
    expect(screen.queryByTestId('script-error-banner')).toBeNull();
    expect(screen.getByTestId('script-checks').querySelectorAll('li.fail')).toHaveLength(0);
  });
  it('shows a report the app hands over later (a Run that opened another tab remounted the panel)', async () => {
    const { rerender } = render(<ScriptPanel saved="a" onRun={async () => []} />);
    expect(screen.queryByTestId('script-error-banner')).toBeNull();
    rerender(<ScriptPanel saved="a" onRun={async () => []} initial={{ errors: [{ line: 1, message: 'late' }], checks: [{ line: 1, ok: false, message: 'late' }], ran: null }} />);
    expect((await screen.findByTestId('script-error-banner')).textContent).toContain('late');
    expect(screen.getByTestId('script-checks').querySelectorAll('li.fail')).toHaveLength(1);
  });
});
