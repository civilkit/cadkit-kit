import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { RestoreDialog, RecoverDialog, SaveAsDialog, DropOverlay } from './FileDialogs';
import { SamplesDialog } from '../SamplesDialog';
import { buildCommands, matchShortcut, type Actions } from '../commands';
import { dragHasFiles, planDrop } from './drop';
import '../i18n';

afterEach(cleanup);

describe('RestoreDialog', () => {
  it('names the part, says how long ago, and offers Restore and Start new; Escape does nothing', () => {
    const on = { onRestore: vi.fn(), onNew: vi.fn() };
    render(<RestoreDialog name="Bracket" savedAt={0} now={5 * 60_000} {...on} />);
    expect(screen.getByRole('alertdialog').textContent).toContain('"Bracket"');
    expect(screen.getByRole('alertdialog').textContent).toContain('5 min ago');
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByText('Restore'));
    fireEvent.click(screen.getByText('Start new'));
    expect([on.onRestore.mock.calls.length, on.onNew.mock.calls.length]).toEqual([1, 1]);
  });
});

describe('RecoverDialog', () => {
  const snap = (id: string, features: number, time: number) => ({ id, time, name: 'Bracket', features, reason: 'undo' as const, doc: { features: [] } });
  it('lists the kept versions with name, feature count and age, and restores the one clicked', async () => {
    const on = { onRestore: vi.fn(), onClose: vi.fn() };
    render(<RecoverDialog load={async () => [snap('b', 24, 60_000), snap('a', 3, 0)]} now={5 * 60_000} {...on} />);
    await screen.findByText(/24 features/);
    expect(screen.getByRole('dialog').textContent).toContain('Bracket: 24 features, 4 min ago');
    fireEvent.click(screen.getAllByText('Restore')[0]);
    expect(on.onRestore.mock.calls[0][0].id).toBe('b');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(on.onClose).toHaveBeenCalled();
  });
  it('says so when nothing is kept; the session dialog offers the versions', async () => {
    render(<RecoverDialog load={async () => []} onRestore={() => {}} onClose={() => {}} />);
    await screen.findByText('No earlier versions are kept yet.');
    cleanup();
    const onVersions = vi.fn();
    render(<RestoreDialog name="X" savedAt={0} now={1} onRestore={() => {}} onNew={() => {}} onVersions={onVersions} />);
    fireEvent.click(screen.getByText('Earlier versions…'));
    expect(onVersions).toHaveBeenCalled();
  });
});

describe('SaveAsDialog', () => {
  it('shows the file name that will be written, adds .ckpart and submits it', () => {
    const on = { onSave: vi.fn(), onCancel: vi.fn() };
    render(<SaveAsDialog initial="Part1" {...on} />);
    const input = screen.getByLabelText('File name') as HTMLInputElement;
    expect(input.value).toBe('Part1');
    fireEvent.input(input, { target: { value: 'Hinge' } });
    expect(screen.getByRole('dialog').textContent).toContain('Hinge.ckpart');
    fireEvent.submit(input.closest('form')!);
    expect(on.onSave).toHaveBeenCalledWith('Hinge.ckpart');
  });
  it('cannot submit an empty name; Cancel and Escape cancel', () => {
    const on = { onSave: vi.fn(), onCancel: vi.fn() };
    render(<SaveAsDialog initial="Part1" {...on} />);
    fireEvent.input(screen.getByLabelText('File name'), { target: { value: '  ' } });
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByLabelText('File name').closest('form')!);
    expect(on.onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Cancel'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(on.onCancel).toHaveBeenCalledTimes(2);
  });
});

describe('DropOverlay and drop planning', () => {
  it('renders the prompt', () => {
    render(<DropOverlay />);
    expect(document.querySelector('.drop-overlay')!.textContent).toContain('Drop a file to open it');
  });
  it('plans by file count and type, and only reacts to file drags', () => {
    expect(planDrop([])).toEqual({ action: 'none' });
    expect(planDrop(['a.ckpart', 'b.step'])).toEqual({ action: 'multiple' });
    expect(planDrop(['a.STP'])).toEqual({ action: 'open', kind: 'step', name: 'a.STP' });
    expect(planDrop(['x.png'])).toMatchObject({ kind: 'unknown' });
    expect(dragHasFiles({ types: ['Files'] })).toBe(true);
    expect(dragHasFiles({ types: ['text/plain'] })).toBe(false);
    expect(dragHasFiles(null)).toBe(false);
  });
});

