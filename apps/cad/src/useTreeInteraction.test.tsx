import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { FeatureTree } from '@kit/ui';
import { createStore } from '@kit/store';
import type { EditOp } from '@ck/session';
import { useTreeInteraction } from './useTreeInteraction';
import type { TreeActions } from './treeCommands';

afterEach(cleanup);

const features = [
  { id: 'F1', type: 'sketch' },
  { id: 'F2', type: 'extrude', sketch: 'F1' },
  { id: 'F3', type: 'fillet', edges: ['F2.E1'] },
  { id: 'F4', type: 'sketch', plane: { kind: 'face', id: 'F2.C1' } },
];

function setup() {
  const store = createStore();
  const edits: EditOp[][] = [];
  const started: string[] = [];
  const controller = {
    document: () => ({ name: 'Part', features }),
    sketchDraft: () => null,
    deleteFeatures: vi.fn(async () => ({ ok: true })),
    undo: vi.fn(async () => {}),
    redo: vi.fn(async () => {}),
    rebuild: vi.fn(async () => {}),
    setRollback: vi.fn(async () => {}),
    rollbackCount: () => null as number | null,
    setPartName: vi.fn(),
    pickableNames: (m: string) => [`${m}1`, `${m}2`],
  };
  let api!: ReturnType<typeof useTreeInteraction>;
  const orbit = vi.fn();
  const setRefSel = vi.fn();
  function Harness() {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    api = useTreeInteraction({
      controller: controller as never, store, viewport: () => ({ orbitBy: orbit, panBy: vi.fn() }), selectedId, setSelectedId, setRefSel, redraw: () => {},
      edit: async (ops) => { edits.push(ops); }, startEditing: (id) => started.push(id), rows: () => features.map((f) => ({ id: f.id, type: f.type })), exportFolder: () => {}, extractFolder: () => {},
    });
    return <FeatureTree rows={features.map((f) => ({ id: f.id, type: f.type }))} status={[]} selectedId={selectedId} onMove={() => {}} {...api.treeProps} />;
  }
  const r = render(<Harness />);
  const row = (id: string) => r.container.querySelector(`.row[data-id="${id}"]`) as HTMLElement;
  return { setRefSel, store, edits, started, controller, orbit, row, r, act: () => api.actions as TreeActions, api: () => api };
}

describe('tree interaction in the app', () => {
  it('selecting a feature row drops the chosen Front / Top / Right row', () => {
    const t = setup();
    fireEvent.click(t.row('F2'));
    expect(t.setRefSel).toHaveBeenCalledWith(null);
  });

  it('Ctrl-click adds to the selection, Shift-click takes a range, and dependents are marked', () => {
    const w = setup();
    fireEvent.click(w.row('F1'));
    expect(w.api().selected).toEqual(['F1']);
    expect(w.row('F2').className).toContain('dep');
    fireEvent.click(w.row('F3'), { ctrlKey: true });
    expect(w.api().selected).toEqual(['F1', 'F3']);
    fireEvent.click(w.row('F4'), { shiftKey: true });
    expect(w.api().selected).toEqual(['F3', 'F4']);   // range from the last ctrl-click
    fireEvent.click(w.row('F2'));
    expect(w.api().selected).toEqual(['F2']);
    expect([...w.r.container.querySelectorAll('.row.dep')].map((x) => x.getAttribute('data-id'))).toEqual(['F3', 'F4']);   // fillet on its edge, sketch on its face
  });

  it('delete removes all selected and shows an Undo toast that undoes', async () => {
    const w = setup();
    fireEvent.click(w.row('F3'));
    fireEvent.click(w.row('F4'), { ctrlKey: true });
    await act(async () => { w.act().deleteSelected(); });
    expect(w.controller.deleteFeatures).toHaveBeenCalledWith(['F3', 'F4']);
    const n = w.store.notices.value.at(-1)!;
    expect(n.text).toBe('Deleted F3, F4');
    expect(n.action!.label).toBe('Undo');
    await act(async () => { n.action!.run(); });
    expect(w.controller.undo).toHaveBeenCalled();
  });

  it('a row button on a member of a multi-selection acts on the whole selection', async () => {
    const w = setup();
    fireEvent.click(w.row('F3'));
    fireEvent.click(w.row('F4'), { ctrlKey: true });
    await act(async () => { fireEvent.click(w.row('F4').querySelector('.row-sup')!); });
    expect(w.edits[0]).toEqual([{ op: 'set', id: 'F3', path: 'suppressed', value: true }, { op: 'set', id: 'F4', path: 'suppressed', value: true }]);
  });

  it('F2 renames the selected feature through a set name edit', async () => {
    const w = setup();
    fireEvent.click(w.row('F2'));
    await act(async () => { w.act().rename(); });
    const input = w.r.container.querySelector('input.inline-name') as HTMLInputElement;
    input.value = 'Base';
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(w.edits).toEqual([[{ op: 'set', id: 'F2', path: 'name', value: 'Base' }, { op: 'set', id: 'F2', path: 'autoName', value: false }]]);
  });

  it('F2 with nothing selected renames the part in the top bar', async () => {
    const w = setup();
    await act(async () => { w.act().rename(); });
    expect(w.api().topRename.active).toBe(true);
    act(() => w.api().topRename.commit('Hinge'));
    expect(w.controller.setPartName).toHaveBeenCalledWith('Hinge');
  });

  it('double-click on a face opens the editor of its feature and selects it', () => {
    const w = setup();
    act(() => w.api().onBodyDouble('F2.C1'));
    expect(w.started).toEqual(['F2']);
    expect(w.api().selected).toEqual(['F2']);
    act(() => w.api().onBodyDouble('Front'));
    act(() => w.api().onBodyDouble('F99.C1'));
    expect(w.started).toEqual(['F2']);
  });

  it('Escape clears the model and tree selection and reports whether it did anything', () => {
    const w = setup();
    expect(w.act().clearSelection()).toBe(false);
    w.store.select(['F2.C1']);
    expect(w.act().clearSelection()).toBe(true);
    expect(w.store.selection.value).toEqual([]);
    fireEvent.click(w.row('F2'));
    let did = false;
    act(() => { did = w.act().clearSelection(); });
    expect(did).toBe(true);
    expect(w.api().selected).toEqual([]);
  });

  it('select all picks every name of the current selection mode; rebuild and roll forward go to the controller; arrows orbit', async () => {
    const w = setup();
    w.store.mode.value = 'edge';
    w.act().selectAll();
    expect(w.store.selection.value).toEqual(['edge1', 'edge2']);
    await act(async () => { w.act().rebuild(); w.act().rollForward(); });
    expect(w.controller.rebuild).toHaveBeenCalled();
    expect(w.controller.setRollback).toHaveBeenCalledWith(null);
    w.act().orbit(10, 0);
    expect(w.orbit).toHaveBeenCalledWith(10, 0);
  });
});
