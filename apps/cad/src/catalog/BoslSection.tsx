// The "Parts library (BOSL2)" section of the Catalog panel: search, categories, one card per entry (drag onto the model or click and
// then click a face), and the parameter form of the selected entry with the script it will add.
import type { JSX } from 'preact';
import { t } from '../i18n';
import { BOSL_ENTRIES, boslEntry, type BoslEntry, type Category, type ParamDef } from './bosl/entries';
import { searchEntries } from './bosl/search';
import { boslCategory, boslQuery, boslSelected, boslValues, paramsOf, resetParams, setParam } from './bosl/state';
import { BOSL_THUMBS } from './bosl/thumbs.generated';
import { CatalogIcon } from './CatalogIcon';
import { registerDynamicItem, type CatalogItem, type ShapeKind } from './shapes';
import { armedItem } from './state';

const CATEGORIES: Array<Category | 'all'> = ['all', 'blocks', 'cylinders', 'round', 'profiles', 'masks'];
const KIND: Record<string, ShapeKind> = { cuboid: 'block', prismoid: 'cone', wedge: 'block', rect_tube: 'block', cyl: 'cylinder', tube: 'cylinder', pie_slice: 'cylinder', regular_prism: 'boss', spheroid: 'sphere', torus: 'boss', teardrop: 'slot', onion: 'sphere', edge_rounding_mask: 'block', edge_chamfer_mask: 'block' };

/** The catalog item an entry stands for, with its current parameter values (registered so the placement finds it by id). */
export function boslItem(e: BoslEntry): CatalogItem {
  return registerDynamicItem({ id: 'bosl:' + e.id, kind: KIND[e.id] ?? 'block', op: e.mask || paramsOf(e.id).mode === 'cut' ? 'cut' : 'add', bosl: { entryId: e.id, params: paramsOf(e.id) } });
}

interface Props {
  onItemDown(item: CatalogItem, e: JSX.TargetedPointerEvent<HTMLButtonElement>): void;
  onItemKey(item: CatalogItem): void;
}

function Field({ entry, def }: { entry: BoslEntry; def: ParamDef }) {
  const v = paramsOf(entry.id)[def.key];
  const label = t('catalog.bosl.param.' + def.key);
  const id = `bosl-${entry.id}-${def.key}`;
  let input: JSX.Element;
  if (def.type === 'bool') input = <input id={id} type="checkbox" checked={!!v} onChange={(e) => setParam(entry.id, def.key, (e.currentTarget as HTMLInputElement).checked)} />;
  else if (def.type === 'choice') input = (
    <select id={id} value={String(v)} onChange={(e) => setParam(entry.id, def.key, (e.currentTarget as HTMLSelectElement).value)}>
      {def.choices!.map((c) => <option key={c} value={c}>{t('catalog.bosl.choice.' + c)}</option>)}
    </select>
  );
  else input = (
    <input id={id} type="number" step={def.type === 'integer' ? 1 : 'any'} min={def.min} max={def.max} value={Number(v)}
      onInput={(e) => { const x = parseFloat((e.currentTarget as HTMLInputElement).value); if (Number.isFinite(x)) setParam(entry.id, def.key, def.type === 'integer' ? Math.round(x) : x); }} />
  );
  return (
    <label class="bosl-field" for={id}>
      <span class="bosl-label">{label}{def.unit ? <i> ({def.unit})</i> : null}{def.linked ? <b class="bosl-var" title={t('catalog.bosl.linked')}>*</b> : null}</span>
      {input}
    </label>
  );
}

function Form({ entry }: { entry: BoslEntry }) {
  const p = paramsOf(entry.id);
  const bad = entry.check(p);
  const edited = !!boslValues.value[entry.id];
  const script = bad ? '' : entry.script(p, { plane: "'front'", ground: true, at: [0, 0], prefix: entry.id.replace(/[^a-z0-9]/gi, '') + '1_' });
  return (
    <div class="bosl-form" data-testid="bosl-form">
      <div class="bosl-form-h"><b>{t('catalog.bosl.entry.' + entry.id)}</b>{edited ? <button class="bosl-reset" onClick={() => resetParams(entry.id)}>{t('catalog.bosl.reset')}</button> : null}</div>
      <div class="bosl-fields">{entry.params.map((d) => <Field key={d.key} entry={entry} def={d} />)}</div>
      {bad ? <div class="bosl-bad" role="alert">{t('catalog.bosl.invalid', { reason: bad })}</div> : null}
      <div class="bosl-note">{t('catalog.bosl.linkedNote')}</div>
      <div class="bosl-note">{t('catalog.bosl.source', { module: entry.source.module, licence: entry.source.licence })}</div>
      <div class="bosl-note">{entry.notes}</div>
      {script ? <details class="bosl-script"><summary>{t('catalog.bosl.script')}</summary><pre>{script}</pre></details> : null}
    </div>
  );
}

export function BoslSection({ onItemDown, onItemKey }: Props) {
  const q = boslQuery.value, cat = boslCategory.value, sel = boslSelected.value;
  const list = searchEntries(q, cat);
  const armed = armedItem.value;
  boslValues.value;        // redraw when a value changes (the form and the armed item read it)
  const selected = sel ? boslEntry(sel) : undefined;
  return (
    <section class="bosl" data-testid="bosl-section" aria-label={t('catalog.bosl.title')}>
      <div class="cat-h">{t('catalog.bosl.title')}</div>
      <div class="cat-sub">{t('catalog.bosl.hint')}</div>
      <input class="bosl-search" type="search" value={q} placeholder={t('catalog.bosl.search')} aria-label={t('catalog.bosl.search')} onInput={(e) => { boslQuery.value = (e.currentTarget as HTMLInputElement).value; }} />
      <div class="bosl-cats" role="tablist">
        {CATEGORIES.map((c) => <button key={c} role="tab" aria-selected={cat === c} class={'bosl-cat' + (cat === c ? ' on' : '')} onClick={() => { boslCategory.value = c; }}>{t('catalog.bosl.cat.' + c)}</button>)}
      </div>
      <div class="cat-grid">
        {list.map((e) => {
          const item = boslItem(e);
          const thumb = BOSL_THUMBS[e.id];
          return (
            <button key={e.id} class={'cat-item bosl-item' + (armed === item.id ? ' armed' : '') + (sel === e.id ? ' sel' : '')} data-item={item.id} title={e.notes}
              aria-pressed={armed === item.id}
              onPointerDown={(ev) => { boslSelected.value = e.id; onItemDown(boslItem(e), ev); }}
              onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); boslSelected.value = e.id; onItemKey(boslItem(e)); } }}>
              {thumb ? <img src={thumb} width="64" height="48" alt="" draggable={false} /> : <CatalogIcon kind={item.kind} op={item.op} />}
              <span class="cat-name">{t('catalog.bosl.entry.' + e.id)}</span>
            </button>
          );
        })}
        {list.length === 0 ? <div class="empty">{t('catalog.bosl.none')}</div> : null}
      </div>
      {selected ? <Form entry={selected} /> : <div class="cat-sub">{t('catalog.bosl.pick', { count: BOSL_ENTRIES.length })}</div>}
    </section>
  );
}
