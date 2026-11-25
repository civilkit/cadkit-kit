// The Plugins panel: a list of the generators plugins add, then a form generated from the chosen generator's parameter list (packages/plugin).
// Every change goes to onChange with the whole value record (the app previews it live); Add commits one undo step, Escape / the cross cancels.
// Nothing here knows what a particular plugin does: fields, groups, units, "auto" for optional values and errors all come from the definitions.
import type { JSX } from 'preact';
import { Icon, kindForMin, numberAttrs, textAttrs } from '@kit/ui';
import { checkParams, defaultsOf, formModel, type FormField, type ParamDef, type PluginManager, type PluginRegistry, type ReadResult, type SelItem, type Values } from '@kit/plugin';
import { PluginManage } from './PluginManage';
import { t } from './i18n';
import type { PluginSel } from './pluginRun';
import { addPick, profileItem, removePickAt, sketchItem, type DocSketch } from './pluginPicks';

export interface PluginPanelProps {
  registry: PluginRegistry;
  /** installs, switches and removes plugins; absent (tests, a build without installs): the list only */
  manager?: PluginManager;
  /** the manager changed what is registered */
  onInstalled?(): void;
  /** Open the Community Package Hub dialog to browse community plugins and libraries. */
  onOpenHub?(): void;
  sel: PluginSel | null;
  onPick(pluginId: string, generatorId: string): void;
  onChange(values: Values): void;
  onApply(): void;
  onBack(): void;
  onCancel(): void;
  /** the live preview's failure, or null when it is current */
  hint?: string | null;
  busy?: boolean;
  /** a plain note under the form (what the live preview leaves out) */
  note?: string | null;
  /** the selection field that takes the picks made in the viewport now (null: none); the app mirrors the selection into it */
  pickField?: string | null;
  onPickField?(name: string | null): void;
  /** a read entry (it only reads the model): Run asks the app to run it; what it found comes back as `readResult` */
  onRun?(): void;
  readResult?: ReadResult | null;
  readBusy?: boolean;
  /** the document's sketches and their closed regions: what a field that takes sketches or profiles can add from its list */
  sketches?: DocSketch[];
}

