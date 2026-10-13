import type { JSX } from 'preact';

export interface Command { id: string; label: string; tab: string; group: string; icon?: string; keys?: string; enabled?(): boolean; run(): void }

export function Ribbon(p: { commands: Command[]; activeTab: string; onTab(t: string): void }): JSX.Element {
  const tabs = [...new Set(p.commands.map((c) => c.tab))];
  const shown = p.commands.filter((c) => c.tab === p.activeTab);
  const groups = [...new Set(shown.map((c) => c.group))];
  return (
    <div class="ribbon">
      <div class="rb-tabs">
        {tabs.map((t) => (
          <button key={t} class={'rb-tab' + (t === p.activeTab ? ' on' : '')} onClick={() => p.onTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div class="rb-groups">
        {groups.map((g) => (
          <div class="rb-group" key={g}>
            {shown.filter((c) => c.group === g).map((c) => (
              <button
                key={c.id}
                class="rb-btn"
                disabled={c.enabled ? !c.enabled() : false}
                onClick={() => c.run()}
              >
                {c.icon ? <span class="rb-icon">{c.icon}</span> : null}
                {c.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
