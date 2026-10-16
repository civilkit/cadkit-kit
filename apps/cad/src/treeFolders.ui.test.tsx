import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';
import { FeatureTree } from '@kit/ui';
import { createStore } from '@kit/store';
import type { EditOp } from '@ck/session';
import { ContextMenu } from './ContextMenu';
import { useTreeInteraction } from './useTreeInteraction';

afterEach(cleanup);

type F = { id: string; type: string; group?: string; [k: string]: unknown };
const start = (): F[] => [
  { id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude', sketch: 'F1' },
  { id: 'F3', type: 'sketch' }, { id: 'F4', type: 'extrude', sketch: 'F3' },
  { id: 'F5', type: 'sketch' }, { id: 'F6', type: 'extrude', sketch: 'F5' },
  { id: 'F7', type: 'hole' },   // uses nothing: free to move
];
function apply(fs: F[], ops: EditOp[]): F[] {
  let out = fs.map((f) => ({ ...f }));
  for (const o of ops) {
    if (o.op === 'move') { const i = out.findIndex((f) => f.id === o.id); const [f] = out.splice(i, 1); out.splice(o.to, 0, f); }
    else if (o.op === 'set') out = out.map((f) => (f.id === o.id ? { ...f, [o.path]: o.value } : f));
    else if (o.op === 'replace') out = out.map((f) => (f.id === o.id ? ({ ...o.feature, id: o.id } as F) : f));
  }
  return out;
}

function setup() {
  const store = createStore();
  const notify = vi.spyOn(store, 'notify');
  const edits: EditOp[][] = [];
  let api!: ReturnType<typeof useTreeInteraction>;
  let current: F[] = start();
  function Harness() {
    const [features, setFeatures] = useState<F[]>(current);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const ref = useRef(features); ref.current = features;
    const rows = features.map((f) => ({ id: f.id, type: f.type, group: f.group, uses: typeof f.sketch === 'string' ? [f.sketch] : undefined }));
    api = useTreeInteraction({
      controller: { document: () => ({ name: 'Part', features: current }), sketchDraft: () => null, rollbackCount: () => null, deleteFeatures: vi.fn(async () => ({ ok: true })), undo: vi.fn(), setPartName: vi.fn(),
        applyDocPatch: async (patch: { order?: string[]; features?: Record<string, F> }) => {
          edits.push([{ op: 'replace', id: '@patch', feature: patch as never }]);
          const next = current.map((f) => patch.features?.[f.id] ?? f);
          current = patch.order ? patch.order.map((id) => next.find((f) => f.id === id)!) : next; setFeatures(current);
          return { ok: true };
        } } as never,
      store, viewport: () => null, selectedId, setSelectedId, setRefSel: () => {}, redraw: () => {},
      edit: async (ops) => { edits.push(ops); current = apply(ref.current, ops); setFeatures(current); }, startEditing: () => {}, rows: () => rows,
    });
    return (
      <div>
        <FeatureTree rows={rows} status={[]} selectedId={selectedId} onMove={() => {}} {...api.treeProps} />
        {api.menu ? <ContextMenu x={api.menu.x} y={api.menu.y} items={api.menu.items} onRun={api.runMenu} onClose={api.closeMenu} /> : null}
      </div>
    );
  }
  const r = render(<Harness />);
  const row = (id: string) => r.container.querySelector(`.row[data-id="${id}"]`) as HTMLElement;
  const folder = (name: string) => r.container.querySelector(`.row.folder[data-group="${name}"]`) as HTMLElement | null;
  const menuRow = (label: string) => [...r.container.querySelectorAll('.ctx-row')].find((e) => e.textContent?.startsWith(label)) as HTMLElement | undefined;
  const feats = () => current;
  /** The name field of a row or folder in rename mode (it appears a render after the edit lands). */
  const field = () => waitFor(() => { const i = r.container.querySelector('input.inline-name'); if (!i) throw new Error('no field'); return i as HTMLInputElement; });
  return { r, row, folder, menuRow, field, feats, edits, notify, api: () => api };
}

describe('folders in the tree', () => {
  it('right click on a selection offers Group into folder; the new folder is in rename mode and takes a name', async () => {
    const w = setup();
    fireEvent.click(w.row('F2'));
    fireEvent.click(w.row('F4'), { ctrlKey: true });
    fireEvent.contextMenu(w.row('F4'));
    const item = w.menuRow('Group into folder')!;
    expect(item.getAttribute('aria-disabled')).toBe('false');
    await act(async () => { fireEvent.click(item); });
    expect(w.edits).toHaveLength(1);   // one edit, so one undo step
    expect(w.folder('Folder')).not.toBeNull();
    const input = await w.field();
    expect(input.value).toBe('Folder');
    input.value = 'Body';
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(w.folder('Body')).not.toBeNull();
    expect(w.feats().filter((f) => f.group === 'Body').map((f) => f.id)).toEqual(['F1', 'F2', 'F3', 'F4']);
    expect(w.edits).toHaveLength(2);
  });

  it('the keyboard command groups the selection and numbers a taken name', async () => {
    const w = setup();
    fireEvent.click(w.row('F2')); fireEvent.click(w.row('F4'), { ctrlKey: true });
    await act(async () => { w.api().actions.groupSelected(); });
    expect(w.folder('Folder')).not.toBeNull();
    fireEvent.keyDown(await w.field(), { key: 'Escape' });
    fireEvent.click(w.row('F6'));
    fireEvent.click(w.row('F4'), { ctrlKey: true });   // F4 is in Folder; F4 + F6 are neighbours
    await act(async () => { w.api().actions.groupSelected(); });
    expect(w.folder('Folder 2')).not.toBeNull();
  });

  it('refuses rows that are not next to each other, with a message and no edit', async () => {
    const w = setup();
    fireEvent.click(w.row('F2')); fireEvent.click(w.row('F6'), { ctrlKey: true });
    fireEvent.contextMenu(w.row('F6'));
    expect(w.menuRow('Group into folder')!.getAttribute('aria-disabled')).toBe('true');
    await act(async () => { w.api().actions.groupSelected(); });
    expect(w.edits).toHaveLength(0);
    expect(w.notify.mock.calls.at(-1)?.[1]).toBe('warn');
  });

  it('renames a folder by double click, and Escape leaves the name', async () => {
    const w = setup();
    fireEvent.click(w.row('F2')); fireEvent.click(w.row('F4'), { ctrlKey: true });
    await act(async () => { w.api().actions.groupSelected(); });
    fireEvent.keyDown(await w.field(), { key: 'Escape' });
    await waitFor(() => expect(w.r.container.querySelector('input.inline-name')).toBeNull());
    fireEvent.dblClick(w.folder('Folder')!);
    const input = await w.field();
    input.value = 'Plates';
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(w.folder('Plates')).not.toBeNull();
    expect(w.folder('Folder')).toBeNull();
  });

  it('Ungroup from the folder menu removes the folder and keeps the features where they are', async () => {
    const w = setup();
    fireEvent.click(w.row('F2')); fireEvent.click(w.row('F4'), { ctrlKey: true });
    await act(async () => { w.api().actions.groupSelected(); });
    fireEvent.keyDown(await w.field(), { key: 'Escape' });
    fireEvent.contextMenu(w.folder('Folder')!);
    expect(w.menuRow('Delete folder')).toBeDefined();
    await act(async () => { fireEvent.click(w.menuRow('Ungroup')!); });
    expect(w.folder('Folder')).toBeNull();
    expect(w.feats().map((f) => f.id)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7']);
    expect(w.feats().some((f) => 'group' in f)).toBe(false);
  });

  it('dragging a row onto a folder puts it in the folder', async () => {
    const w = setup();
    fireEvent.click(w.row('F2')); fireEvent.click(w.row('F4'), { ctrlKey: true });
    await act(async () => { w.api().actions.groupSelected(); });
    fireEvent.keyDown(await w.field(), { key: 'Escape' });
    await act(async () => { fireEvent.dragStart(w.row('F7')); fireEvent.drop(w.folder('Folder')!); });
    expect(w.feats().filter((f) => f.group === 'Folder').map((f) => f.id)).toEqual(['F1', 'F2', 'F3', 'F4', 'F7']);
  });

  it('dragging a row out of its folder onto a row outside it', async () => {
    const w = setup();
    fireEvent.click(w.row('F4')); fireEvent.click(w.row('F6'), { ctrlKey: true }); fireEvent.click(w.row('F7'), { ctrlKey: true });
    await act(async () => { w.api().actions.groupSelected(); });
    fireEvent.keyDown(await w.field(), { key: 'Escape' });
    // F7 is the end of the folder and uses nothing; F2 is above and outside it
    await act(async () => { fireEvent.dragStart(w.row('F7')); fireEvent.drop(w.row('F2')); });
    expect(w.feats().find((f) => f.id === 'F7')!.group).toBeUndefined();
    expect(w.feats().map((f) => f.id).join(' ')).toBe('F7 F1 F2 F3 F4 F5 F6');
    expect(w.feats().filter((f) => f.group === 'Folder').map((f) => f.id)).toEqual(['F3', 'F4', 'F5', 'F6']);
  });
});
