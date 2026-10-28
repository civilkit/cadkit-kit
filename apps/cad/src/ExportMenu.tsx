import { useEffect, useRef } from 'preact/hooks';
import { Icon, Tip, type Command } from '@kit/ui';
import { t } from './i18n';

/** The top bar's Export button and its list of formats. The list is the export commands themselves (so the menu, the
 *  ribbon and the command search never disagree); a format that cannot run now is shown disabled. */
export function ExportMenu(p: { items: Command[]; open: boolean; onOpenChange(open: boolean): void; keys?: string; disabled?: boolean; /** "Only visible bodies" for the mesh formats; absent: no such row. */ visibleOnly?: { on: boolean; onChange(on: boolean): void } }) {
  const box = useRef<HTMLDivElement>(null);
  const { open, onOpenChange } = p;
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) onOpenChange(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    addEventListener('mousedown', away);
    addEventListener('keydown', esc);
    return () => { removeEventListener('mousedown', away); removeEventListener('keydown', esc); };
  }, [open, onOpenChange]);
  return (
    <div class="export-menu" ref={box}>
      <Tip label={t('cmd.export')} keys={p.keys} side="bottom">
        <button class="rb-btn tb-icon" aria-label={t('cmd.export')} aria-haspopup="menu" aria-expanded={open} disabled={p.disabled} onClick={() => onOpenChange(!open)}>
          <Icon name="export" size={18} />
        </button>
      </Tip>
      {open ? (
        <div class="export-pop" role="menu" aria-label={t('cmd.export')}>
          {p.items.map((c) => {
            const off = c.enabled ? !c.enabled() : false;
            return (
              <button key={c.id} role="menuitem" class="export-row" disabled={off} onClick={() => { onOpenChange(false); c.run(); }}>
                <Icon name={c.id} size={16} />
                <span>{c.label}</span>
              </button>
            );
          })}
          {p.visibleOnly ? (
            <label class="export-row export-opt">
              <input type="checkbox" data-pref="exportVisible" checked={p.visibleOnly.on} onChange={(e) => p.visibleOnly!.onChange((e.currentTarget as HTMLInputElement).checked)} />
              <span>{t('export.visibleOnly')}</span>
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
