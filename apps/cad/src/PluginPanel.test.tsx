import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { builtinRegistry, defaultsOf, PluginRegistry, type SelItem, type Values } from '@kit/plugin';
import { PluginPanel } from './PluginPanel';
import type { PluginSel } from './pluginRun';
import './i18n';

afterEach(() => cleanup());
const registry = builtinRegistry();

function mount(sel: PluginSel | null) {
  const log = { picks: [] as string[], changes: [] as Values[], applies: 0, backs: 0, cancels: 0 };
  let current = sel;
  const view = (s: PluginSel | null) => (
    <PluginPanel registry={registry} sel={s} onPick={(p, g) => log.picks.push(`${p}/${g}`)} onChange={(v) => { log.changes.push(v); current = current && { ...current, values: v }; r.rerender(view(current)); }}
      onApply={() => { log.applies++; }} onBack={() => { log.backs++; }} onCancel={() => { log.cancels++; }} hint={null} />
  );
  const r = render(view(sel));
  const q = (sel2: string) => r.container.querySelector(sel2) as HTMLElement | null;
  const input = (name: string) => r.container.querySelector(`[data-path="${name}"] input`) as HTMLInputElement | null;
  const select = (name: string) => r.container.querySelector(`[data-path="${name}"] select`) as HTMLSelectElement | null;
  return { r, log, q, input, select };
}
const sel = (generatorId: string, pluginId: string, patch: Values = {}): PluginSel => ({ pluginId, generatorId, values: { ...defaultsOf(registry.find(pluginId, generatorId)!.decl.params), ...patch } });

