import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { FeatureTree } from '@kit/ui';
import { createStore } from '@kit/store';
import { useTreeInteraction } from './useTreeInteraction';
import { useSketchSessionGone, useEditorGone } from './sessionGone';
import { SketchAnnotations } from './SketchAnnotations';
import { treeKey } from './treeCommands';

afterEach(cleanup);

/** The shell's half of a sketch session, as main.tsx wires it: `sketching`, the annotations drawn only while it is set, and the
 *  hook that drops it when the controller's session is gone. The fake controller drops its session when the sketch is deleted. */
function setup(opts: { open: boolean; used?: boolean } = { open: true }) {
  const store = createStore();
  let features = [{ id: 'F1', type: 'sketch' }, ...(opts.used ? [{ id: 'F2', type: 'extrude', sketch: 'F1' }] : [])] as Array<{ id: string; type: string; sketch?: string }>;
  let draft: object | null = opts.open ? { points: [] } : null;
  const gone = vi.fn();
  const controller = {
    document: () => ({ name: 'Part', features }),
    sketchDraft: () => draft,
    deleteFeatures: vi.fn(async (ids: string[]) => {
      if (opts.used && !ids.includes('F2')) return { ok: false };
      features = features.filter((f) => !ids.includes(f.id));
      draft = null;   // the controller closes the session of a feature that is gone (see Controller.reconcileSketchSession)
      return { ok: true };
    }),
    undo: vi.fn(async () => { features = [{ id: 'F1', type: 'sketch' }]; }),
    redo: vi.fn(async () => {}), rebuild: vi.fn(async () => {}), setRollback: vi.fn(async () => {}), rollbackCount: () => null as number | null,
    setPartName: vi.fn(), pickableNames: () => [] as string[],
  };
  let api!: ReturnType<typeof useTreeInteraction>;
  function Harness() {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [, setN] = useState(0);
    const [sketching, setSketching] = useState<{ id: string } | null>(opts.open ? { id: 'F1' } : null);
    useSketchSessionGone(!!sketching, () => !!controller.sketchDraft(), () => { gone(); setSketching(null); });
    api = useTreeInteraction({
      controller: controller as never, store, viewport: () => null, selectedId, setSelectedId, setRefSel: () => {}, redraw: () => setN((n) => n + 1),
      edit: async () => {}, startEditing: () => {}, rows: () => features.map((f) => ({ id: f.id, type: f.type })), exportFolder: () => {}, extractFolder: () => {},
    });
    const items = [{ id: 'd1', text: '30 mm', kind: 'dimension' as const, x: 10, y: 10 }, { id: 'c1', text: 'H', kind: 'mark' as const, x: 20, y: 20 }];
    return (
      <div>
        <FeatureTree rows={features.map((f) => ({ id: f.id, type: f.type }))} status={[]} selectedId={selectedId} onMove={() => {}} {...api.treeProps} />
        {sketching ? <SketchAnnotations items={items} hot={null} onEdit={() => {}} onHover={() => {}} /> : null}
      </div>
    );
  }
  const r = render(<Harness />);
  const row = (id: string) => r.container.querySelector(`.row[data-id="${id}"]`) as HTMLElement | null;
  const chips = () => r.container.querySelectorAll('.sketch-annots .annot').length;
  return { store, controller, gone, row, chips, api: () => api, r };
}

