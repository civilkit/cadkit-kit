// The Plugins panel: a list of the generators plugins add, then a form generated from the chosen generator's parameter list (packages/plugin).
// Every change goes to onChange with the whole value record (the app previews it live); Add commits one undo step, Escape / the cross cancels.
// Nothing here knows what a particular plugin does: fields, groups, units, "auto" for optional values and errors all come from the definitions.
import type { JSX } from 'preact';
import { Icon, kindForMin, numberAttrs, textAttrs } from '@kit/ui';
import { checkParams, defaultsOf, formModel, type FormField, type ParamDef, type PluginManager, type PluginRegistry, type Values } from '@kit/plugin';
import { PluginManage } from './PluginManage';
import { t } from './i18n';
import type { PluginSel } from './pluginRun';

export interface PluginPanelProps {
  registry: PluginRegistry;
  /** installs, switches and removes plugins; absent (tests, a build without installs): the list only */
  manager?: PluginManager;
  /** the manager changed what is registered */
  onInstalled?(): void;
  sel: PluginSel | null;
  onPick(pluginId: string, generatorId: string): void;
  onChange(values: Values): void;
  onApply(): void;
  onBack(): void;
  onCancel(): void;
  /** the live preview's failure, or null when it is current */
  hint?: string | null;
  busy?: boolean;
}

const label = (d: ParamDef): string => d.title ?? d.name;
const tip = (d: ParamDef): string | undefined => d.description;

function Field(p: { f: FormField; values: Values; set(name: string, v: string | number | boolean | undefined): void }): JSX.Element | null {
  const { def: d, value, error, auto, visible } = p.f;
  if (!visible) return null;
  const err = error ? <div class="thread-fit bad" role="alert" data-testid={`plugin-err-${d.name}`}>{`${label(d)} ${error}`}</div> : null;
  let input: JSX.Element;
  switch (d.type) {
    case 'boolean':
      input = <input type="checkbox" checked={value === true} aria-label={label(d)} onChange={(e) => p.set(d.name, (e.currentTarget as HTMLInputElement).checked)} />;
      break;
    case 'enum':
      input = (
        <select value={String(value ?? '')} aria-label={label(d)} title={tip(d)} onChange={(e) => { const raw = (e.currentTarget as HTMLSelectElement).value; const o = d.options!.find((x) => String(x.value) === raw); p.set(d.name, o ? o.value : raw); }}>
          {d.optional && d.default === undefined ? <option value="">{t('plugin.auto')}</option> : null}
          {d.options!.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label ?? String(o.value)}</option>)}
        </select>
      );
      break;
    case 'string':
      input = <input {...textAttrs} type="text" value={String(value ?? '')} maxLength={d.maxLength} aria-label={label(d)} title={tip(d)} onInput={(e) => p.set(d.name, (e.currentTarget as HTMLInputElement).value)} />;
      break;
    default:
      input = (
        <span class="fedit-num">
          <input {...numberAttrs(kindForMin(d.min))} type="number" step={d.step ?? (d.type === 'integer' ? 1 : 'any')} min={d.min} max={d.max} value={value === undefined ? '' : String(value)}
            placeholder={auto || d.optional ? t('plugin.auto') : undefined} aria-label={label(d)} title={d.optional ? `${tip(d) ?? ''} ${t('plugin.autoTip')}`.trim() : tip(d)}
            onChange={(e) => {
              const raw = (e.currentTarget as HTMLInputElement).value.trim();
              if (raw === '') { if (d.optional) p.set(d.name, undefined); return; }
              const v = Number(raw);
              if (Number.isFinite(v)) p.set(d.name, v);
            }} />
          {d.unit ? <span class="fedit-unit">{d.unit}</span> : null}
        </span>
      );
  }
  return (
    <div>
      <label class="fedit-fld" data-path={d.name}>
        <span class="fedit-fld-label" title={tip(d)}>{label(d)}</span>
        {input}
      </label>
      {err}
    </div>
  );
}

