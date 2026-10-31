import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { t } from './i18n';
import { Slot } from './Slot';
import { commandToItem, resolveLayout, type Command, type RibbonEntry, type RibbonLayout, type RibbonNode } from './Ribbon';

/** The ribbon of a phone: the tabs as a row of chips and the tools of the chosen tab as ONE strip that scrolls sideways, every tool with its name.
 *  It stands just above the bottom bar and goes away when a tool is picked or the canvas is tapped, so it never keeps the drawing covered.
 *  (The same commands and layout as the Ribbon; the groups run on after each other, a thin rule between them.) */
export function ToolTray(p: {
  commands: Command[]; activeTab: string; onTab(t: string): void; layout?: RibbonLayout; hidden?: ReadonlySet<string>;
  /** Show only this tab (a contextual mode such as sketching replaces the tabs). */
  onlyTab?: string;
  tabLabel?(tab: string): string | undefined;
  caption?(c: { id: string; label: string }): string;
  /** Close the tray (a tool was picked, or the page behind it was tapped). */
  onDone(): void;
}): JSX.Element {
  const layout = resolveLayout(p.commands, p.layout, p.hidden);
  const tabs = p.onlyTab && layout[p.onlyTab] ? [p.onlyTab] : Object.keys(layout);
  const groups = layout[p.activeTab] ?? [];
  // a command that runs from the list of a split button closes the tray as well
  const byId = new Map(p.commands.map((c) => [c.id, { ...c, run: () => { p.onDone(); c.run(); } }]));
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => { if (strip.current) strip.current.scrollLeft = 0; }, [p.activeTab]);
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onDone(); };
  useEffect(() => { addEventListener('keydown', key); return () => removeEventListener('keydown', key); });

  const entry = (e: RibbonEntry | RibbonNode, gi: number, ei: number) => {
    if (typeof e === 'object' && 'node' in e) return <span key={e.key} class="rb-node">{e.node}</span>;
    if (typeof e === 'string') {
      const c = byId.get(e)!;
      return <Slot key={e} id={c.id} items={[commandToItem(c)]} variant="ribbon" labels caption={p.caption} side="top" />;
    }
    const items = e.ids.map((id) => commandToItem(byId.get(id)!));
    return <Slot key={e.slot + gi + ei} id={e.slot} items={items} variant="ribbon" labels caption={p.caption} side="top" menu={e.menu} keepOpen={e.keepOpen} radio={e.radio} fixed={e.fixed} icon={e.icon} title={e.title ? t(e.title, undefined, e.title) : undefined} />;
  };

  return (
    <>
      <div class="tool-scrim" data-testid="tool-scrim" onPointerDown={p.onDone} />
      <div class="tool-tray" role="region" aria-label={t('ui.tray.label')}
        onClick={(e) => {   // a tool button was pressed (not a list opener: those have the corner mark and no run of their own)
          const b = (e.target as Element).closest('.tt-strip button');
          if (b && !b.classList.contains('slot-more') && !b.closest('.slot')?.querySelector('.slot-more-mark')) setTimeout(p.onDone, 0);
        }}>
        {tabs.length > 1 ? (
          <div class="tt-tabs" role="tablist">
            {tabs.map((tab) => (
              <button key={tab} role="tab" class={'tt-tab' + (tab === p.activeTab ? ' on' : '')} data-testid={'ribbon-tab-' + tab} aria-selected={tab === p.activeTab} onClick={() => p.onTab(tab)}>
                {p.tabLabel?.(tab) ?? t('tab.' + tab, undefined, tab)}
              </button>
            ))}
          </div>
        ) : null}
        <div class="tt-strip" ref={strip}>
          {groups.map((g, gi) => (
            <div class="tt-group" key={g.id} role="group" aria-label={t('group.' + g.id, undefined, g.id)}>{g.entries.map((e, ei) => entry(e, gi, ei))}</div>
          ))}
        </div>
      </div>
    </>
  );
}
