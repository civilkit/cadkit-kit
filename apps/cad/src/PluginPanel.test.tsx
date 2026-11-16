import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { builtinRegistry, defaultsOf, type Values } from '@kit/plugin';
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
});
