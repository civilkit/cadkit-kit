// The parameter form of a BOSL2 entry (shown in the detail panel of the Libraries tab when the entry is selected), and the catalog
// item an entry stands for (its current parameter values; registered so the placement finds it by id).
import type { JSX } from 'preact';
import { t } from '../../i18n';
import { type BoslEntry, type ParamDef } from './entries';
import { boslValues, paramsOf, resetParams, setParam } from './state';
import { registerDynamicItem, type CatalogItem, type ShapeKind } from '../shapes';
import { kindForMin, numberAttrs } from '@kit/ui';

const KIND: Record<string, ShapeKind> = { cuboid: 'block', prismoid: 'cone', wedge: 'block', rect_tube: 'block', cyl: 'cylinder', tube: 'cylinder', pie_slice: 'cylinder', regular_prism: 'boss', spheroid: 'sphere', torus: 'boss', teardrop: 'slot', onion: 'sphere', edge_rounding_mask: 'block', edge_chamfer_mask: 'block' };

/** The catalog item an entry stands for, with its current parameter values (registered so the placement finds it by id). */
export function boslItem(e: BoslEntry): CatalogItem {
  return registerDynamicItem({ id: 'bosl:' + e.id, kind: KIND[e.id] ?? 'block', op: e.mask || paramsOf(e.id).mode === 'cut' ? 'cut' : 'add', bosl: { entryId: e.id, params: paramsOf(e.id) } });
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
    <input {...numberAttrs(def.type === 'integer' ? (def.min !== undefined && def.min >= 0 ? 'integer' : 'signed') : kindForMin(def.min))} id={id} type="number" step={def.type === 'integer' ? 1 : 'any'} min={def.min} max={def.max} value={Number(v)}
      onInput={(e) => { const x = parseFloat((e.currentTarget as HTMLInputElement).value); if (Number.isFinite(x)) setParam(entry.id, def.key, def.type === 'integer' ? Math.round(x) : x); }} />
  );
  return (
    <label class="bosl-field" for={id}>
      <span class="bosl-label">{label}{def.unit ? <i> ({def.unit})</i> : null}{def.linked ? <b class="bosl-var" title={t('catalog.bosl.linked')}>*</b> : null}</span>
      {input}
    </label>
  );
}

export function BoslForm({ entry }: { entry: BoslEntry }) {
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
