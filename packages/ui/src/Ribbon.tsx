import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t } from './i18n';
import { Slot, type SlotItem } from './Slot';

export interface Command { id: string; label: string; tab: string; group: string; icon?: string; keys?: string; /** A sentence for the tooltip under the label. */ tip?: string; enabled?(): boolean; pressed?(): boolean; run(): void }

/** One place in a ribbon group: a command id (a plain button) or a slot (a split button holding several commands). */
export type RibbonEntry = string | { slot: string; ids: string[]; /** The button opens the list instead of running a command. */ menu?: boolean; /** Keep the list open after a command runs (toggles). */ keepOpen?: boolean; /** The commands are choices of one setting (see Slot). */ radio?: boolean; icon?: string; title?: string };
export interface RibbonGroup { id: string; entries: RibbonEntry[] }
/** Tab name to its titled groups, in display order. */
export type RibbonLayout = Record<string, RibbonGroup[]>;

/** The layout the ribbon draws: `layout` as given, then every command it does not place appended to its own tab and group,
 *  so a command is never hidden by a layout that forgot it. Without a layout the commands' own tab and group are used. */
export function resolveLayout(commands: Command[], layout?: RibbonLayout): RibbonLayout {
  const out: RibbonLayout = {};
  const ids = new Set(commands.map((c) => c.id));
  const placed = new Set<string>();
  for (const [tab, groups] of Object.entries(layout ?? {})) {
    out[tab] = groups.map((g) => ({
      id: g.id,
      entries: g.entries.flatMap((e): RibbonEntry[] => {
        if (typeof e === 'string') { if (!ids.has(e)) return []; placed.add(e); return [e]; }
        const have = e.ids.filter((id) => ids.has(id));
        have.forEach((id) => placed.add(id));
        return have.length ? [{ ...e, ids: have }] : [];
      }),
    })).filter((g) => g.entries.length);
    if (!out[tab].length) delete out[tab];
  }
  for (const c of commands) {
    if (placed.has(c.id)) continue;
    const groups = (out[c.tab] ??= []);
    let g = groups.find((x) => x.id === c.group);
    if (!g) groups.push((g = { id: c.group, entries: [] }));
    g.entries.push(c.id);
  }
  return out;
}

export const commandToItem = (c: Command): SlotItem => ({ id: c.id, label: c.label.replace(/^✓ /, ''), keys: c.keys, tip: c.tip, enabled: c.enabled, pressed: c.pressed, run: c.run });

export function Ribbon(p: {
  commands: Command[]; activeTab: string; onTab(t: string): void; labels?: 'icons' | 'icons-and-text';
  layout?: RibbonLayout;
  /** A shorter name for a command to write under its icon (the tooltip and the list keep the full name). */
  caption?(c: SlotItem): string;
}): JSX.Element {
  const layout = resolveLayout(p.commands, p.layout);
  const tabs = Object.keys(layout);
  const groups = layout[p.activeTab] ?? [];
  // a text ribbon that does not fit on one row first drops the names under the icons, then folds groups into the more menu
  const [auto, setAuto] = useState(false);
  const iconsOnly = p.labels === 'icons' || auto;
  const byId = new Map(p.commands.map((c) => [c.id, c]));
  const row = useRef<HTMLDivElement>(null);
  // how many groups fit on the one row; null = measure with all of them drawn
  const [fit, setFit] = useState<number | null>(null);
  const fitNow = useRef<number | null>(null);
  fitNow.current = fit;
  const sig = p.activeTab + '|' + p.labels + '|' + groups.map((g) => g.id + g.entries.length).join(',');
  useLayoutEffect(() => { setAuto(false); setFit(null); }, [sig]);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => { if (fitNow.current === null) return;                    // measuring: the width of the full row is not news
      if (Math.abs(el.clientWidth - w) > 1) { w = el.clientWidth; setAuto(false); setFit(null); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = row.current;
    if (fit !== null || !el) return;
    const kids = [...el.querySelectorAll<HTMLElement>(':scope > .rb-group')];
    const room = el.clientWidth;
    const right = (k: HTMLElement) => k.offsetLeft + k.offsetWidth;
    if (!kids.length || right(kids[kids.length - 1]) <= room) { setFit(kids.length); return; }
    if (!iconsOnly) { setAuto(true); setFit(null); return; }
    const reserve = 46;                                                    // the width of the "more" button
    let n = 0;
    while (n < kids.length && right(kids[n]) <= room - reserve) n++;
    setFit(Math.max(1, n));
  }, [fit, sig, auto]);
  const shownGroups = fit === null || fit >= groups.length ? groups : groups.slice(0, fit);
  const hidden = fit === null || fit >= groups.length ? [] : groups.slice(fit);
  const hiddenItems: SlotItem[] = hidden.flatMap((g) => g.entries.flatMap((e) => (typeof e === 'string' ? [e] : e.ids)).map((id) => byId.get(id)).filter((c): c is Command => !!c).map(commandToItem));

  const entry = (e: RibbonEntry, gi: number, ei: number) => {
    if (typeof e === 'string') {
      const c = byId.get(e)!;
      return <Slot key={e} id={c.id} items={[commandToItem(c)]} variant="ribbon" labels={!iconsOnly} caption={p.caption} side="bottom" />;
    }
    const items = e.ids.map((id) => commandToItem(byId.get(id)!));
    return <Slot key={e.slot + gi + ei} id={e.slot} items={items} variant="ribbon" labels={!iconsOnly} caption={p.caption} side="bottom" menu={e.menu} keepOpen={e.keepOpen} radio={e.radio} icon={e.icon} title={e.title ? t(e.title, undefined, e.title) : undefined} />;
  };

  return (
    <div class={'ribbon' + (iconsOnly ? ' icons-only' : '')}>
      <div class="rb-tabs">
        {tabs.map((tab) => (
          <button key={tab} class={'rb-tab' + (tab === p.activeTab ? ' on' : '')} onClick={() => p.onTab(tab)}>
            {t('tab.' + tab, undefined, tab)}
          </button>
        ))}
      </div>
      <div class="rb-groups" ref={row}>
        {shownGroups.map((g, gi) => (
          <div class="rb-group" key={g.id} role="group" aria-label={t('group.' + g.id, undefined, g.id)}>
            <div class="rb-items">{g.entries.map((e, ei) => entry(e, gi, ei))}</div>
            {iconsOnly ? null : <div class="rb-gtitle">{t('group.' + g.id, undefined, g.id)}</div>}
          </div>
        ))}
        {hidden.length ? (
          <div class="rb-group rb-more">
            <div class="rb-items"><Slot id="ribbon-more" items={hiddenItems} variant="ribbon" labels={!iconsOnly} menu icon="more" title={t('ui.ribbon.more')} side="bottom" class="rb-overflow" /></div>
            {iconsOnly ? null : <div class="rb-gtitle">&nbsp;</div>}
          </div>
        ) : null}
      </div>
    </div>
  );
}