describe('the shell drops its sketch overlay when the sketch is deleted', () => {
  it('(a, d) trash icon on the open sketch: the dimension and constraint chips are gone and the notice offers Undo', async () => {
    const w = setup();
    expect(w.chips()).toBe(2);
    await act(async () => { fireEvent.click(w.row('F1')!.querySelector('.row-del')!); });
    expect(w.controller.deleteFeatures).toHaveBeenCalledWith(['F1']);
    expect(w.chips()).toBe(0);
    expect(w.gone).toHaveBeenCalledTimes(1);
    expect(w.store.notices.value.at(-1)!.text).toBe('Deleted F1');
    expect(w.store.notices.value.at(-1)!.action!.label).toBe('Undo');
  });

  it('(d) the context menu Delete does the same', async () => {
    const w = setup();
    fireEvent.click(w.row('F1')!);
    fireEvent.contextMenu(w.row('F1')!);
    expect(w.api().menu).not.toBeNull();
    await act(async () => { w.api().runMenu('delete'); });
    expect(w.controller.deleteFeatures).toHaveBeenCalledWith(['F1']);
    expect(w.chips()).toBe(0);
  });

  it('(d) the Delete key does not delete features while a sketch is open (it deletes sketch entities); with no sketch open it deletes the selected feature', async () => {
    const open = setup();
    fireEvent.click(open.row('F1')!);
    const a = open.api().actions;
    expect(treeKey({ key: 'Backspace', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }, a, true)).toBe(false);
    expect(open.controller.deleteFeatures).not.toHaveBeenCalled();
    expect(open.chips()).toBe(2);
    cleanup();
    const idle = setup({ open: false });
    fireEvent.click(idle.row('F1')!);
    await act(async () => { idle.api().actions.deleteSelected(); });
    expect(idle.controller.deleteFeatures).toHaveBeenCalledWith(['F1']);
    expect(idle.gone).not.toHaveBeenCalled();
  });

  it('(b) a finished sketch has no shell session: deleting it never runs the close path', async () => {
    const w = setup({ open: false });
    expect(w.chips()).toBe(0);
    fireEvent.click(w.row('F1')!);
    await act(async () => { w.api().actions.deleteSelected(); });
    expect(w.gone).not.toHaveBeenCalled();
  });

  it('(e) Undo from the notice restores the sketch row without reopening the overlay', async () => {
    const w = setup();
    fireEvent.click(w.row('F1')!);
    await act(async () => { w.api().actions.deleteSelected(); });
    await act(async () => { w.store.notices.value.at(-1)!.action!.run(); });
    expect(w.controller.undo).toHaveBeenCalled();
    expect(w.row('F1')).not.toBeNull();
    expect(w.chips()).toBe(0);
    expect(w.gone).toHaveBeenCalledTimes(1);
  });

  it('(f) a refused delete (the sketch is used) keeps the session and its chips; deleting both closes it', async () => {
    const w = setup({ open: true, used: true });
    fireEvent.click(w.row('F1')!);
    await act(async () => { w.api().actions.deleteSelected(); });
    expect(w.chips()).toBe(2);
    expect(w.gone).not.toHaveBeenCalled();
    fireEvent.click(w.row('F1')!);
    fireEvent.click(w.row('F2')!, { ctrlKey: true });
    await act(async () => { w.api().actions.deleteSelected(); });
    expect(w.controller.deleteFeatures).toHaveBeenLastCalledWith(['F1', 'F2']);
    expect(w.chips()).toBe(0);
  });
});

describe('an open feature editor closes when its feature is deleted', () => {
  function Ed(p: { id: string | null; exists: boolean; on(): void }) { useEditorGone(p.id, p.exists, true, p.on); return null; }

  it('(c) the Extrude editor of a deleted extrude (or one whose sketch went with it) closes once', () => {
    const on = vi.fn();
    const r = render(<Ed id="F2" exists on={on} />);
    expect(on).not.toHaveBeenCalled();
    r.rerender(<Ed id="F2" exists={false} on={on} />);
    expect(on).toHaveBeenCalledTimes(1);
    r.rerender(<Ed id="F2" exists={false} on={on} />);
    expect(on).toHaveBeenCalledTimes(1);
  });

  it('an editor opened ahead of its feature is not closed', () => {
    const on = vi.fn();
    render(<Ed id="F9" exists={false} on={on} />);
    expect(on).not.toHaveBeenCalled();
  });
});
