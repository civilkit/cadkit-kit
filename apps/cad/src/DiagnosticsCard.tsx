// The failure card: one summary sentence, the root cause with plain advice, and the later errors folded away.
import { useState } from 'preact/hooks';
import { t } from '@kit/i18n';
import { adviceOf, consequenceText, featureTag, summaryLine } from './diagnosticsText';
import { rawErrorText, type Diagnosis } from './errorSummary';

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
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const d = p.diagnosis;
  const root = d.roots[0];
  if (!root) return null;
  const variant = p.variant ?? 'drawer';
  const n = d.consequences.length;
  const copy = async () => { if (await copyText(rawErrorText(d))) { setCopied(true); setTimeout(() => setCopied(false), 1500); } };
  return (
    <div class={'diag diag-' + variant} role="alert" data-root={root.id}>
      <p class="diag-summary">{summaryLine(d)}</p>
      {p.note ? <p class="diag-note">{p.note}</p> : null}
      {variant === 'drawer' ? (
        <div class="diag-root">
          <div class="diag-root-head"><b>{featureTag(root)}</b><code class="diag-code">{root.code}</code></div>
          <p class="diag-advice"><span class="diag-label">{t('diag.try')}</span> {p.message ?? adviceOf(root)}</p>
        </div>
      ) : <p class="diag-advice">{p.message ?? adviceOf(root)}</p>}
      <div class="diag-actions">
        {(p.fixes ?? []).map((f) => <button key={f.key} type="button" class="btn diag-fix" data-fix={f.key} onClick={f.run}>{f.label}</button>)}
        {p.onCancel ? <button type="button" class="btn diag-cancel" onClick={p.onCancel}>{t('diag.cancel')}</button> : null}
        {!p.onCancel && p.onUndo ? <button type="button" class="btn diag-undo" onClick={p.onUndo}>{t('diag.undo')}</button> : null}
        <button type="button" class="btn diag-select" onClick={() => p.onSelect(root.id)}>{t('diag.select', { id: root.id })}</button>
        {n ? <button type="button" class="btn diag-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t('diag.hideConsequences') : t('diag.showConsequences', { count: n })}</button> : null}
        <button type="button" class="btn diag-copy" onClick={copy} title={t('app.diagnostics.copy')}>{copied ? t('app.diagnostics.copied') : t('app.diagnostics.copy')}</button>
      </div>
      {open && n ? (
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
    </div>
  );
}
