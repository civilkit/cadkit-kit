import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, cleanup, waitFor, act } from '@testing-library/preact';
import type { PartDoc } from '@ck/part-model';
import { useSheet, withDraft } from './useSheet';
import type { SheetActions } from './sheetCommands';
import type { FlatPattern, SheetEntry } from './model';
import '../i18n';

afterEach(cleanup);

const FLAT: FlatPattern = {
  rule: 'Steel2', thickness: 2, kFactor: 0.44, flatSize: [100, 76.5, 2], outline: [[[0, 0], [100, 0], [100, 76.5], [0, 76.5]]],
  bends: [{ bend: 1, direction: 'up', angleDeg: 90, includedAngleDeg: 90, radius: 2, allowance: 4.5, length: 100, start: [0, 2], end: [100, 2] }], bendZones: [], unfolded: false,
};
const ENTRY: SheetEntry = { id: 'E1', type: 'edgeFlange', flatPattern: FLAT };
const DOC = { name: 'Plate', features: [{ type: 'baseFlange', id: 'B1' }, { type: 'edgeFlange', id: 'E1', height: 20, flip: true }] } as unknown as PartDoc;

describe('withDraft', () => {
  it('applies the open editor\'s draft to its feature; a null removes the field', () => {
    const d = withDraft(DOC, 'E1', { height: 30, flip: null }) as unknown as { features: Array<Record<string, unknown>> };
    expect(d.features[1]).toEqual({ type: 'edgeFlange', id: 'E1', height: 30 });
    expect(d.features[0]).toEqual({ type: 'baseFlange', id: 'B1' });
    expect(withDraft(DOC, null, { height: 1 })).toBe(DOC);
    expect(withDraft(DOC, 'E1', {})).toBe(DOC);
  });
});

function host(over: { editingId?: string | null; draft?: Record<string, unknown> } = {}) {
  const controller = {
    sheetMetal: vi.fn(async () => [ENTRY]),
    sheetRequest: vi.fn(async (msg: { type: string }) => (msg.type === 'sheetDxf' ? { dxf: '0\nSECTION', bends: 1, bounds: [0, 0, 1, 1], entities: {} } : { format: 'csv', text: 'body,rule', bends: 1 })),
    document: () => DOC,
    edit: vi.fn(async () => ({ ok: true })),
    rejection: () => null,
  };
  const saved: Array<[string, string, string]> = [];
  const notes: string[] = [];
  let actions!: SheetActions;
  function H(p: typeof over) {
    const s = useSheet({
      controller: controller as never, doc: DOC, editingId: p.editingId ?? null, draft: p.draft ?? {}, context: () => ({ doc: DOC, selection: [], mode: 'face', box: null, edges: [] }),
      create: () => {}, startEditing: () => {}, redraw: () => {}, notify: (t) => notes.push(t), save: async (n, d, m) => { saved.push([n, d, m]); },
    });
    actions = s.actions;
    return <>{s.nodes}<span data-testid="flag">{String(s.isSheet)}</span></>;
  }
  const r = render(<H {...over} />);
  return { ...r, controller, saved, notes, actions: () => actions, rerender: (p: typeof over) => r.rerender(<H {...p} />) };
}

describe('useSheet', () => {
  it('knows a part with a base flange is sheet metal', () => {
    expect(host().getByTestId('flag').textContent).toBe('true');
  });
  it('the flat pattern view opens from the command, shows the pattern of the document and closes', async () => {
    const h = host();
    expect(h.container.querySelector('[data-testid="sheet-flat"]')).toBeNull();
    act(() => h.actions().flatView());
    await waitFor(() => expect(h.container.querySelector('[data-testid="sheet-flat-svg"]')).not.toBeNull());
    expect(h.controller.sheetMetal).toHaveBeenCalledWith(DOC);
    expect(h.actions().flatViewOpen?.()).toBe(true);
    fireEvent.click(h.container.querySelector('[data-act="close"]')!);
    expect(h.container.querySelector('[data-testid="sheet-flat"]')).toBeNull();
  });
  it('the open view follows the editor\'s draft', async () => {
    const h = host({ editingId: 'E1', draft: { height: 30 } });
    act(() => h.actions().flatView());
    await waitFor(() => expect(h.controller.sheetMetal).toHaveBeenCalled());
    const arg = (h.controller.sheetMetal.mock.calls.at(-1) as unknown[])[0] as { features: Array<Record<string, unknown>> };
    expect(arg.features[1].height).toBe(30);
  });
  it('writes the bend table to a file named after the part', async () => {
    const h = host();
    act(() => h.actions().exportBends('csv'));
    await waitFor(() => expect(h.saved).toHaveLength(1));
    expect(h.saved[0]).toEqual(['Plate-bends.csv', 'body,rule', 'text/csv']);
    expect(h.controller.sheetRequest).toHaveBeenCalledWith(expect.objectContaining({ type: 'sheetBendTable', format: 'csv', body: 'Plate' }));
    expect(h.notes.at(-1)).toContain('Plate-bends.csv');
  });
  it('asks for DXF options, then writes the file; a refusal is reported with the kernel\'s words', async () => {
    const h = host();
    act(() => h.actions().exportDxf());
    await waitFor(() => expect(h.container.querySelector('[data-act="write"]')).not.toBeNull());
    fireEvent.click(h.container.querySelector('[data-act="write"]')!);
    await waitFor(() => expect(h.saved).toHaveLength(1));
    expect(h.saved[0][0]).toBe('Plate-flat.dxf');
    expect(h.saved[0][2]).toBe('application/dxf');
    expect(h.container.querySelector('[data-act="write"]')).toBeNull();      // the dialog closed

    h.controller.sheetRequest.mockRejectedValueOnce(new Error('units: unknown unit'));
    act(() => h.actions().exportDxf());
    await waitFor(() => expect(h.container.querySelector('[data-act="write"]')).not.toBeNull());
    fireEvent.click(h.container.querySelector('[data-act="write"]')!);
    await waitFor(() => expect(h.notes.some((n) => n.includes('units: unknown unit'))).toBe(true));
  });
  it('unfold and refold are applied directly and a refusal is shown', async () => {
    const h = host();
    h.controller.edit.mockResolvedValueOnce({ ok: false, hints: [{ hint: 'refold first' }] } as never);
    act(() => h.actions().apply([{ op: 'add', feature: { type: 'edgeFlange' } } as never]));
    await waitFor(() => expect(h.notes).toContain('refold first'));
  });
});