describe('Recent section of the Samples dialog', () => {
  const samples = [{ id: 'bolt', title: 'Bolt', url: '/s/bolt' }];
  it('lists recent entries with their kind and picks one; hidden while filtering', () => {
    const onPickRecent = vi.fn();
    const recent = [{ kind: 'file' as const, id: 'a.ckpart', name: 'a.ckpart', at: Date.now(), handle: true }, { kind: 'sample' as const, id: 'bolt', name: 'Bolt', at: Date.now() - 3 * 3600_000, url: '/s/bolt' }];
    render(<SamplesDialog samples={samples} thumbBase="/" onPick={() => {}} onClose={() => {}} recent={recent} onPickRecent={onPickRecent} />);
    const block = screen.getByLabelText('Recent');
    expect(block.textContent).toContain('a.ckpart');
    expect(block.textContent).toContain('3 h ago');
    fireEvent.click(screen.getByText('a.ckpart'));
    expect(onPickRecent).toHaveBeenCalledWith(recent[0]);
    fireEvent.input(screen.getByPlaceholderText('Filter samples'), { target: { value: 'bol' } });
    expect(screen.queryByLabelText('Recent')).toBeNull();
  });
  it('shows a small lazy picture on each recent card (sample file, saved picture), and the category icon when there is none or it fails', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const recent = [
      { kind: 'file' as const, id: 'a.ckpart', name: 'a.ckpart', at: Date.now() },
      { kind: 'file' as const, id: 'gear.ckpart', name: 'gear.ckpart', at: Date.now() },
      { kind: 'sample' as const, id: 'bolt', name: 'Bolt', at: Date.now(), url: '/s/bolt' },
      { kind: 'sample' as const, id: 'gone', name: 'Gone', at: Date.now(), url: '/s/gone' },
    ];
    render(<SamplesDialog samples={samples} thumbBase="/app/" onPick={() => {}} onClose={() => {}} recent={recent} recentThumbs={{ 'a.ckpart': png }} />);
    fireEvent.input(screen.getByPlaceholderText('Filter samples'), { target: { value: '' } });   // the filter text outlives a close
    const block = screen.getByLabelText('Recent');
    const imgs = Array.from(block.querySelectorAll('img'));
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([png, '/app/samples/thumbs/bolt.webp', '/app/samples/thumbs/gone.webp']);
    expect(imgs.every((i) => i.getAttribute('loading') === 'lazy')).toBe(true);
    expect(block.querySelectorAll('[data-fallback]').length).toBe(1);   // gear.ckpart has no picture
    expect(block.querySelector('[data-fallback] svg[data-glyph="gear"]')).not.toBeNull();
    expect(block.querySelector('[data-fallback]')?.getAttribute('title')).toBe('No preview yet');
    fireEvent.error(imgs[2]);   // a sample thumbnail that does not load
    expect(block.querySelectorAll('[data-fallback]').length).toBe(2);
  });
  it('has no Recent section when there is nothing recent', () => {
    render(<SamplesDialog samples={samples} thumbBase="/" onPick={() => {}} onClose={() => {}} recent={[]} />);
    expect(screen.queryByLabelText('Recent')).toBeNull();
  });
});

describe('file commands', () => {
  const base: Actions = {
    open() {}, save() {}, samples() {}, undo() {}, redo() {}, palette() {}, toggleDrawer() {}, settings() {}, hasDocument: () => true, newPart() {}, toggleProjection() {}, sketchHere() {}, toggleLeftPanel() {}, sketchOnFace() {}, hasFaceSelection: () => false, addExtrude() {}, newSketch() {},
    setView() {}, fit() {}, setMode() {}, mode: () => 'face', toggleLayer() {}, layer: () => false,
  };
  it('Ctrl+Shift+S is Save as and Ctrl+S stays Save', () => {
    const saveAs = vi.fn(); const save = vi.fn();
    const cmds = buildCommands({ ...base, save, files: { saveAs, importStep() {}, recover() {} } });
    const ev = (o: Partial<KeyboardEvent>) => ({ key: 's', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...o });
    matchShortcut(cmds, ev({ metaKey: true, shiftKey: true }))!.run();
    matchShortcut(cmds, ev({ ctrlKey: true }))!.run();
    expect([saveAs.mock.calls.length, save.mock.calls.length]).toEqual([1, 1]);
    expect(cmds.find((c) => c.id === 'import-step')!.label).toBe('Import STEP / SolidWorks');
  });
  it('without file actions the commands are absent', () => {
    expect(buildCommands(base).some((c) => c.id === 'save-as')).toBe(false);
  });
});