describe('PluginPanel', () => {
  it('lists every generator of every plugin, by category, and picking one reports it', () => {
    const m = mount(null);
    expect(m.q('[data-testid="plugin-item-civilkit.enclosures-case"]')!.textContent).toContain('Case');
    expect(m.q('[data-testid="plugin-item-civilkit.enclosures-case"]')!.textContent).toContain('built-in');
    expect(m.q('[data-testid="plugin-item-civilkit.springs-spring"]')).not.toBeNull();
    fireEvent.click(m.q('[data-testid="plugin-item-civilkit.springs-spring"]')!);
    expect(m.log.picks).toEqual(['civilkit.springs/spring']);
  });

  it('the form is generated: a field per parameter, grouped, with units; an optional number shows "auto"', () => {
    const m = mount(sel('case', 'civilkit.enclosures'));
    for (const n of ['width', 'depth', 'height', 'wall', 'radius', 'topRadius', 'lidHeight', 'tongueOn', 'clearance', 'baseName', 'axis', 'x', 'y', 'z']) expect(m.r.container.querySelector(`[data-path="${n}"]`), n).not.toBeNull();
    expect([...m.r.container.querySelectorAll('[data-group]')].map((g) => g.getAttribute('data-group'))).toEqual(['Size', 'Edges', 'Lid and joint', 'Names', 'Placement']);
    expect(m.input('width')!.value).toBe('80');
    expect(m.q('[data-path="width"] .fedit-unit')!.textContent).toBe('mm');
    expect(m.input('lidHeight')!.value).toBe('');
    expect(m.input('lidHeight')!.placeholder).toBe('auto');
    expect(m.select('tongueOn')!.value).toBe('lid');
  });

  it('a number is kept as it is typed: typing in one field then the next loses nothing', () => {
    const m = mount(sel('case', 'civilkit.enclosures'));
    // typing is `input` events, not `change`: the value must be reported by the keystroke itself
    fireEvent.input(m.input('width')!, { target: { value: '9' } });
    expect(m.log.changes.at(-1)).toMatchObject({ width: 9 });
    fireEvent.input(m.input('width')!, { target: { value: '90' } });
    expect(m.log.changes.at(-1)).toMatchObject({ width: 90 });
    // the next field, straight away, with no blur event in between: its first digit is kept and the first field still holds what was typed
    fireEvent.input(m.input('depth')!, { target: { value: '4' } });
    expect(m.log.changes.at(-1)).toMatchObject({ width: 90, depth: 4 });
    expect(m.input('width')!.value).toBe('90');
    expect(m.input('depth')!.value).toBe('4');
  });
  it('emptying a number field in the middle of typing does not clear it until the change', () => {
    const m = mount(sel('case', 'civilkit.enclosures'));
    const before = m.log.changes.length;
    fireEvent.input(m.input('lidHeight')!, { target: { value: '' } });
    expect(m.log.changes.length).toBe(before);   // `input` with an empty value reports nothing
    fireEvent.change(m.input('lidHeight')!, { target: { value: '' } });
    expect(m.log.changes.at(-1)).not.toHaveProperty('lidHeight');
  });
  it('a change reports the whole value record; emptying an optional field removes its key', () => {
    const m = mount(sel('case', 'civilkit.enclosures', { lidHeight: 12 }));
    fireEvent.change(m.input('width')!, { target: { value: '100' } });
    expect(m.log.changes.at(-1)).toMatchObject({ width: 100, depth: 50, lidHeight: 12 });
    fireEvent.change(m.input('lidHeight')!, { target: { value: '' } });
    expect(m.log.changes.at(-1)).not.toHaveProperty('lidHeight');
    fireEvent.change(m.select('tongueOn')!, { target: { value: 'base' } });
    expect(m.log.changes.at(-1)).toMatchObject({ tongueOn: 'base' });
  });

  it('dependent fields come and go with the kind; an invalid value marks the field and blocks Add', () => {
    const m = mount(sel('spring', 'civilkit.springs'));
    expect(m.input('length')).not.toBeNull();
    expect(m.select('ends')).not.toBeNull();
    expect(m.input('closedTurns')).toBeNull();
    fireEvent.change(m.select('ends')!, { target: { value: 'ground' } });
    expect(m.input('closedTurns')).not.toBeNull();
    fireEvent.change(m.select('kind')!, { target: { value: 'torsion' } });
    expect(m.input('length')).toBeNull();
    expect(m.select('ends')).toBeNull();
    expect(m.input('closedTurns')).toBeNull();   // depends on ends, which is hidden
    expect(m.input('leg1')).not.toBeNull();
    const apply = m.q('[data-testid="plugin-apply"]') as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.change(m.input('leg1')!, { target: { value: '0' } });
    expect(m.q('[data-testid="plugin-err-leg1"]')!.textContent).toContain('must be at least 0.1');
    expect((m.q('[data-testid="plugin-apply"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(m.q('[data-testid="plugin-apply"]')!);
    expect(m.log.applies).toBe(0);
  });

  it('Add, Back, Cancel and Escape call their handlers; Reset restores the defaults', () => {
    const m = mount(sel('case', 'civilkit.enclosures', { width: 120 }));
    fireEvent.click(m.q('[data-testid="plugin-apply"]')!);
    fireEvent.click(m.q('[data-testid="plugin-back"]')!);
    fireEvent.click(m.q('[data-testid="plugin-cancel"]')!);
    fireEvent.keyDown(m.q('[data-testid="plugin-panel"]')!, { key: 'Escape' });
    expect([m.log.applies, m.log.backs, m.log.cancels]).toEqual([1, 1, 2]);
    fireEvent.click(m.q('[data-testid="plugin-reset"]')!);
    expect(m.log.changes.at(-1)).toEqual(defaultsOf(registry.find('civilkit.enclosures', 'case')!.decl.params));
  });

  describe('a selection field', () => {
    const reg = new PluginRegistry();
    reg.add({ id: 'test.seat', name: 'Seat', version: '1.0.0', contributes: { generators: [{ id: 'seat', title: 'Seat', params: [
      { name: 'body', type: 'selection', title: 'Body to modify', accept: ['body'], minItems: 1, maxItems: 1 },
      { name: 'faces', type: 'selection', title: 'Faces', accept: ['face'], optional: true },
      { name: 'size', type: 'number', default: 5 },
    ] }] } }, { seat: async () => 'p.run(() => {});' });
    const mountSeat = (values: Values, pickField: string | null) => {
      const log = { changes: [] as Values[], picks: [] as Array<string | null> };
      const view = (v: Values, f: string | null) => <PluginPanel registry={reg} sel={{ pluginId: 'test.seat', generatorId: 'seat', values: v }} onPick={() => {}} onChange={(n) => { log.changes.push(n); r.rerender(view(n, f)); }}
        onApply={() => {}} onBack={() => {}} onCancel={() => {}} pickField={f} onPickField={(n) => { log.picks.push(n); r.rerender(view(values, n)); }} />;
      const r = render(view(values, pickField));
      return { r, log, q: (s: string) => r.container.querySelector(s) as HTMLElement | null };
    };
    it('shows the picks, asks for one that is missing, and blocks Add until there is one', () => {
      const m = mountSeat({ body: [], size: 5 }, null);
      expect(m.q('[data-testid="plugin-pick-body"]')!.textContent).toContain('Nothing picked yet');
      expect(m.q('[data-testid="plugin-err-body"]')!.textContent).toContain('pick at least one');
      const picks: SelItem[] = [{ type: 'body', name: 'Rail' }];
      const m2 = mountSeat({ body: picks, size: 5 }, null);
      expect(m2.q('[data-testid="plugin-pick-body"]')!.textContent).toContain('Rail');
      expect(m2.q('[data-testid="plugin-err-body"]')).toBeNull();
    });
    it('a face reads as its body and number; the button makes the field the picking one and Done stops it', () => {
      const m = mountSeat({ body: [{ type: 'body', name: 'Rail' }], faces: [{ type: 'face', body: 'Rail', index: 1 }], size: 5 }, null);
      expect(m.q('[data-testid="plugin-pick-faces"]')!.textContent).toContain('Rail, face 2');
      const btn = m.q('[data-testid="plugin-pick-btn-faces"]')!;
      expect(btn.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(btn);
      expect(m.log.picks).toEqual(['faces']);
      const on = m.q('[data-testid="plugin-pick-btn-faces"]')!;
      expect(on.getAttribute('aria-pressed')).toBe('true');
      expect(m.q('[data-testid="plugin-pick-faces"]')!.textContent).toContain('Select faces in the view');
      fireEvent.click(on);
      expect(m.log.picks).toEqual(['faces', null]);
    });
    it('Clear empties the field and per-item remove deletes a single pick', () => {
      const m = mountSeat({ body: [{ type: 'body', name: 'Rail' }], faces: [{ type: 'face', body: 'Rail', index: 0 }, { type: 'face', body: 'Rail', index: 1 }], size: 5 }, null);
      fireEvent.click(m.q('[data-testid="plugin-pick-remove-faces-0"]')!);
      expect(m.log.changes.at(-1)).toMatchObject({ faces: [{ type: 'face', body: 'Rail', index: 1 }], body: [{ type: 'body', name: 'Rail' }], size: 5 });
      fireEvent.click(m.q('[data-testid="plugin-pick-clear-faces"]')!);
      expect(m.log.changes.at(-1)).toMatchObject({ faces: [], body: [{ type: 'body', name: 'Rail' }], size: 5 });
      expect(m.q('[data-testid="plugin-pick-clear-body"]')).not.toBeNull();
    });
  });
  describe('fields that take edges, sketches and closed regions', () => {
    const reg = new PluginRegistry();
    reg.add({ id: 'test.kinds', name: 'Kinds', version: '1.0.0', contributes: { generators: [{ id: 'k', title: 'Kinds', params: [
      { name: 'edges', type: 'selection', title: 'Edges', accept: ['edge'], optional: true },
      { name: 'path', type: 'selection', title: 'Path', accept: ['sketch'], optional: true },
      { name: 'shape', type: 'selection', title: 'Shape', accept: ['profile'], maxItems: 1, optional: true },
      { name: 'old', type: 'selection', title: 'Old', accept: ['body', 'face'], optional: true },
    ] }] } }, { k: async () => 'p.run(() => {});' });
    const sketches = [{ id: 'F1', name: 'Outline', regions: ['e1', 'e5'] }, { id: 'F3', name: 'Rail path', regions: [] }];
    const mountKinds = (values: Values, pickField: string | null = null) => {
      const log = { changes: [] as Values[] };
      const view = (v: Values) => <PluginPanel registry={reg} sel={{ pluginId: 'test.kinds', generatorId: 'k', values: v }} onPick={() => {}} onChange={(n) => { log.changes.push(n); r.rerender(view(n)); }}
        onApply={() => {}} onBack={() => {}} onCancel={() => {}} pickField={pickField} onPickField={() => {}} sketches={sketches} />;
      const r = render(view(values));
      return { r, log, q: (s: string) => r.container.querySelector(s) as HTMLElement | null };
    };
    it('lists picked edges, sketches and regions by name', () => {
      const m = mountKinds({ edges: [{ type: 'edge', body: 'Rail', index: 2 }], path: [{ type: 'sketch', id: 'F3', name: 'Rail path' }], shape: [{ type: 'profile', sketch: 'F1', region: 'e5', name: 'Outline', index: 1 }] });
      expect(m.q('[data-testid="plugin-pick-edges"]')!.textContent).toContain('Rail, edge 3');
      expect(m.q('[data-testid="plugin-pick-path"]')!.textContent).toContain('Rail path');
      expect(m.q('[data-testid="plugin-pick-shape"]')!.textContent).toContain('Outline, region 2');
    });
    it('the picking hint names the kinds; a sketch or a region can be added from a list; a body and face field has no list', () => {
      const m = mountKinds({}, 'edges');
      expect(m.q('[data-testid="plugin-pick-edges"]')!.textContent).toContain('Select edges in the view');
      expect(m.q('[data-testid="plugin-add-sketch-edges"]')).toBeNull();
      expect(m.q('[data-testid="plugin-add-sketch-old"]')).toBeNull();
      expect(m.q('[data-testid="plugin-add-profile-old"]')).toBeNull();
      const add = m.q('[data-testid="plugin-add-sketch-path"]') as HTMLSelectElement;
      expect([...add.options].map((o) => o.textContent)).toEqual(['Add a sketch…', 'Outline', 'Rail path']);
      fireEvent.change(add, { target: { value: 'F3' } });
      expect(m.log.changes.at(-1)).toMatchObject({ path: [{ type: 'sketch', id: 'F3', name: 'Rail path' }] });
      const reg2 = m.q('[data-testid="plugin-add-profile-shape"]') as HTMLSelectElement;
      expect([...reg2.options].map((o) => o.textContent)).toEqual(['Add a region…', 'Outline, region 1', 'Outline, region 2']);
      fireEvent.change(reg2, { target: { value: 'F1/e1' } });
      expect(m.log.changes.at(-1)).toMatchObject({ shape: [{ type: 'profile', sketch: 'F1', region: 'e1', index: 0 }] });
    });
  });
});
