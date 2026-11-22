import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Command } from '@kit/ui';
import { textAttrs } from '@kit/ui';
import { t } from './i18n';
import { shortcutRows, shortcutSections, type ShortcutRow } from './shortcuts';
import { PRESET_IDS, comboFromEvent, exportKeymap, importKeymap, isOverridden, resetBinding, setBinding, setPreset, type Combo, type PresetId } from './keymap';
import { getDefaults, getKeymapState, setKeymapState, subscribeKeymap } from './keymapStore';

const presetName = (id: PresetId): string => t(id === 'default' ? 'shortcuts.preset.default' : id === 'solidworks' ? 'shortcuts.preset.solidworks' : id === 'fusion' ? 'shortcuts.preset.fusion' : 'shortcuts.preset.freecad');

/** A key waiting for the user's decision: the combo is already used by other commands. */
interface Clash { id: string; combo: Combo; names: string[] }

/** The keyboard shortcut cheat sheet: a searchable overlay of every key, read from the app's own tables (shortcuts.ts). It is also the editor: click a key to
 *  record another (a combo already in use asks first), pick a preset, reset, import or export the whole set. Esc or a click outside closes it. */
export function ShortcutSheet(p: { commands: Command[]; onClose(): void }): JSX.Element {
  const [q, setQ] = useState('');
  const [, tick] = useState(0);
  const [recording, setRecording] = useState<string | null>(null);
  const [clash, setClash] = useState<Clash | null>(null);
  const [note, setNote] = useState('');
  const [unbound, setUnbound] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const recordingRef = useRef<string | null>(null);
  recordingRef.current = recording;
  useEffect(() => input.current?.focus(), []);
  useEffect(() => subscribeKeymap(() => tick((n) => n + 1)), []);
  const rows = useMemo(() => shortcutRows(p.commands, { includeUnbound: unbound }), [p.commands, unbound, getKeymapState()]);
  const sections = useMemo(() => shortcutSections(rows, q), [rows, q]);
  const labelOf = (id: string): string => rows.find((r) => r.id === id)?.label ?? shortcutRows(p.commands, { includeUnbound: true }).find((r) => r.id === id)?.label ?? id;

  const bind = (id: string, combo: Combo | null, steal = false) => {
    const r = setBinding(getDefaults(), getKeymapState(), id, combo, steal);
    if (r.error) { setNote(t(r.error === 'sketchModifier' ? 'shortcuts.err.sketchModifier' : r.error === 'reserved' ? 'shortcuts.err.reserved' : 'shortcuts.err.invalid')); return; }
    if (r.conflicts.length && !steal) { setClash({ id, combo: combo!, names: r.conflicts.map(labelOf) }); return; }
    setClash(null);
    setNote(r.stolenFrom.length ? t('shortcuts.stolen', { names: r.stolenFrom.map(labelOf).join(', ') }) : '');
    setKeymapState(r.state);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const rec = recordingRef.current;
      if (rec) {
        // the key press is the new shortcut: nothing else sees it (not even Esc, which cancels the recording and not the sheet)
        e.preventDefault(); e.stopImmediatePropagation();
        if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { setRecording(null); return; }
        const combo = comboFromEvent(e);
        if (!combo) return;   // a modifier on its own: keep waiting
        setRecording(null);
        bind(rec, combo);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); p.onClose(); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);

  const state = getKeymapState();
  const download = () => {
    const url = URL.createObjectURL(new Blob([exportKeymap(state)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'cadkit-keymap.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    const r = importKeymap(await f.text());
    if (!r) { setNote(t('shortcuts.import.bad')); return; }
    setKeymapState(r.state);
    setNote(r.skipped.length ? t('shortcuts.import.skipped', { n: r.skipped.length }) : t('shortcuts.import.ok'));
  };

  const keyCell = (r: ShortcutRow): JSX.Element => {
    if (!r.rebindable) return <kbd title={t('shortcuts.fixed.tip')}>{r.keys}</kbd>;
    const rec = recording === r.id;
    const shown = rec ? <span>{t('shortcuts.press')}</span> : <kbd class={r.keys ? undefined : 'none'}>{r.keys || t('shortcuts.unassigned')}</kbd>;
    return (
      <button type="button" class={'kbd-btn' + (rec ? ' rec' : '')} data-testid={'rebind-' + r.id} title={t('shortcuts.rebind')} aria-label={t('shortcuts.rebindNamed', { name: r.label })}
        onClick={() => { setClash(null); setNote(''); setRecording(rec ? null : r.id); }}>
        {shown}
      </button>
    );
  };

  return (
    <div class="pal-back" data-testid="shortcut-sheet" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="pal kbd-sheet" role="dialog" aria-label={t('shortcuts.title')}>
        <input {...textAttrs} type="search" ref={input} placeholder={t('shortcuts.search')} aria-label={t('shortcuts.search')} value={q}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
        <div class="kbd-tools">
          <label>{t('shortcuts.preset')}{' '}
            <select data-testid="keymap-preset" value={state.preset} onChange={(e) => { setKeymapState(setPreset(state, (e.currentTarget as HTMLSelectElement).value as PresetId)); setClash(null); setNote(''); }}>
              {PRESET_IDS.map((id) => <option key={id} value={id}>{presetName(id)}</option>)}
            </select>
          </label>
          <button type="button" data-testid="keymap-reset" disabled={state.preset === 'default' && Object.keys(state.overrides).length === 0}
            onClick={() => { setKeymapState({ preset: 'default', overrides: {} }); setClash(null); setNote(''); }}>{t('shortcuts.resetAll')}</button>
          <button type="button" data-testid="keymap-export" onClick={download}>{t('shortcuts.export')}</button>
          <button type="button" data-testid="keymap-import" onClick={() => file.current?.click()}>{t('shortcuts.import')}</button>
          <input ref={file} type="file" accept="application/json,.json" hidden data-testid="keymap-file" onChange={(e) => { const el = e.currentTarget as HTMLInputElement; void upload(el.files?.[0]); el.value = ''; }} />
          <label class="kbd-unbound"><input type="checkbox" checked={unbound} onChange={(e) => setUnbound((e.currentTarget as HTMLInputElement).checked)} /> {t('shortcuts.showUnassigned')}</label>
        </div>
        {clash ? (
          <div class="kbd-clash" role="alert" data-testid="keymap-clash">
            <span>{t('shortcuts.conflict', { combo: clash.combo, names: clash.names.join(', ') })}</span>
            <button type="button" data-testid="keymap-replace" onClick={() => bind(clash.id, clash.combo, true)}>{t('shortcuts.replace')}</button>
            <button type="button" onClick={() => setClash(null)}>{t('shortcuts.cancel')}</button>
          </div>
        ) : note ? <div class="kbd-clash" role="status">{note}</div> : null}
        <div class="plist">
          {sections.map((s) => (
            <section key={s.group} data-group={s.group}>
              <div class="plbl">{s.title}</div>
              {s.rows.map((r) => (
                <div key={r.id} class="it" data-shortcut={r.id}>
                  <span>{r.label}</span>
                  {r.rebindable && r.keys ? <button type="button" class="kbd-x" title={t('shortcuts.clear')} aria-label={t('shortcuts.clearNamed', { name: r.label })} onClick={() => bind(r.id, null)}>×</button> : null}
                  {r.rebindable && isOverridden(state, r.id) ? <button type="button" class="kbd-x" data-testid={'reset-' + r.id} title={t('shortcuts.reset')} aria-label={t('shortcuts.resetNamed', { name: r.label })} onClick={() => { setKeymapState(resetBinding(getKeymapState(), r.id)); setClash(null); }}>↺</button> : null}
                  {keyCell(r)}
                </div>
              ))}
            </section>
          ))}
          {sections.length === 0 ? <div class="empty">{t('shortcuts.none', { query: q })}</div> : null}
        </div>
        <div class="kbd-note">{t('shortcuts.note')}</div>
      </div>
    </div>
  );
}
