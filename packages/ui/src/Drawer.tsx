import type { ComponentChildren, JSX } from 'preact';

export interface DrawerTab { id: string; label: string; badge?: number; bad?: boolean; content: ComponentChildren }

/** Bottom drawer: a tab row and the active tab's content. The app decides the tabs. */
export function Drawer(p: { tabs: DrawerTab[]; active: string; onTab(id: string): void; onClose(): void; height?: number }): JSX.Element {
  const cur = p.tabs.find((t) => t.id === p.active) ?? p.tabs[0];
  return (
    <section class="drawer" aria-label="Drawer" style={p.height ? { height: `${p.height}px` } : undefined}>
      <div class="dtabs" role="tablist">
        {p.tabs.map((t) => (
          <button key={t.id} class="dtab" role="tab" aria-selected={t.id === cur?.id} onClick={() => p.onTab(t.id)}>
            {t.label}
            {t.badge ? <span class={'n' + (t.bad ? ' bad' : '')}>{t.badge}</span> : null}
          </button>
        ))}
        <span class="dtools"><button class="btn" aria-label="Close drawer" onClick={p.onClose}>Close \</button></span>
      </div>
      <div class="dbody" role="tabpanel">{cur?.content}</div>
    </section>
  );
}
