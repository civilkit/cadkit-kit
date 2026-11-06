// The Frame panel: choose a skeleton sketch (its lines become members), a stock profile from the library, mitre or butt corners and
// the turn of the section. Every change goes to onDraft (the app previews the frame live); Create adds one `frame` feature (Update
// replaces it when the panel reopened one), Escape / the cross cancels. Rules and the cut list: frameLib.ts.
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from '../i18n';
import { FAMILIES, PROFILES, profileById, type Corner, type FrameParams } from './frameLib';

export interface FramePanelProps {
  params: FrameParams;
  /** the document's sketches that have lines */
  skeletons: Array<{ id: string; label: string; lines: string[] }>;
  onDraft(next: FrameParams): void;
  onApply(next: FrameParams): void;
  onCancel(): void;
  /** the live preview's failure, or null when it is current */
  hint?: string | null;
  /** the panel reopened an existing frame: Update replaces it */
  edit?: boolean;
}

export function FramePanel(p: FramePanelProps): JSX.Element {
  const [draft, setDraft] = useState<FrameParams>(() => (p.params.sketch || !p.skeletons.length ? p.params : { ...p.params, sketch: p.skeletons[p.skeletons.length - 1].id }));
  useEffect(() => { if (draft.sketch) p.onDraft(draft); }, []);
  const change = (patch: Partial<FrameParams>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (next.sketch) p.onDraft(next);
  };
  const sk = p.skeletons.find((s) => s.id === draft.sketch) ?? null;
  const blocked = !sk || !profileById(draft.profile);
  const apply = (): void => { if (!blocked) p.onApply(draft); };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON') { e.preventDefault(); apply(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  const used = draft.segments ?? sk?.lines ?? [];
  const toggle = (id: string): void => {
    if (!sk) return;
    const set = new Set(used);
    if (set.has(id)) set.delete(id); else set.add(id);
    const list = sk.lines.filter((l) => set.has(l));
    change({ segments: list.length === sk.lines.length ? null : list });
  };
  return (
    <div class="fedit thread-editor prop-wizard frame-panel" tabIndex={0} onKeyDown={onKey} data-testid="frame-panel">
      <div class="fedit-head">
        <Icon name="add-frame" size={22} class="fedit-icon" />
        <div class="fedit-title">{t(p.edit ? 'frame.titleEdit' : 'frame.title')}</div>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="fedit-sec-fields prop-body">
        {!p.skeletons.length ? <div class="thread-fit bad" role="alert" data-testid="frame-no-skeleton">{t('frame.noSkeleton')}</div> : (
          <>
            <label class="fedit-fld" data-path="sketch">
              <span class="fedit-fld-label">{t('frame.skeleton')}</span>
              <select value={draft.sketch ?? ''} aria-label={t('frame.skeleton')} onChange={(e) => change({ sketch: (e.currentTarget as HTMLSelectElement).value, segments: null })}>
                {p.skeletons.map((s) => <option key={s.id} value={s.id}>{t('frame.skeletonOption', { name: s.label, n: s.lines.length })}</option>)}
              </select>
            </label>
            {sk && sk.lines.length > 1 ? (
              <div class="fedit-fld frame-segments" data-path="segments">
                <span class="fedit-fld-label">{t('frame.members', { n: used.length, of: sk.lines.length })}</span>
                <span class="frame-seg-list">
                  {sk.lines.map((l) => (
                    <label key={l} class="frame-seg"><input type="checkbox" checked={used.includes(l)} onChange={() => toggle(l)} aria-label={l} />{l}</label>
                  ))}
                </span>
              </div>
            ) : null}
            <label class="fedit-fld" data-path="profile">
              <span class="fedit-fld-label">{t('frame.profile')}</span>
              <select value={draft.profile} aria-label={t('frame.profile')} onChange={(e) => {
                const id = (e.currentTarget as HTMLSelectElement).value;
                change({ profile: id, corner: profileById(id)?.corner ?? draft.corner });
              }}>
                {FAMILIES.map((fam) => (
                  <optgroup key={fam} label={t('frame.family.' + fam, undefined, fam)}>
                    {PROFILES.filter((x) => x.family === fam).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label class="fedit-fld" data-path="corner">
              <span class="fedit-fld-label">{t('frame.corner')}</span>
              <select value={draft.corner} aria-label={t('frame.corner')} onChange={(e) => change({ corner: (e.currentTarget as HTMLSelectElement).value as Corner })}>
                <option value="mitre">{t('frame.corner.mitre')}</option>
                <option value="butt">{t('frame.corner.butt')}</option>
              </select>
            </label>
            <label class="fedit-fld" data-path="rotate">
              <span class="fedit-fld-label">{t('frame.rotate')}</span>
              <span class="fedit-num">
                <input type="number" step={15} value={String(draft.rotate)} aria-label={t('frame.rotate')}
                  onChange={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); if (Number.isFinite(v)) change({ rotate: v }); }} />
                <span class="fedit-unit">deg</span>
              </span>
            </label>
            <div class="thread-hint" data-testid="frame-note">{t('frame.note')}</div>
            {p.hint ? <div class="fedit-hint" role="alert" data-testid="frame-hint">{p.hint}</div> : null}
          </>
        )}
      </div>
      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid="frame-cancel" onClick={p.onCancel}>{t('ui.cancel', undefined, 'Cancel')}</button>
        <button type="button" class="fedit-card-btn prop-create" data-testid="frame-apply" disabled={blocked} aria-disabled={blocked} onClick={apply}>{t(p.edit ? 'frame.update' : 'frame.apply')}</button>
      </div>
    </div>
  );
}
