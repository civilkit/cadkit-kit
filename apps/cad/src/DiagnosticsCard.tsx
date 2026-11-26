// The failure card: one summary sentence, the root cause with plain advice, and the later errors folded away.
import { useState } from 'preact/hooks';
import { t } from '@kit/i18n';
import { composeMessage, consequenceText, featureTag, type MsgState } from './diagnosticsText';
import { rawErrorText, type Diagnosis } from './errorSummary';
import type { WarningEntry } from './featureWarnings';

export interface DiagnosticsCardProps {
  diagnosis: Diagnosis;
  /** `editor`: short, in the narrow editor panel. `drawer`: the full card. */
  variant?: 'editor' | 'drawer';
  /** Select the feature in the tree (and frame it). */
  onSelect(id: string): void;
  /** Undo the change that broke the model (committed models only). */
  onUndo?(): void;
  /** Close the open editor without applying the change. */
  onCancel?(): void;
  /** Which of the three situations this is; by default the editor variant is a refused preview, a note makes it a rejected edit, else a committed failure. */
  state?: MsgState;
  /** Why this is shown: the edit was refused and the model is unchanged. */
  note?: string;
  /** Replaces the root cause's advice line (an editor that knows a better sentence, e.g. for a cut that misses the body). */
  message?: string;
  /** One-click fixes shown as buttons (`Use suggested thickness`, `Flip direction`). */
  fixes?: Array<{ key: string; label: string; run(): void }>;
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* no clipboard permission */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

export function DiagnosticsCard(p: DiagnosticsCardProps) {
  const [copied, setCopied] = useState(false);
  const d = p.diagnosis;
  const root = d.roots[0];
  if (!root) return null;
  const variant = p.variant ?? 'drawer';
  // three situations, three leads: a preview that could not be built (editor open, amber), an edit that was refused (amber), a committed feature that no longer builds (red)
  const state: MsgState = p.state ?? (variant === 'editor' ? 'preview' : p.note ? 'rejected' : 'failed');
  const m = composeMessage(d, state);
  const action = p.message ?? m.action;
  const copy = async () => { if (await copyText(rawErrorText(d))) { setCopied(true); setTimeout(() => setCopied(false), 1500); } };
  // in an editor the causes live in the alert icon's popover beside the title (one place, however many causes): the card only carries the one-click fixes
  if (variant === 'editor') {
    return p.fixes?.length ? <div class="diag diag-editor diag-fixes" data-root={root.id} data-state={state}>
      <div class="diag-actions">{p.fixes.map((f) => <button key={f.key} type="button" class="btn diag-fix" data-fix={f.key} onClick={f.run}>{f.label}</button>)}</div>
    </div> : null;
  }
  return (
    <div class={'diag diag-' + variant + (state === 'failed' ? ' diag-red' : ' diag-amber')} role="alert" data-root={root.id} data-state={state}>
      {state === 'failed'
        ? <button type="button" class="diag-lead diag-lead-link" onClick={() => p.onSelect(root.id)}>{m.lead}</button>
        : m.lead ? <p class="diag-lead">{m.lead}</p> : null}
      <p class="diag-cause">{m.cause}</p>
      {action ? <p class="diag-advice">{action}</p> : null}
      {p.fixes?.length || p.onCancel || (!p.onCancel && p.onUndo) ? (
        <div class="diag-actions">
          {(p.fixes ?? []).map((f) => <button key={f.key} type="button" class="btn diag-fix" data-fix={f.key} onClick={f.run}>{f.label}</button>)}
          {p.onCancel ? <button type="button" class="btn diag-cancel" onClick={p.onCancel}>{t('diag.cancel')}</button> : null}
          {!p.onCancel && p.onUndo ? <button type="button" class="btn diag-undo" onClick={p.onUndo}>{t('diag.undo')}</button> : null}
        </div>
      ) : null}
      <details class="diag-details">
        <summary>{t('diag.details')}</summary>
        <p class="diag-note"><code class="diag-code">{root.code}</code> {featureTag(root)}</p>
        {d.consequences.length ? (
          <div class="diag-list">
            <p class="diag-note">{t('diag.consequencesNote')}</p>
            <ul>
              {d.consequences.map((c) => (
                <li key={c.id}><button type="button" class="diag-item" data-id={c.id} onClick={() => p.onSelect(c.id)}>{consequenceText(c)}</button></li>
              ))}
            </ul>
          </div>
        ) : null}
        {d.roots.length > 1 ? (
          <ul class="diag-others">
            {d.roots.slice(1).map((r) => <li key={r.id}><button type="button" class="diag-item" data-id={r.id} onClick={() => p.onSelect(r.id)}>{featureTag(r)}: {r.code}</button></li>)}
          </ul>
        ) : null}
        <div class="diag-actions">
          <button type="button" class="btn diag-select" onClick={() => p.onSelect(root.id)}>{t('diag.select', { id: root.id })}</button>
          <button type="button" class="btn diag-copy" onClick={copy} title={t('app.diagnostics.copy')}>{copied ? t('app.diagnostics.copied') : t('app.diagnostics.copy')}</button>
        </div>
      </details>
    </div>
  );
}

/** The committed build's warnings (features that built but are flagged), below the errors: one entry per warning with a
 *  Warning tag, the feature as a link that selects it in the tree, what is wrong and what to do. */
export function DiagnosticsWarnings(p: { entries: WarningEntry[]; onSelect(id: string): void; /** the entries only inform (what a feature did): an Info tag, not a Warning */ info?: boolean }) {
  if (!p.entries.length) return null;
  return (
    <div class="diag-warnings">
      {p.entries.map((e, i) => (
        <div key={e.featureId + ':' + i} class={p.info ? 'issue diag-warning diag-info' : 'issue warn diag-warning'} data-warning={e.code} data-id={e.featureId}>
          <span class={p.info ? 'diag-tag diag-tag-info' : 'diag-tag'}>{t(p.info ? 'diag.info.tag' : 'diag.warning.tag')}</span>{' '}
          <button type="button" class="diag-item" data-id={e.featureId} onClick={() => p.onSelect(e.featureId)}>{featureTag({ id: e.featureId, label: e.label })}</button>
          <div class="why">{e.text}</div>
          {e.advice ? <div class="why diag-advice">{e.advice}</div> : null}
        </div>
      ))}
    </div>
  );
}