export function PluginPanel(p: PluginPanelProps): JSX.Element {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  const head = (title: string): JSX.Element => (
    <div class="fedit-head">
      <Icon name="add-plugin" size={22} class="fedit-icon" />
      <div class="fedit-title">{title}</div>
      <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')} data-testid="plugin-close"><Icon name="close" size={20} /></button>
    </div>
  );

  if (!p.sel) {
    const gens = p.registry.generators();
    const cats = [...new Set(gens.map((g) => g.decl.category ?? ''))];
    return (
      <div class="fedit thread-editor prop-wizard plugin-panel" tabIndex={0} onKeyDown={onKey} data-testid="plugin-panel">
        {head(t('plugin.title'))}
        <div class="fedit-sec-fields prop-body">
          {gens.length === 0 ? <div class="thread-hint">{t('plugin.none')}</div> : <div class="thread-hint">{t('plugin.pick')}</div>}
          {cats.map((c) => (
            <div key={c}>
              {c ? <div class="fedit-fld-label" style="margin:8px 0 4px">{c}</div> : null}
              {gens.filter((g) => (g.decl.category ?? '') === c).map(({ plugin, decl }) => (
                <button key={`${plugin.manifest.id}/${decl.id}`} type="button" class="fedit-card-btn" style="display:block;width:100%;text-align:left;margin-bottom:6px" data-testid={`plugin-item-${plugin.manifest.id}-${decl.id}`} onClick={() => p.onPick(plugin.manifest.id, decl.id)}>
                  <strong>{decl.title}</strong>
                  <span class="thread-hint" style="display:block">{decl.description ?? ''}</span>
                  <span class="thread-hint" style="display:block;opacity:.7">{t('plugin.by', { plugin: plugin.manifest.name, version: plugin.manifest.version })}{plugin.builtin ? ` · ${t('plugin.builtin')}` : ''}</span>
                </button>
              ))}
            </div>
          ))}
          {p.manager ? <PluginManage manager={p.manager} onChanged={() => p.onInstalled?.()} /> : null}
        </div>
      </div>
    );
  }

  const found = p.registry.find(p.sel.pluginId, p.sel.generatorId);
  if (!found) return <div class="fedit" data-testid="plugin-panel">{head(t('plugin.title'))}</div>;
  const { decl } = found;
  const values = p.sel.values;
  const groups = formModel(decl.params, values);
  const checked = checkParams(decl.params, values);
  const set = (name: string, v: string | number | boolean | undefined): void => {
    const next: Values = { ...values };
    if (v === undefined) delete next[name]; else next[name] = v;
    p.onChange(next);
  };
  const blocked = !checked.ok;
  return (
    <div class="fedit thread-editor prop-wizard plugin-panel" tabIndex={0} onKeyDown={onKey} data-testid="plugin-panel" data-generator={`${p.sel.pluginId}/${p.sel.generatorId}`}>
      {head(decl.title)}
      <div class="fedit-sec-fields prop-body">
        {p.sel.edit ? <div class="thread-hint" data-testid="plugin-editing">{t('plugin.editing', { name: p.sel.edit.group })}</div> : <button type="button" class="fedit-card-btn" data-testid="plugin-back" onClick={p.onBack}>{t('plugin.back')}</button>}
        {decl.description ? <div class="thread-hint">{decl.description}</div> : null}
        {groups.map((g) => (
          <div key={g.title} data-group={g.title}>
            {g.title ? <div class="fedit-fld-label" style="margin:10px 0 4px;font-weight:600">{g.title}</div> : null}
            {g.fields.map((f) => <Field key={f.def.name} f={f} values={values} set={set} />)}
          </div>
        ))}
        <button type="button" class="fedit-card-btn" data-testid="plugin-reset" onClick={() => p.onChange(defaultsOf(decl.params))}>{t('plugin.reset')}</button>
        {p.busy ? <div class="thread-hint" data-testid="plugin-busy">{t('plugin.working')}</div> : null}
        {p.hint ? <div class="fedit-hint" role="alert" data-testid="plugin-hint">{p.hint}</div> : null}
      </div>
      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid="plugin-cancel" onClick={p.onCancel}>{t('ui.cancel', undefined, 'Cancel')}</button>
        <button type="button" class="fedit-card-btn prop-create" data-testid="plugin-apply" disabled={blocked} aria-disabled={blocked} title={blocked ? t('plugin.blockedTip') : t('plugin.applyTip')} onClick={() => { if (!blocked) p.onApply(); }}>{p.sel.edit ? t('plugin.applyEdit') : t('plugin.apply')}</button>
      </div>
    </div>
  );
}
