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
    expect(onRun).toHaveBeenCalledWith('a\nb\nc');
  });
  it('loads an example into the box', () => {
    render(<ScriptPanel saved="" onRun={async () => []} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'box' } });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('Thin box');
  });
});
