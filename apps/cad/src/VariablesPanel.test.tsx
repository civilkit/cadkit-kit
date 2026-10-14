import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import type { PartDoc } from '@ck/part-model';
import { VariablesPanel, type ApplyResult } from './VariablesPanel';
import type { DocPatch } from './docFields';

afterEach(cleanup);

const doc = (extra: Record<string, unknown> = {}): PartDoc => ({
  format: 'ck-part', version: 1, name: 'P', seq: 3, rollback: null, material: 'steel', counters: {},
  variables: [{ name: 'width', expr: '40', unit: 'mm' }, { name: 'half', expr: 'width/2', comment: 'half the width' }],
  features: [{ type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: '=half' }],
  ...extra,
}) as unknown as PartDoc;

function setup(d = doc(), result: ApplyResult = { ok: true }) {
  const calls: Array<{ patch: DocPatch; reason: string }> = [];
  const r = render(<VariablesPanel doc={d} onApply={async (patch, reason) => { calls.push({ patch, reason }); return result; }} />);
  const row = (name: string) => r.container.querySelector(`[data-var="${name}"]`) as HTMLElement;
  return { r, calls, row };
}

describe('VariablesPanel', () => {
  it('lists the variables with their evaluated value, unit and comment', () => {
    const m = setup();
    expect(m.row('width').querySelector('[data-testid="vars-value"]')!.textContent).toContain('40');
    expect(m.row('half').querySelector('[data-testid="vars-value"]')!.textContent).toContain('20');
    expect((m.row('half').querySelector('.vars-comment') as HTMLInputElement).value).toBe('half the width');
    expect((m.row('width').querySelector('select') as HTMLSelectElement).value).toBe('mm');
  });

  it('editing an expression commits one patch with the whole list', async () => {
    const m = setup();
    const expr = m.row('width').querySelectorAll('input')[1] as HTMLInputElement;
    fireEvent.focus(expr);
    fireEvent.input(expr, { target: { value: '60' } });
    fireEvent.blur(expr);
    await waitFor(() => expect(m.calls).toHaveLength(1));
    expect(m.calls[0].reason).toBe('Edit variables');
    expect((m.calls[0].patch.variables as Array<{ name: string; expr: string }>).map((v) => [v.name, v.expr])).toEqual([['width', '60'], ['half', 'width/2']]);
  });

  it('a bad expression is shown on its row and not applied', async () => {
    const m = setup();
    const expr = m.row('width').querySelectorAll('input')[1] as HTMLInputElement;
    fireEvent.focus(expr);
    fireEvent.input(expr, { target: { value: 'half' } });   // width = half, half = width/2
    fireEvent.blur(expr);
    await waitFor(() => expect(m.r.container.querySelector('.vars-err')).not.toBeNull());
    expect(m.r.container.querySelector('.vars-err')!.textContent).toBe('Circular reference between variables');
    expect(m.calls).toHaveLength(0);
  });

  it('renaming sends the rename patch (features included)', async () => {
    const m = setup();
    const name = m.row('half').querySelector('.vars-name') as HTMLInputElement;
    fireEvent.input(name, { target: { value: 'h2' } });
    fireEvent.blur(name);
    await waitFor(() => expect(m.calls).toHaveLength(1));
    expect(m.calls[0].reason).toBe('Rename variable');
    expect((m.calls[0].patch.features as Record<string, { depth: string }>).F2.depth).toBe('=h2');
  });

  it('an invalid or duplicate name is refused with the message', async () => {
    const m = setup();
    const name = m.row('half').querySelector('.vars-name') as HTMLInputElement;
    fireEvent.input(name, { target: { value: 'width' } });
    fireEvent.blur(name);
    await waitFor(() => expect(m.r.container.querySelector('.vars-msg')).not.toBeNull());
    expect(m.r.container.querySelector('.vars-msg')!.textContent).toContain('Name already in use');
    expect(m.calls).toHaveLength(0);
  });

  it('deleting a used variable is refused and names its uses; an unused one is removed', async () => {
    const m = setup();
    fireEvent.click(m.row('half').querySelector('.vars-del')!);
    expect(m.r.container.querySelector('.vars-msg')!.textContent).toContain('F2.depth');
    expect(m.calls).toHaveLength(0);
    fireEvent.click(m.row('width').querySelector('.vars-del')!);   // used by `half`
    expect(m.calls).toHaveLength(0);
    cleanup();
    const n = setup(doc({ variables: [{ name: 'spare', expr: '1' }] }));
    fireEvent.click(n.row('spare').querySelector('.vars-del')!);
    await waitFor(() => expect(n.calls).toHaveLength(1));
    expect(n.calls[0].patch.variables).toEqual([]);
  });

  it('adds a variable with a fresh name', async () => {
    const m = setup();
    fireEvent.click(m.r.getByTestId('vars-add'));
    await waitFor(() => expect(m.calls).toHaveLength(1));
    expect((m.calls[0].patch.variables as Array<{ name: string }>).map((v) => v.name)).toEqual(['width', 'half', 'var1']);
  });

  it('a rebuild failure keeps the draft and says why', async () => {
    const m = setup(doc(), { ok: false, errors: [{ feature: 'F2', code: 'badExpression' }] });
    const expr = m.row('width').querySelectorAll('input')[1] as HTMLInputElement;
    fireEvent.focus(expr); fireEvent.input(expr, { target: { value: '70' } }); fireEvent.blur(expr);
    await waitFor(() => expect(m.r.container.querySelector('.vars-msg')).not.toBeNull());
    expect(m.r.container.querySelector('.vars-msg')!.textContent).toContain('F2');
  });

  it('configurations: add from the current values, switch, update, delete', async () => {
    const d = doc({ configurations: [{ name: 'Small', values: { width: '20', half: 'width/2' } }, { name: 'Large', values: { width: '80', half: 'width/2' } }], activeConfig: 'Large' });
    const m = setup(d);
    const cfg = (n: string) => m.r.container.querySelector(`[data-config="${n}"]`) as HTMLElement;
    expect(cfg('Large').classList.contains('on')).toBe(true);
    expect(cfg('Large').textContent).toContain('modified');   // width is 40, not 80
    fireEvent.click(cfg('Small').querySelector('.cfg-use')!);
    await waitFor(() => expect(m.calls).toHaveLength(1));
    expect(m.calls[0].patch).toMatchObject({ activeConfig: 'Small' });
    expect((m.calls[0].patch.variables as Array<{ name: string; expr: string }>)[0]).toMatchObject({ name: 'width', expr: '20' });
    fireEvent.click(cfg('Large').querySelector('.btn')!);
    await waitFor(() => expect(m.calls).toHaveLength(2));
    expect((m.calls[1].patch.configurations as Array<{ name: string; values: Record<string, string> }>).find((c) => c.name === 'Large')!.values.width).toBe('40');
    fireEvent.click(cfg('Small').querySelector('.vars-del')!);
    await waitFor(() => expect(m.calls).toHaveLength(3));
    expect((m.calls[2].patch.configurations as unknown[]).length).toBe(1);
    const input = m.r.container.querySelector('.cfg-add input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'Medium' } });
    fireEvent.click(m.r.getByTestId('cfg-add'));
    await waitFor(() => expect(m.calls).toHaveLength(4));
    expect(m.calls[3].patch).toMatchObject({ activeConfig: 'Medium' });
  });
});
