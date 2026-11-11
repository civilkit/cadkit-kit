// What to make of a STEP or SketchUp file: a thing saved with the part (a feature, a reference mesh) or a view-only body. The choice is
// remembered per kind (localStorage), the first option is the default. SketchUp also asks about hidden geometry.
import { useEffect, useState } from 'preact/hooks';
import { t } from '../i18n';
import './files.css';
import './strings';

export type ImportKind = 'step' | 'skp';
export type ImportChoice = 'saved' | 'view';

const KEY = (k: ImportKind) => `cad.import.${k}`;
/** The remembered choice for a kind; `saved` (the first option) when none. */
export function readChoice(k: ImportKind, kv: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): ImportChoice {
  try { return kv?.getItem(KEY(k)) === 'view' ? 'view' : 'saved'; } catch { return 'saved'; }
}
export function writeChoice(k: ImportKind, c: ImportChoice, kv: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { kv?.setItem(KEY(k), c); } catch { /* private window */ }
}

export function ImportKindDialog(p: { kind: ImportKind; name: string; initial: ImportChoice; hidden?: boolean; onImport(choice: ImportChoice, hidden: boolean): void; onCancel(): void }) {
  const [choice, setChoice] = useState<ImportChoice>(p.initial);
  const [hidden, setHidden] = useState(!!p.hidden);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); p.onCancel(); } };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, []);
  const opts: ImportChoice[] = ['saved', 'view'];
  const step = p.kind === 'step';
  const title = step ? t('files.kind.step.title', { name: p.name }) : t('files.kind.skp.title', { name: p.name });
  const label = (o: ImportChoice) => (step ? (o === 'saved' ? t('files.kind.step.saved') : t('files.kind.step.view')) : (o === 'saved' ? t('files.kind.skp.saved') : t('files.kind.skp.view')));
  const hint = (o: ImportChoice) => (step ? (o === 'saved' ? t('files.kind.step.saved.hint') : t('files.kind.step.view.hint')) : (o === 'saved' ? t('files.kind.skp.saved.hint') : t('files.kind.skp.view.hint')));
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onCancel(); }}>
      <div class="dlg discard-dlg import-kind" role="dialog" aria-label={title} data-testid="import-kind">
        <div class="dlg-head"><b>{title}</b></div>
        <div class="discard-body import-kind-body" role="radiogroup" aria-label={t('files.kind.group')}>
          {opts.map((o) => (
            <label key={o} class={'import-kind-opt' + (choice === o ? ' on' : '')}>
              <input type="radio" name="import-kind" value={o} checked={choice === o} data-testid={`import-kind-${o}`} onChange={() => setChoice(o)} />
              <span class="import-kind-text">
                <b>{label(o)}</b>
                <small>{hint(o)}</small>
              </span>
            </label>
          ))}
          {p.kind === 'skp' ? (
            <label class="import-kind-check">
              <input type="checkbox" checked={hidden} data-testid="import-kind-hidden" onChange={(e) => setHidden((e.currentTarget as HTMLInputElement).checked)} />
              <span>{t('files.kind.skp.hidden')}</span>
            </label>
          ) : null}
        </div>
        <div class="discard-actions">
          <button class="rb-btn" data-testid="import-kind-cancel" onClick={p.onCancel}>{t('files.kind.cancel')}</button>
          <button class="rb-btn ok" autofocus data-testid="import-kind-ok" onClick={() => { writeChoice(p.kind, choice); p.onImport(choice, hidden); }}>{t('files.kind.ok')}</button>
        </div>
      </div>
    </div>
  );
}
