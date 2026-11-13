// The tree row menu of "Fasten this hole": a Hole feature and a pattern of holes offer it, other rows do not.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { FeatureTree } from '@kit/ui';
import { createStore } from '@kit/store';
import { ContextMenu } from './ContextMenu';
import { useTreeInteraction } from './useTreeInteraction';
import './i18n';

afterEach(cleanup);

const features = [
  { id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude', sketch: 'F1' }, { id: 'F3', type: 'sketch' }, { id: 'F4', type: 'hole', sketch: 'F3' },
  { id: 'F5', type: 'lpattern', seeds: ['F4'] },
];
function setup(holeIds: string[]) {
  const store = createStore();
  const fasten = vi.fn();
  function Harness() {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const rows = features.map((f) => ({ id: f.id, type: f.type }));
    const api = useTreeInteraction({
      controller: { document: () => ({ name: 'Part', features }), sketchDraft: () => null, rollbackCount: () => null } as never,
      store, viewport: () => null, selectedId, setSelectedId, setRefSel: () => {}, redraw: () => {}, edit: async () => {}, startEditing: () => {}, rows: () => rows,
      exportFolder: () => {}, extractFolder: () => {}, canFastenHole: (id) => holeIds.includes(id), fastenHole: fasten,
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
  const menuRow = (label: string) => [...r.container.querySelectorAll('.ctx-row')].find((e) => e.textContent?.startsWith(label)) as HTMLElement | undefined;
  return { row, menuRow, fasten };
}

describe('the tree menu of a hole', () => {
  it('a Hole feature and a pattern of holes offer Add fastener to hole, and it opens the dialog on that row', async () => {
    const w = setup(['F4', 'F5']);
    for (const id of ['F4', 'F5']) {
      fireEvent.contextMenu(w.row(id));
      const item = w.menuRow('Add fastener to hole')!;
      expect(item, id).toBeTruthy();
      expect(item.getAttribute('aria-disabled')).toBe('false');
      await act(async () => { fireEvent.click(item); });
      expect(w.fasten).toHaveBeenLastCalledWith(id);
    }
    expect(w.fasten).toHaveBeenCalledTimes(2);
  });
  it('other rows do not offer it (an extrude, a sketch, a pattern of something else)', () => {
    const w = setup(['F4']);
    for (const id of ['F1', 'F2', 'F5']) { fireEvent.contextMenu(w.row(id)); expect(w.menuRow('Add fastener to hole'), id).toBeUndefined(); }
  });
});