/** CSV text as rows: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const download = (name: string, data: BlobPart, type = 'text/plain'): void => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** What a read entry found, drawn without knowing which plugin it was: a `csv` text as a table with Download and Copy, the plain numbers and words as one line, anything else as JSON; each file it saved as a download. */
function ReadView(p: { r: ReadResult }): JSX.Element {
  const res = (p.r.result && typeof p.r.result === 'object' ? p.r.result : {}) as Record<string, unknown>;
  const csv = typeof res.csv === 'string' ? res.csv : null;
  const rows = csv ? parseCsv(csv) : [];
  const facts = Object.entries(res).filter(([k, v]) => k !== 'csv' && (typeof v === 'number' || typeof v === 'string') && String(v) !== '').map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`);
  const rest = Object.fromEntries(Object.entries(res).filter(([k, v]) => k !== 'csv' && typeof v === 'object' && v !== null && !(Array.isArray(v) && v.length === 0)));
  return (
    <div class="plugin-result" data-testid="plugin-result">
      <div class="fedit-fld-label">{t('plugin.result')}</div>
      {facts.length ? <div class="thread-hint" data-testid="plugin-result-facts">{facts.join(' · ')}</div> : null}
      {rows.length ? (
        <div class="plugin-result-scroll"><table class="plugin-result-table" data-testid="plugin-result-table">
          <thead><tr>{rows[0].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{rows.slice(1).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table></div>
      ) : (csv === null && !Object.keys(rest).length && !facts.length ? <div class="thread-hint">{t('plugin.resultNone')}</div> : null)}
      {Object.keys(rest).length && !rows.length ? <pre class="plugin-result-json">{JSON.stringify(rest, null, 1)}</pre> : null}
      <div class="plugin-result-actions">
        {csv ? <button type="button" class="fedit-card-btn" data-testid="plugin-result-csv" onClick={() => download('result.csv', csv, 'text/csv')}>{t('plugin.downloadCsv')}</button> : null}
        {csv ? <button type="button" class="fedit-card-btn" data-testid="plugin-result-copy" onClick={() => { void navigator.clipboard?.writeText(csv).catch(() => {}); }}>{t('plugin.copyCsv')}</button> : null}
        {p.r.files.map((f, i) => <button key={i} type="button" class="fedit-card-btn" data-testid={`plugin-result-file-${i}`} onClick={() => download(f.name, f.data as BlobPart, /\.csv$/i.test(f.name) ? 'text/csv' : 'application/octet-stream')}>{t('plugin.download', { name: f.name })}</button>)}
      </div>
    </div>
  );
}

const label = (d: ParamDef): string => d.title ?? d.name;
const tip = (d: ParamDef): string | undefined => d.description;

/** How a pick reads in the list: a body or sketch by its name, a face as "Body, face 2", an edge as "Body, edge 3", a region as "Sketch 1, region 2". */
const pickName = (it: SelItem): string => {
  if (typeof it === 'string') return it;
  const n = typeof it.index === 'number' ? it.index + 1 : '?';
  if (it.type === 'face') return t('plugin.pickFaceOf', { body: String(it.body ?? ''), n });
  if (it.type === 'edge') return t('plugin.pickEdgeOf', { body: String(it.body ?? ''), n });
  if (it.type === 'profile') return t('plugin.pickProfileOf', { sketch: String(it.name ?? it.sketch ?? ''), n });
  return String(it.name ?? it.type ?? '');
};

const KIND_LABEL: Record<string, string> = { body: 'plugin.pickBody', face: 'plugin.pickFace', edge: 'plugin.pickEdge', sketch: 'plugin.pickSketch', profile: 'plugin.pickProfile', sketch_point: 'plugin.pickSketchPoint', sketch_curve: 'plugin.pickSketchCurve' };

function Field(p: { f: FormField; values: Values; set(name: string, v: string | number | boolean | SelItem[] | undefined): void; pickField?: string | null; onPickField?(name: string | null): void; sketches?: DocSketch[] }): JSX.Element | null {
  const { def: d, value, error, auto, visible } = p.f;
  if (!visible) return null;
  // A plugin that has a `units` choice (mm / in) shows it inside every plain number field, like the unit of the sizes it asks for.
  const unit = d.unit ?? (d.type === 'number' && typeof p.values.units === 'string' ? p.values.units : undefined);
  const err = error ? <div class="thread-fit bad" role="alert" data-testid={`plugin-err-${d.name}`}>{`${label(d)} ${error}`}</div> : null;
  if (d.type === 'selection') {
    const picks = Array.isArray(value) ? value : [];
    const active = p.pickField === d.name;
    const what = (d.accept ?? []).map((a) => (KIND_LABEL[a] ? t(KIND_LABEL[a]) : a)).join(' / ');
    const sks = p.sketches ?? [];
    // a sketch or a closed region can also be added from a list (the Features list and the view are the other ways)
    const adder = (kind: 'sketch' | 'profile'): JSX.Element | null => {
      if (!d.accept?.includes(kind)) return null;
      const opts = kind === 'sketch' ? sks.map((s) => ({ key: s.id, label: s.name, item: sketchItem(s) })) : sks.flatMap((s) => s.regions.map((r, i) => ({ key: `${s.id}/${r}`, label: t('plugin.pickProfileOf', { sketch: s.name, n: i + 1 }), item: profileItem(s, r, i) })));
      if (!opts.length) return null;
      return (
        <select value="" aria-label={t(kind === 'sketch' ? 'plugin.addSketch' : 'plugin.addProfile')} data-testid={`plugin-add-${kind}-${d.name}`}
          onChange={(e) => { const o = opts.find((x) => x.key === (e.currentTarget as HTMLSelectElement).value); if (o) p.set(d.name, addPick(d, picks, o.item)); }}>
          <option value="">{t(kind === 'sketch' ? 'plugin.addSketch' : 'plugin.addProfile')}</option>
          {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      );
    };
    return (
      <div class="fedit-fld plugin-pick" data-path={d.name} data-testid={`plugin-pick-${d.name}`}>
        <span class="fedit-fld-label" title={tip(d)}>{label(d)}</span>
        <div class="plugin-pick-main">
          <div class="plugin-pick-bar">
            <button type="button" class={'fedit-card-btn plugin-pick-btn' + (active ? ' on' : '')} aria-pressed={active} data-testid={`plugin-pick-btn-${d.name}`}
              onClick={() => p.onPickField?.(active ? null : d.name)}>{active ? t('plugin.pickDone') : t('plugin.pickStart')}</button>
            {picks.length ? <button type="button" class="row-act" aria-label={t('plugin.pickClear')} title={t('plugin.pickClear')} data-testid={`plugin-pick-clear-${d.name}`} onClick={() => p.set(d.name, [])}><Icon name="close" size={14} /></button> : null}
          </div>
          {active ? <div class="thread-hint">{t('plugin.pickHint', { what })}</div> : null}
          {adder('sketch')}{adder('profile')}
          {picks.length
            ? <ul class="plugin-pick-list">{picks.map((it, i) => {
                const name = pickName(it);
                return (
                  <li key={i}>
                    <span>{name}</span>
                    <button type="button" class="row-act" aria-label={t('plugin.pickRemove', { name })} title={t('plugin.pickRemove', { name })} data-testid={`plugin-pick-remove-${d.name}-${i}`} onClick={() => p.set(d.name, removePickAt(picks, i))}><Icon name="close" size={12} /></button>
                  </li>
                );
              })}</ul>
            : <div class="thread-hint">{t('plugin.pickNone')}</div>}
        </div>
        {err}
      </div>
    );
  }
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
            // Every keystroke that makes a number is kept at once (a number field that only reported on `change`, when it lost focus, was overwritten by the form's
            // re-render after the PREVIOUS field's late update: the first digit typed into the next field vanished). Emptying the field, and a half-typed "-" or ".",
            // wait for `change`, so typing is never cut short.
            onInput={(e) => {
              const raw = (e.currentTarget as HTMLInputElement).value.trim();
              if (raw === '') return;
              const v = Number(raw);
              if (Number.isFinite(v)) p.set(d.name, v);
            }}
            onChange={(e) => {
              const raw = (e.currentTarget as HTMLInputElement).value.trim();
              if (raw === '') { if (d.optional) p.set(d.name, undefined); return; }
              const v = Number(raw);
              if (Number.isFinite(v)) p.set(d.name, v);
            }} />
          {unit ? <span class="fedit-unit">{unit}</span> : null}
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
  const head = (title: string, kicker?: string): JSX.Element => (
    <div class="fedit-head">
      <Icon name="add-plugin" size={22} class="fedit-icon" />
      <div class="fedit-title">{kicker ? <div class="fedit-kicker">{kicker}</div> : null}{title}</div>
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
                  <span class="thread-hint plugin-sub" style="display:block">{t('plugin.by', { plugin: plugin.manifest.name, version: plugin.manifest.version })}{plugin.builtin ? ` · ${t('plugin.builtin')}` : ''}</span>
                </button>
              ))}
            </div>
          ))}
          {p.manager ? <PluginManage manager={p.manager} onChanged={() => p.onInstalled?.()} onOpenHub={p.onOpenHub} /> : null}
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
  const set = (name: string, v: string | number | boolean | SelItem[] | undefined): void => {
    const next: Values = { ...values };
    if (v === undefined) delete next[name]; else next[name] = v;
    p.onChange(next);
  };
  const blocked = !checked.ok;
  return (
    <div class="fedit thread-editor prop-wizard plugin-panel" tabIndex={0} onKeyDown={onKey} data-testid="plugin-panel" data-generator={`${p.sel.pluginId}/${p.sel.generatorId}`}>
      {head(decl.title, found.plugin.manifest.name)}
      <div class="fedit-sec-fields prop-body">
        {p.sel.edit ? <div class="thread-hint" data-testid="plugin-editing">{t('plugin.editing', { name: p.sel.edit.group })}</div> : <button type="button" class="fedit-card-btn" data-testid="plugin-back" onClick={p.onBack}>{t('plugin.back')}</button>}
        {decl.description ? <div class="thread-hint">{decl.description}</div> : null}
        {groups.map((g) => (
          <div key={g.title} data-group={g.title}>
            {g.title ? <div class="fedit-fld-label" style="margin:10px 0 4px;font-weight:600">{g.title}</div> : null}
            {g.fields.map((f) => <Field key={f.def.name} f={f} values={values} set={set} pickField={p.pickField} onPickField={p.onPickField} sketches={p.sketches} />)}
          </div>
        ))}
        <button type="button" class="fedit-card-btn" data-testid="plugin-reset" onClick={() => p.onChange(defaultsOf(decl.params))}>{t('plugin.reset')}</button>
        {p.busy ? <div class="thread-hint" data-testid="plugin-busy">{t('plugin.working')}</div> : null}
        {p.note && !p.busy ? <div class="thread-hint" data-testid="plugin-note">{p.note}</div> : null}
        {p.hint ? <div class="fedit-hint" role="alert" data-testid="plugin-hint">{p.hint}</div> : null}
        {decl.effect === 'read' && p.readResult ? <ReadView r={p.readResult} /> : null}
      </div>
      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid="plugin-cancel" onClick={p.onCancel}>{t('ui.cancel', undefined, 'Cancel')}</button>
        {decl.effect === 'read' ? <button type="button" class="fedit-card-btn prop-create" data-testid="plugin-run" disabled={blocked || p.readBusy} aria-disabled={blocked || p.readBusy} title={blocked ? t('plugin.blockedTip') : t('plugin.runTip')} onClick={() => { if (!blocked && !p.readBusy) p.onRun?.(); }}>{p.readBusy ? t('plugin.working') : t('plugin.run')}</button> : <button type="button" class="fedit-card-btn prop-create" data-testid="plugin-apply" disabled={blocked} aria-disabled={blocked} title={blocked ? t('plugin.blockedTip') : t('plugin.applyTip')} onClick={() => { if (!blocked) p.onApply(); }}>{p.sel.edit ? t('plugin.applyEdit') : t('plugin.apply')}</button>}
      </div>
    </div>
  );
}
