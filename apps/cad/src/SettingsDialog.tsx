import type { Workspace, WorkspacePreset } from '@kit/store';

/** Workspace options as plain controls. Changing a control applies immediately and is remembered by the caller. */
export function SettingsDialog(p: { workspace: Workspace; onChange(patch: Partial<Workspace>): void; onPreset(name: WorkspacePreset): void; onClose(): void }) {
  const w = p.workspace;
  const check = (key: 'leftTabs' | 'toolRail' | 'selectionBar' | 'drawerOpen', label: string) => (
    <label class="set-row">
      <input type="checkbox" checked={w[key]} onChange={(e) => p.onChange({ [key]: (e.currentTarget as HTMLInputElement).checked })} />
      <span>{label}</span>
    </label>
  );
  const select = <K extends 'ribbon' | 'leftPanel' | 'rightPanel'>(key: K, label: string, options: Array<[Workspace[K], string]>) => (
    <label class="set-row">
      <span>{label}</span>
      <select value={w[key]} onChange={(e) => p.onChange({ [key]: (e.currentTarget as HTMLSelectElement).value } as Partial<Workspace>)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="dlg set-dlg" role="dialog" aria-label="Workspace settings">
        <div class="dlg-head"><b>Workspace</b><button class="rb-btn" onClick={p.onClose}>Close</button></div>
        <div class="set-body">
          <label class="set-row">
            <span>Preset</span>
            <select aria-label="Preset" value="" onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value as WorkspacePreset; if (v) p.onPreset(v); }}>
              <option value="">Choose...</option>
              <option value="plasticity">Plasticity-style</option>
              <option value="classic">Classic ribbon</option>
              <option value="minimal">Minimal</option>
            </select>
          </label>
          {select('ribbon', 'Ribbon', [['off', 'Off (command search)'], ['compact', 'Compact'], ['full', 'Full']])}
          {select('leftPanel', 'Left panel', [['docked', 'Docked'], ['floating', 'Floating'], ['hidden', 'Hidden']])}
          {select('rightPanel', 'Inspector panel', [['off', 'Off'], ['docked', 'Docked right'], ['floating', 'Floating']])}
          {check('leftTabs', 'Left panel tabs (Outliner, Features, Assets)')}
          {check('toolRail', 'Tool rail')}
          {check('selectionBar', 'Selection mode bar')}
          {check('drawerOpen', 'Bottom drawer open')}
          <label class="set-row"><span>Floating panel opacity</span>
            <input type="range" min="15" max="100" value={Math.round(w.opacity * 100)} aria-label="Opacity" onInput={(e) => p.onChange({ opacity: Number((e.currentTarget as HTMLInputElement).value) / 100 })} /></label>
          <label class="set-row"><span>Backdrop blur</span>
            <input type="range" min="0" max="30" value={w.blur} aria-label="Blur" onInput={(e) => p.onChange({ blur: Number((e.currentTarget as HTMLInputElement).value) })} /></label>
        </div>
      </div>
    </div>
  );
}
