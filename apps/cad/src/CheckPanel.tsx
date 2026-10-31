import type { JSX } from 'preact';
import { t } from './i18n';
import { groupIssues, severityCss, valueText, type Issue, type ProfileInfo, type ProfileReport } from './designCheck';
import { MODES, isDefault, parseParam, type Mode, type ProfileSettings } from './checkSettings';

export interface DesignCheckProps {
  profiles: ProfileInfo[] | null;
  profileId: string;
  onProfile(id: string): void;
  settings: ProfileSettings | null;
  onSettings(s: ProfileSettings): void;
  onReset(): void;
  afterEdit: boolean;
  onAfterEdit(on: boolean): void;
  showOnPart: boolean;
  onShowOnPart(on: boolean): void;
  report: ProfileReport | null;
  /** The part changed after the report was made. */
  stale: boolean;
  running: boolean;
  onRun(): void;
  onSelect(issue: Issue): void;
  onHover(issue: Issue | null): void;
}

export const plural = (kind: 'error' | 'warn' | 'info', n: number): string => t(`check.${kind}.${n === 1 ? 'one' : 'other'}`, { n });

/** The Check tab of the drawer: profile, run, rule modes and limits, and the issues grouped by severity. */
export function CheckPanel(p: DesignCheckProps): JSX.Element {
  const profile = p.profiles?.find((x) => x.id === p.profileId) ?? null;
  if (!p.profiles || !profile || !p.settings) return <div class="empty">{t('check.noProfiles')}</div>;
  const settings = p.settings;
  const setRule = (id: string, patch: Partial<{ mode: Mode; params: Record<string, number | number[]> }>) =>
    p.onSettings({ ...settings, [id]: { ...settings[id], ...patch } });
  const groups = p.report ? groupIssues(p.report.issues) : [];
  return (
    <div class={'dcheck' + (p.stale ? ' stale' : '')}>
      <div class="dcheck-bar">
        <label class="dcheck-pick">
          <span>{t('check.profile')}</span>
          <select aria-label={t('check.profile')} value={p.profileId} onChange={(e) => p.onProfile((e.currentTarget as HTMLSelectElement).value)}>
            {p.profiles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <button class="btn primary" disabled={p.running} onClick={p.onRun}>{p.running ? t('check.running') : t('check.run')}</button>
        <label class="dcheck-flag"><input type="checkbox" checked={p.showOnPart} onChange={(e) => p.onShowOnPart((e.currentTarget as HTMLInputElement).checked)} />{t('check.showOnPart')}</label>
        <label class="dcheck-flag" title={t('check.afterEdit.hint')}><input type="checkbox" checked={p.afterEdit} onChange={(e) => p.onAfterEdit((e.currentTarget as HTMLInputElement).checked)} />{t('check.afterEdit')}</label>
      </div>
      <details class="dcheck-rules">
        <summary>{t('check.rules')}</summary>
        {profile.rules.map((r) => {
          const s = settings[r.id];
          if (!s) return null;
          return (
            <div key={r.id} class={'dcheck-rule' + (s.mode === 'off' ? ' off' : '')}>
              <div class="dcheck-rule-head">
                <b title={r.description}>{r.title}</b>
                <select aria-label={r.title} value={s.mode} onChange={(e) => setRule(r.id, { mode: (e.currentTarget as HTMLSelectElement).value as Mode })}>
                  {MODES.map((m) => <option key={m} value={m}>{t('check.mode.' + m)}</option>)}
                </select>
              </div>
              {r.params.map((q) => {
                const v = s.params[q.name];
                const set = (val: number | number[]) => setRule(r.id, { params: { ...s.params, [q.name]: val } });
                const field = (x: number, onNum: (n: number) => void, label: string) => (
                  <input type="number" inputMode="decimal" enterKeyHint="done" step="any" min={q.min} max={q.max} value={x} aria-label={label} disabled={s.mode === 'off'}
                    onChange={(e) => { const n = parseParam((e.currentTarget as HTMLInputElement).value, q); if (n !== null) onNum(n); }} />
                );
                return (
                  <label key={q.name} class="dcheck-param" title={q.description}>
                    <span>{q.name}</span>
                    <span class="dcheck-vals">
                      {Array.isArray(v)
                        ? v.map((x, k) => <span key={k}>{field(x, (n) => set(v.map((y, j) => (j === k ? n : y))), `${q.name} ${'xyz'[k] ?? k}`)}</span>)
                        : field(v, (n) => set(n), q.name)}
                      {q.unit ? <span class="dcheck-unit">{q.unit}</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          );
        })}
        <button class="btn" disabled={isDefault(profile, settings)} onClick={p.onReset}>{t('check.reset')}</button>
      </details>
      {p.stale && p.report ? <div class="dcheck-note">{t('check.stale')}</div> : null}
      {!p.report ? <div class="empty">{t('check.none')}</div> : null}
      {p.report && groups.length === 0 ? <div class="dcheck-clean">{t('check.clean')}</div> : null}
      {groups.map((g) => (
        <section key={g.severity} class="dcheck-group" aria-label={t('check.severity.' + g.severity)}>
          <h4><span class="sw" style={{ background: severityCss(g.severity) }} />{t('check.severity.' + g.severity)} <span class="n">{g.issues.length}</span></h4>
          {g.issues.map((i, k) => (
            <button key={k} class="dcheck-issue" disabled={p.stale} onClick={() => p.onSelect(i)} onMouseEnter={() => p.onHover(i)} onMouseLeave={() => p.onHover(null)} onFocus={() => p.onHover(i)} onBlur={() => p.onHover(null)}>
              <span class="rule">{profile.rules.find((r) => r.id === i.rule)?.title ?? i.rule}</span>
              <span class="msg">{i.message}</span>
              {valueText(i) ? <span class="val">{valueText(i)}</span> : null}
            </button>
          ))}
        </section>
      ))}
      {p.report && p.report.summary.truncated.length ? <div class="dcheck-note">{t('check.truncated', { n: p.report.summary.truncated.reduce((a, x) => a + (x.total - x.shown), 0) })}</div> : null}
    </div>
  );
}
