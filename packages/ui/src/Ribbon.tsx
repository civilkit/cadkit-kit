import type { JSX } from 'preact';
import { t } from './i18n';
import { Icon, hasIcon } from './icons';
import { Tip } from './Tip';

export interface Command { id: string; label: string; tab: string; group: string; icon?: string; keys?: string; /** A sentence for the tooltip under the label. */ tip?: string; enabled?(): boolean; pressed?(): boolean; run(): void }

export function Ribbon(p: { commands: Command[]; activeTab: string; onTab(t: string): void; labels?: 'icons' | 'icons-and-text' }): JSX.Element {
  const tabs = [...new Set(p.commands.map((c) => c.tab))];
  const shown = p.commands.filter((c) => c.tab === p.activeTab);
  const iconsOnly = p.labels === 'icons';
  const groups = [...new Set(shown.map((c) => c.group))];
  return (
    <div class="ribbon">
      <div class="rb-tabs">
        {tabs.map((tab) => (
          <button key={tab} class={'rb-tab' + (tab === p.activeTab ? ' on' : '')} onClick={() => p.onTab(tab)}>
            {t('tab.' + tab, undefined, tab)}
          </button>
        ))}
      </div>
      <div class="rb-groups">
        {groups.map((g) => (
          <div class="rb-group" key={g}>
            {shown.filter((c) => c.group === g).map((c) => {
              const pressed = c.pressed ? c.pressed() : undefined;
              const icon = hasIcon(c.id) ? <Icon name={c.id} size={iconsOnly ? 20 : 16} /> : c.icon ? <span class="rb-icon">{c.icon}</span> : null;
              const btn = (
                <button
                  key={c.id}
                  class={'rb-btn' + (iconsOnly ? ' icon-only' : '')}
                  disabled={c.enabled ? !c.enabled() : false}
                  aria-pressed={pressed}
                  aria-label={iconsOnly ? c.label : undefined}
                  onClick={() => c.run()}
                >
                  {icon}
                  {iconsOnly && hasIcon(c.id) ? null : c.label}
                </button>
              );
              return iconsOnly && hasIcon(c.id) ? <Tip key={c.id} label={c.label} keys={c.keys} hint={c.tip}>{btn}</Tip> : btn;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
