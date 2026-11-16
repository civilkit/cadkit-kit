// Recognise features (beta): what quiddity found in the imported STEP file, what was rebuilt, and whether the rebuild is the same solid.
// The result opens as a new part; the imported one is never changed.
import { useEffect, useState } from 'preact/hooks';
import { t } from '../i18n';
import '../files/files.css';
import './strings';
import { verdictOf } from './analyse';
import type { Outcome } from './rebuild';
export type { Outcome } from './rebuild';

export type Stage = 'loading' | 'checking';

const stockText = (s: 'box' | 'prism' | 'turned') => (s === 'turned' ? t('recog.stock.turned') : s === 'prism' ? t('recog.stock.prism') : t('recog.stock.box'));
const ratioText = (r: number): string => (r >= 10 ? Math.round(r).toString() : r.toFixed(1));
const verdictText = (v: 'match' | 'close' | 'differs' | 'invalid', pctText: string, ratio: number): string => (v === 'match' ? t('recog.verdict.match', { pct: pctText })
  : v === 'close' ? t('recog.verdict.close', { pct: pctText })
  : v === 'differs' ? (ratio > 1 ? t('recog.verdict.larger', { times: ratioText(ratio) }) : t('recog.verdict.smaller', { pct: pctText }))
  : t('recog.verdict.invalid'));
/** The words for a group of features that were left out, by why: plain text from the code, never the converter's internal wording. */
const skipText = (code: string | undefined, family: string, count: number): string => {
  const lower = family.replace(/_/g, ' ');
  const name = lower.charAt(0).toUpperCase() + lower.slice(1);
  return code === 'fillet-corner' ? t('recog.skip.filletCorner', { count })
    : code === 'fillet-kind' ? t('recog.skip.filletKind', { count })
    : code === 'pocket-shape' ? t('recog.skip.pocketShape', { count })
    : code === 'kernel' ? t('recog.skip.kernel', { count, family: name })
    : code === 'stock' ? t('recog.skip.stock')
    : t('recog.skip.family', { count, family: name });
};
function groupSkipped(list: Array<{ id: string; code?: string; family?: string }>): Array<{ key: string; code?: string; family: string; ids: string[] }> {
  const m = new Map<string, { key: string; code?: string; family: string; ids: string[] }>();
  for (const s of list) {
    const family = s.family ?? s.id.split('/')[0];
    const key = `${s.code ?? ''}|${family}`;
    const g = m.get(key) ?? { key, code: s.code, family, ids: [] };
    g.ids.push(s.id); m.set(key, g);
  }
  return [...m.values()];
}
const pct = (x: number) => `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`;
const mm3 = (v: number) => Math.round(v).toLocaleString();

export function RecogniseDialog(p: { name: string; run(stage: (s: Stage) => void): Promise<Outcome>; onOpen(script: string): void; onCopy(script: string): void; onClose(): void }) {
  const [stage, setStage] = useState<Stage>('loading');
  const [out, setOut] = useState<Outcome | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    p.run((s) => { if (live) setStage(s); }).then((o) => { if (live) setOut(o); }, (e) => { if (live) setErr(String((e as Error).message ?? e)); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); p.onClose(); } };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, []);

  const a = out?.analysis;
  const check = a && out?.rebuilt?.ok ? verdictOf(out.rebuilt.volume, a.fileVolume, out.rebuilt.valid) : null;
  // only a rebuild that is the same solid or close to it is offered as a new part; a larger or smaller one is shown (and its script can be copied), not offered
  const canOpen = !!a?.script && !!out?.rebuilt?.ok && (check?.verdict === 'match' || check?.verdict === 'close');
  const families = a ? Object.entries(a.found).sort((x, y) => y[1] - x[1]) : [];
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="dlg discard-dlg recog" role="dialog" aria-label={t('recog.title')} data-testid="recog">
        <div class="dlg-head"><b>{t('recog.title')}</b> <span class="recog-name">{p.name}</span></div>
        <div class="discard-body recog-body">
          {err ? <p data-testid="recog-error">{err === 'missing' ? t('recog.missing') : t('recog.error', { message: err })}</p>
            : !a ? <p data-testid="recog-wait">{stage === 'loading' ? t('recog.loading') : t('recog.checking')}</p>
            : (
              <>
                <p class="recog-line"><b>{t('recog.found')}</b>: {families.length ? families.map(([f, n]) => `${f.replace(/_/g, ' ')} ${n}`).join(', ') : t('recog.found.none')}</p>
                {a.stock ? <p class="recog-line"><b>{t('recog.stock')}</b>: {stockText(a.stock)}</p> : null}
                <p class="recog-line" data-testid="recog-count">{t('recog.rebuilt', { done: a.handled.length, total: a.handled.length + a.skipped.length })}</p>
                {check ? (
                  <p class={'recog-verdict ' + check.verdict} data-testid="recog-verdict" data-verdict={check.verdict}>
                    {verdictText(check.verdict, pct(check.difference), check.ratio)}
                  </p>
                ) : out?.rebuilt && !out.rebuilt.ok ? <p class="recog-verdict invalid" data-testid="recog-verdict" data-verdict="failed">{t('recog.verdict.failed', { message: out.rebuilt.message })}</p>
                  : <p class="recog-verdict invalid" data-testid="recog-verdict" data-verdict="none">{t('recog.found.none')}</p>}
                {out?.rebuilt?.ok ? <p class="recog-line recog-vol">{t('recog.volumes', { file: mm3(a.fileVolume), rebuilt: mm3(out.rebuilt.volume) })}</p> : null}
                {a.skipped.length ? (
                  <details class="recog-skipped">
                    <summary>{t('recog.skipped', { count: a.skipped.length })}</summary>
                    <ul>{groupSkipped(a.skipped).map((g) => <li key={g.key} title={g.ids.join(', ')}>{skipText(g.code, g.family, g.ids.length)}</li>)}</ul>
                  </details>
                ) : null}
              </>
            )}
          <small class="recog-note">{t('recog.note')}</small>
        </div>
        <div class="discard-actions">
          <button class="rb-btn" data-testid="recog-close" onClick={p.onClose}>{t('recog.close')}</button>
          <button class="rb-btn" data-testid="recog-copy" disabled={!a?.script} onClick={() => a?.script && p.onCopy(a.script)}>{t('recog.copy')}</button>
          <button class="rb-btn ok" data-testid="recog-open" disabled={!canOpen} onClick={() => a?.script && p.onOpen(a.script)}>{t('recog.open')}</button>
        </div>
      </div>
    </div>
  );
}
