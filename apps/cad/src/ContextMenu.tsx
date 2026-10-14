import { useEffect, useRef, useState } from 'preact/hooks';
import type { MenuItem } from './menuModel';
import { t } from './i18n';

/** A plain popup at the pointer: arrow keys move over the enabled rows, Enter or a click runs one, Escape or a click elsewhere closes. */
export function ContextMenu(p: { x: number; y: number; items: MenuItem[]; hint?: string | null; onRun(id: string): void; onClose(): void }) {
  const rows = p.items.map((it, i) => ({ it, i })).filter((r) => !r.it.separator && r.it.enabled).map((r) => r.i);
  const [active, setActive] = useState<number>(rows[0] ?? -1);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: p.x, y: p.y });
  useEffect(() => {
    box.current?.focus();
    // keep the menu on screen
    const r = box.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.max(4, Math.min(p.x, innerWidth - r.width - 4)), y: Math.max(4, Math.min(p.y, innerHeight - r.height - 4)) });
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) p.onClose(); };
    addEventListener('mousedown', away, true);
    return () => removeEventListener('mousedown', away, true);
  }, []);
  const move = (d: number) => {
    if (!rows.length) return;
    const at = rows.indexOf(active);
    setActive(rows[(at + d + rows.length) % rows.length]);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); p.onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); if (rows.length) setActive(rows[0]); }
    else if (e.key === 'End') { e.preventDefault(); if (rows.length) setActive(rows[rows.length - 1]); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const it = p.items[active]; if (it && it.enabled) p.onRun(it.id); }
    else if (e.key === 'Tab') { e.preventDefault(); p.onClose(); }
  };
  return (
    <div class="ctx-menu" ref={box} role="menu" tabIndex={-1} aria-label={t('ctx.label')} style={{ left: pos.x + 'px', top: pos.y + 'px' }} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      {p.items.length === 0 ? <div class="ctx-empty">{t('ctx.empty')}</div> : null}
      {p.items.map((it, i) => it.separator ? <div key={i} class="ctx-sep" role="separator" /> : (
        <div key={it.id} role="menuitem" aria-disabled={!it.enabled} title={it.reason} class={'ctx-row' + (active === i ? ' on' : '') + (it.enabled ? '' : ' off')}
          onMouseEnter={() => { if (it.enabled) setActive(i); }} onClick={() => { if (it.enabled) p.onRun(it.id); }}>
          <span>{it.label}</span>{it.keys ? <kbd>{it.keys}</kbd> : null}
        </div>
      ))}
      {p.hint ? <div class="ctx-hint">{p.hint}</div> : null}
    </div>
  );
}
