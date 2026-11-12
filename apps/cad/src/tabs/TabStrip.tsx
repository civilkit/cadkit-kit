import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { ContextMenu } from '../ContextMenu';

export interface TabInfo { id: number; name: string; dirty: boolean; active: boolean }

/** Where a tab dragged over `over` would land: before it or after it, by which half of it the pointer is in. Returns the index in the list as it is after the tab is lifted out. */
export function dropIndex(order: readonly number[], dragged: number, over: number, after: boolean): number {
  const rest = order.filter((id) => id !== dragged);
  const at = rest.indexOf(over);
  return at < 0 ? rest.length : at + (after ? 1 : 0);
}

/** The open documents as tabs: click to switch, × (or a middle click) to close, + for a new part, drag to reorder, ▾ for the list of all of them. */
export function TabStrip(p: { tabs: readonly TabInfo[]; onSwitch(id: number): void; onClose(id: number): void; onNew(): void; onMove?(id: number, to: number): void; /** a double click on the active tab: rename the document */ onRename?(): void; /** close every other tab (the app keeps the ones with unsaved changes) */ onCloseOthers?(id: number): void }): JSX.Element {
  const activeRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const active = p.tabs.find((x) => x.active)?.id;
  const [drag, setDragState] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);   // read by the drag events themselves (the state is for drawing)
  const setDrag = (id: number | null): void => { dragRef.current = id; setDragState(id); };
  const [mark, setMark] = useState<{ id: number; after: boolean } | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [list, setList] = useState(false);
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  // the active tab stays in view when there are more tabs than fit
  useEffect(() => { activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [active, p.tabs.length]);
  // the list button shows once the tabs no longer fit (or there are plenty)
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = (): void => setOverflow(el.scrollWidth > el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [p.tabs.length]);
  useEffect(() => {
    if (!list) return;
    const off = (e: Event): void => { if (!(e.target as HTMLElement | null)?.closest?.('.tab-list, [data-action="tab-list"]')) setList(false); };
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') setList(false); };
    addEventListener('pointerdown', off); addEventListener('keydown', esc);
    return () => { removeEventListener('pointerdown', off); removeEventListener('keydown', esc); };
  }, [list]);
  const end = (): void => { setDrag(null); setMark(null); };
  const sideOf = (e: DragEvent): boolean => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientX > r.left + r.width / 2;
  };
  return (
    <div class="tabbar">
      <div class="tabstrip" role="tablist" aria-label={t('tabs.label')} ref={stripRef}>
        {p.tabs.map((x) => (
          <div
            key={x.id}
            ref={x.active ? activeRef : undefined}
            class={'tab' + (x.active ? ' active' : '') + (drag === x.id ? ' dragging' : '') + (mark?.id === x.id ? (mark.after ? ' drop-after' : ' drop-before') : '')}
            role="tab"
            aria-selected={x.active}
            data-tab={x.id}
            draggable={!!p.onMove && p.tabs.length > 1}
            title={x.dirty ? t('tabs.unsaved', { name: x.name }) : x.name}
            onClick={() => p.onSwitch(x.id)}
            onDblClick={() => { if (x.active) p.onRename?.(); }}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ id: x.id, x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }); }}
            onAuxClick={(e) => { if ((e as MouseEvent).button === 1) { e.preventDefault(); p.onClose(x.id); } }}
            onDragStart={(e) => { setDrag(x.id); if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', x.name); } }}
            onDragOver={(e) => { if (dragRef.current === null || dragRef.current === x.id) return; e.preventDefault(); setMark({ id: x.id, after: sideOf(e as DragEvent) }); }}
            onDrop={(e) => {
              const from = dragRef.current;
              if (from === null || from === x.id) { end(); return; }
              e.preventDefault();
              p.onMove?.(from, dropIndex(p.tabs.map((y) => y.id), from, x.id, sideOf(e as DragEvent)));
              end();
            }}
            onDragEnd={end}
          >
            <span class="tab-name">{x.name}</span>
            {x.dirty ? <span class="tab-dirty" aria-label={t('tabs.dirty')} /> : null}
            <button class="tab-x" aria-label={t('tabs.close', { name: x.name })} onClick={(e) => { e.stopPropagation(); p.onClose(x.id); }}>×</button>
          </div>
        ))}
        <button class="tab-new" aria-label={t('tabs.new')} title={t('tabs.new')} data-action="new-tab" onClick={p.onNew}>+</button>
      </div>
      {overflow || p.tabs.length > 7 ? (
        <button class="tab-more" aria-label={t('tabs.list')} title={t('tabs.list')} data-action="tab-list" aria-expanded={list} onClick={() => setList((v) => !v)}>▾ {p.tabs.length}</button>
      ) : null}
      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}
          items={[
            ...(p.onRename ? [{ id: 'rename', label: t('tabs.menu.rename'), enabled: p.tabs.find((x) => x.id === menu.id)?.active === true }] : []),
            { id: 'new', label: t('tabs.new'), enabled: true },
            { id: '-', label: '', enabled: false, separator: true },
            { id: 'close', label: t('tabs.menu.close'), enabled: true },
            ...(p.onCloseOthers ? [{ id: 'close-others', label: t('tabs.menu.closeOthers'), enabled: p.tabs.length > 1 }] : []),
          ]}
          onRun={(id) => { const tab = menu.id; setMenu(null); if (id === 'rename') p.onRename?.(); else if (id === 'new') p.onNew(); else if (id === 'close') p.onClose(tab); else if (id === 'close-others') p.onCloseOthers?.(tab); }} />
      ) : null}
      {list ? (
        <ul class="tab-list" role="menu" aria-label={t('tabs.label')}>
          {p.tabs.map((x) => (
            <li key={x.id} role="none">
              <button role="menuitem" class={x.active ? 'on' : ''} data-list-tab={x.id} onClick={() => { setList(false); p.onSwitch(x.id); }}>
                <span class="tab-name">{x.name}</span>{x.dirty ? <span class="tab-dirty" aria-label={t('tabs.dirty')} /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
