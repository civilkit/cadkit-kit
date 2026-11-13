// The Material editor (left panel, Editor tab): a searchable list of materials grouped by category, a live swatch with the
// properties of the one picked, a custom entry (name, density, colour) kept in the browser, the "Use material colour" toggle
// and the mass of the current part at the new density. OK applies (one undo step in the controller), Cancel / Escape leaves.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon, textAttrs } from '@kit/ui';
import { t } from './i18n';
import { massText } from './inspect/mass';
import {
  allMaterials, findMaterial, groupMaterials, loadCustom, massGrams, removeCustom, saveUseColour, subgroups, upsertCustom,
  type MaterialDef,
} from './materials';

export interface MaterialChoice {
  /** the name written to the document's `material` */
  name: string;
  def: MaterialDef;
  useColour: boolean;
}

export interface MaterialEditorProps {
  /** the part's material now (its name) */
  current: string | undefined;
  /** volume of the part in mm3 from the Inspect mass-properties path; null when the part has no solid */
  loadVolume(): Promise<number | null>;
  useColour: boolean;
  onApply(choice: MaterialChoice): void;
  onCancel(): void;
}

const NEW = 'custom:new';
const dens = (d: number): string => `${+d.toPrecision(5)} kg/m³`;

export function MaterialEditor(p: MaterialEditorProps): JSX.Element {
  const [custom, setCustom] = useState<MaterialDef[]>(() => loadCustom());
  const start = findMaterial(p.current, custom);
  const [sel, setSel] = useState<string>(start?.id ?? NEW);
  const [query, setQuery] = useState('');
  const [useColour, setUseColour] = useState(p.useColour);
  const [volume, setVolume] = useState<number | null | undefined>(undefined);   // undefined: still reading
  const [draft, setDraft] = useState<{ name: string; density: string; color: string }>({ name: start?.custom ? start.name : start ? '' : (p.current ?? '').trim(), density: start?.custom ? String(start.density) : '', color: start?.custom ? start.color : '#b8c4d6' });
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => { let live = true; void p.loadVolume().then((v) => { if (live) setVolume(v); }, () => { if (live) setVolume(null); }); return () => { live = false; }; }, []);
  useEffect(() => { root.current?.querySelector<HTMLInputElement>('.mat-search')?.focus(); }, []);

  const list = allMaterials(custom);
  const isNew = sel === NEW;
  const picked = list.find((x) => x.id === sel) ?? null;
  const editingCustom = isNew || !!picked?.custom;
  const dNum = parseFloat(draft.density);
  const draftDef: MaterialDef | null = editingCustom && draft.name.trim() && Number.isFinite(dNum) && dNum > 0
    ? { id: 'custom:' + draft.name.trim().toLowerCase(), name: draft.name.trim(), category: 'Custom', density: dNum, color: draft.color, custom: true } : null;
  const shown: MaterialDef | null = editingCustom ? draftDef : picked;
  const nameClash = editingCustom && draftDef !== null && list.some((x) => !x.custom && x.name.toLowerCase() === draftDef.name.toLowerCase());
  const valid = shown !== null && !nameClash;
  const groups = groupMaterials(list, query);

  const pick = (m: MaterialDef): void => {
    setSel(m.id);
    if (m.custom) setDraft({ name: m.name, density: String(m.density), color: m.color });
  };
  const choose = (): void => {
    if (!shown || nameClash) return;
    if (shown.custom) setCustom(upsertCustom(shown));
    saveUseColour(useColour);
    p.onApply({ name: shown.name, def: shown, useColour });
  };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'TEXTAREA') { e.preventDefault(); choose(); }
    else if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };

  const nowDef = findMaterial(p.current, custom);
  const mass = shown && typeof volume === 'number' ? massGrams(volume, shown.density) : null;
  const was = nowDef && typeof volume === 'number' ? massGrams(volume, nowDef.density) : null;

  return (
    <div class="fedit mat-editor" ref={root} tabIndex={0} onKeyDown={onKey} data-testid="material-editor">
      <div class="fedit-head">
        <Icon name="ref-material" size={22} class="fedit-icon" />
        <div class="fedit-title">{t('material.title')}</div>
        <button type="button" class="fedit-confirm" disabled={!valid} onClick={choose} title={t('material.apply')} aria-label={t('material.apply')}><Icon name="check" size={20} /></button>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="fedit-sec">
        <input {...textAttrs} type="search" enterKeyHint="search" class="mat-search" value={query} placeholder={t('material.search')} aria-label={t('material.search')} onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
        <div class="mat-list" role="listbox" aria-label={t('material.list')}>
          {groups.map((g) => (
            <div key={g.category} data-category={g.category}>
              <div class="mat-cat">{t('material.cat.' + g.category)}</div>
              {subgroups(g.items).map((sg, _i, all) => (
                <div key={sg.key} data-subgroup={sg.key}>
                  {all.length > 1 ? <div class="mat-sub">{sg.region ? `${t('material.region.' + sg.region)} / ${sg.standard}` : t('material.general')}</div> : null}
                  {sg.items.map((m) => (
                    <div key={m.id} class="mat-item" role="option" tabIndex={-1} aria-selected={sel === m.id} data-material={m.id} onClick={() => pick(m)} onDblClick={() => { pick(m); choose(); }}>
                      <span class="mat-chip" style={{ background: m.color }} />
                      <span>{m.name}</span>
                      {m.verified === false ? <span class="mat-badge" data-testid="material-unverified-badge" title={t('material.unverified.tip')}>{t('material.unverified')}</span> : null}
                      <span class="mat-dens">{dens(m.density)}</span>
                      {m.custom ? <button type="button" class="ref-edit" style={{ opacity: 1 }} aria-label={t('material.remove', { name: m.name })} title={t('material.remove', { name: m.name })} onClick={(e) => { e.stopPropagation(); setCustom(removeCustom(m.id)); if (sel === m.id) setSel(NEW); }}><Icon name="close" size={12} /></button> : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
          {!query.trim() || t('material.cat.Custom').toLowerCase().includes(query.trim().toLowerCase()) || t('material.new').toLowerCase().includes(query.trim().toLowerCase()) ? (
            <div>
              {groups.some((g) => g.category === 'Custom') ? null : <div class="mat-cat">{t('material.cat.Custom')}</div>}
              <div class="mat-item" role="option" tabIndex={-1} aria-selected={isNew} data-material={NEW} onClick={() => { setSel(NEW); }}>
                <span class="mat-chip" style={{ background: draft.color }} /><span>{t('material.new')}</span>
              </div>
            </div>
          ) : null}
          {groups.length === 0 && query.trim() && !t('material.new').toLowerCase().includes(query.trim().toLowerCase()) ? <div class="fedit-hint" style={{ padding: 8 }}>{t('material.none')}</div> : null}
        </div>
      </div>

      {editingCustom ? (
        <div class="fedit-sec" data-section="custom">
          <label class="fedit-fld" data-path="name"><span class="fedit-fld-label">{t('material.name')}</span>
            <input {...textAttrs} type="text" value={draft.name} aria-label={t('material.name')} onInput={(e) => setDraft({ ...draft, name: (e.currentTarget as HTMLInputElement).value })} /></label>
          <label class="fedit-fld" data-path="density"><span class="fedit-fld-label">{t('material.density')}</span>
            <span class="fedit-num"><input type="number" inputMode="decimal" enterKeyHint="done" min="0" step="any" value={draft.density} aria-label={t('material.density')} onInput={(e) => setDraft({ ...draft, density: (e.currentTarget as HTMLInputElement).value })} /><span class="fedit-unit">kg/m³</span></span></label>
          <label class="fedit-fld" data-path="color"><span class="fedit-fld-label">{t('material.colour')}</span>
            <input type="color" value={draft.color} aria-label={t('material.colour')} onInput={(e) => setDraft({ ...draft, color: (e.currentTarget as HTMLInputElement).value })} /></label>
          {nameClash ? <div class="fedit-hint" role="alert">{t('material.nameTaken')}</div> : null}
        </div>
      ) : null}

      <div class="fedit-sec" data-section="preview">
        <div class="mat-preview">
          <span class="mat-swatch" data-testid="material-swatch" data-color={shown?.color ?? ''} style={{ background: shown?.color ?? 'transparent' }} />
          <div>
            <div><b>{shown?.name ?? t('material.pick')}</b></div>
            {shown ? <div class="mat-mass" data-testid="material-mass">
              {volume === undefined ? t('material.mass.reading') : mass === null ? t('material.mass.none')
                : <>{t('material.mass')}: {massText(mass)}{was !== null && nowDef && shown.density !== nowDef.density ? <span style={{ fontWeight: 400, opacity: 0.7 }}> ({t('material.mass.was', { mass: massText(was) })})</span> : null}</>}
            </div> : null}
          </div>
        </div>
        {shown ? (
          <dl class="mat-props">
            <dt>{t('material.density')}</dt><dd>{dens(shown.density)}</dd>
            {shown.youngs !== undefined ? <><dt>{t('material.youngs')}</dt><dd>{shown.youngs} GPa</dd></> : null}
            {shown.poisson !== undefined ? <><dt>{t('material.poisson')}</dt><dd>{shown.poisson}</dd></> : null}
            {shown.yield !== undefined ? <><dt>{t('material.yield')}</dt><dd>{shown.yield} MPa</dd></> : null}
            {shown.yieldAlt !== undefined ? <><dt>{t('material.yieldAlt')}</dt><dd data-testid="material-yield-alt">{shown.yieldAlt} MPa</dd></> : null}
            {shown.ultimate !== undefined ? <><dt>{t('material.ultimate')}</dt><dd>{shown.ultimate} MPa</dd></> : null}
            {shown.shear !== undefined ? <><dt>{t('material.shear')}</dt><dd>{shown.shear} GPa</dd></> : null}
            {shown.expansion !== undefined ? <><dt>{t('material.expansion')}</dt><dd>{shown.expansion} x 10⁻⁶ /K</dd></> : null}
            {shown.standard ? <><dt>{t('material.standard')}</dt><dd>{[shown.standard, shown.grade].filter(Boolean).join(' / ')}</dd></> : null}
            {shown.region ? <><dt>{t('material.region')}</dt><dd>{t('material.region.' + shown.region)}</dd></> : null}
          </dl>
        ) : null}
        {shown && shown.verified !== undefined ? (
          <div class={'mat-verify' + (shown.verified ? '' : ' is-unverified')} data-testid="material-verified" role={shown.verified ? undefined : 'note'}>
            {shown.verified ? t('material.verified') : t('material.unverified.note')}{shown.note ? <div class="mat-hint" data-testid="material-note">{shown.note}</div> : null}
          </div>
        ) : null}
        <label class="fedit-check" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={useColour} onChange={(e) => setUseColour((e.currentTarget as HTMLInputElement).checked)} data-testid="material-use-colour" />
          <span>{t('material.useColour')}</span>
        </label>
        <div class="mat-hint">{t('material.useColour.hint')}</div>
      </div>
      <div class="mat-actions">
        <button type="button" class="rb-btn" onClick={p.onCancel}>{t('ui.cancel', undefined, 'Cancel')}</button>
        <button type="button" class="rb-btn ok" disabled={!valid} onClick={choose} data-testid="material-ok">{t('material.ok')}</button>
      </div>
    </div>
  );
}
