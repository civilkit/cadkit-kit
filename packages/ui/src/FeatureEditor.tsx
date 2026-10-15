import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { t } from './i18n';
import { fieldsOf, type Field } from './Inspector';
import { Icon, featureIconName } from './icons';
import { ExprInput } from './ExprInput';
import { isExprValue } from './expr';

export interface Section {
  id: string;
  title: string;
  fields: Field[];
}

interface FeatureLike {
  type?: string;
  name?: string;
  [k: string]: unknown;
}

const GROUPS: Record<string, Record<string, string[]>> = {
  extrude: { profile: ['sketch'], operation: ['op', 'end', 'depth', 'flip'] },
  revolve: { profile: ['sketch'], axis: ['axis'], operation: ['op', 'angle', 'flip'] },
  sweep: { profile: ['sketch'], path: ['path'], operation: ['op'] },
  loft: { profile: ['sections'], operation: ['op'] },
  fillet: { edges: ['edges'], operation: ['radius'] },
  chamfer: { edges: ['edges'], operation: ['distance', 'angle'] },
  shell: { faces: ['faces'], operation: ['thickness', 'outward', 'inside'] },
  draft: { operation: ['angle', 'neutral'] },
  hole: { profile: ['sketch'], operation: ['kind', 'diameter', 'end', 'depth', 'tip', 'flip'] },
  lpattern: { seeds: ['seeds'], operation: ['count', 'spacing', 'reverse'] },
  cpattern: { seeds: ['seeds'], operation: ['count', 'angle', 'equal', 'reverse'] },
  plane: { operation: ['mode', 'offset', 'angle', 'flip'] },
  rib: { profile: ['sketch'], operation: ['thickness', 'flip'] },
  lip: { faces: ['faces'], edges: ['edges'], operation: ['kind', 'width', 'height'] },
  mirror: { seeds: ['seeds'], operation: ['plane', 'body'] },
  helix: { profile: ['sketch'], operation: ['definedBy', 'pitch', 'revolutions', 'height', 'startAngle', 'leftHand', 'reverse'] },
  pipeCut: { faces: ['faces'], edges: ['edges'], operation: ['radius'] },
  deleteBody: { operation: ['mode'] },
  trimSurface: { operation: ['surface', 'toolSurface', 'plane', 'mutual', 'flip'] },
  knit: { surfaces: ['surfaces'], operation: ['solid'] },
  fill: { edges: ['edges'], operation: ['continuity', 'fairing', 'merge'] },
  extend: { edges: ['edges'], operation: ['distance'] },
  thicken: { operation: ['surface', 'thickness', 'side', 'op'] },
};

const FIELD_LABELS: Record<string, string> = {
  sketch: 'Profile sketch',
  axis: 'Axis',
  path: 'Path',
  op: 'Operation',
  end: 'End condition',
  depth: 'Depth',
  flip: 'Flip direction',
  angle: 'Angle',
  radius: 'Radius',
  distance: 'Distance',
  thickness: 'Thickness',
  inside: 'Flip inside',
  neutral: 'Neutral plane',
  edges: 'Edges',
  faces: 'Faces',
  seeds: 'Features to repeat',
  sections: 'Sections',
  mode: 'Mode', offset: 'Offset', plane: 'Plane', base: 'Base', toolSurface: 'Tool surface', surface: 'Surface', surfaces: 'Surfaces',
  pitch: 'Pitch', revolutions: 'Revolutions', startAngle: 'Start angle', definedBy: 'Defined by', width: 'Width', height: 'Height',
};

/** Fields whose value is one of a few words, shown as a dropdown (the current value is always kept in the list). */
const ENUMS: Record<string, string[]> = {
  op: ['add', 'cut'],
  end: ['blind', 'through', 'throughBoth', 'upToNext'],
  'plane.mode': ['offset', 'angle', 'mid', 'parallel', 'threePoints'],
  'deleteBody.mode': ['delete', 'keep'],
  definedBy: ['pitchRevs', 'pitchHeight', 'revsHeight'],
  kind: ['lip', 'groove'],
  side: ['front', 'back', 'both'],
};
const UNITS: Record<string, string> = {
  depth: 'mm', radius: 'mm', distance: 'mm', thickness: 'mm', diameter: 'mm', spacing: 'mm', offset: 'mm', angle: '°',
};
const enumLabel = (path: string, v: string) => t(`ui.editor.value.${path}.${v}`, undefined, v);

const REFERENCE_FIELDS = new Set(['sketch', 'axis', 'path', 'neutral', 'plane']);
/** Fields holding a list of references (edges, faces, features); filled from the viewport selection. */
export const LIST_FIELDS = new Set(['edges', 'faces', 'seeds', 'surfaces']);
/** Fields holding one geometry reference object ({kind:'face',id}, {kind:'std',id}, ...): shown as text, set with Pick. */
export const GEOM_FIELDS = new Set(['neutral', 'plane']);
export const geomText = (v: unknown): string => {
  if (typeof v === 'string') return v;
  const o = v as { kind?: string; id?: string; axis?: string } | null;
  return o && typeof o === 'object' ? [o.kind, o.id ?? o.axis].filter(Boolean).join(' ') : '';
};

/** The text shown in a list field: edge refs by their two faces, everything else by name. */
export function listText(path: string, value: unknown): string {
  if (!Array.isArray(value)) return '';
  if (path === 'edges') return value.map((e) => ((e as { faces?: string[] }).faces ?? []).join('|')).join(', ');
  return value.join(', ');
}

function labelOf(field: Field): string {
  const key = 'ui.editor.field.' + field.path;
  const text = t(key, undefined, FIELD_LABELS[field.path] ?? field.path);
  return text;
}

function kindOf(field: Field): Field['kind'] {
  if (REFERENCE_FIELDS.has(field.path)) return 'text';
  return field.kind;
}

/** Group a feature's primitive fields into ordered, titled sections. */
export function sectionsOf(feature: FeatureLike | null): Section[] {
  if (!feature) return [];
  const all = fieldsOf(feature as Record<string, unknown>);
  for (const path of LIST_FIELDS) {
    const v = feature[path];
    if (Array.isArray(v)) all.push({ path, label: path, kind: 'list', value: listText(path, v) });
  }
  for (const path of GEOM_FIELDS) {
    const v = feature[path];
    if (feature.type !== 'sketch' && v && typeof v === 'object') all.push({ path, label: path, kind: 'text', value: geomText(v) });
  }
  const groups = GROUPS[feature.type ?? ''] ?? {};
  const used = new Set<string>();
  const out: Section[] = [];
  for (const [groupId, paths] of Object.entries(groups)) {
    const fields = all.filter((f) => paths.includes(f.path));
    for (const f of fields) used.add(f.path);
    if (fields.length === 0) continue;
    const title = t('ui.editor.section.' + groupId, undefined, groupId.charAt(0).toUpperCase() + groupId.slice(1));
    out.push({ id: groupId, title, fields });
  }
  const rest = all.filter((f) => !used.has(f.path));
  if (rest.length > 0) {
    out.push({ id: 'other', title: t('ui.editor.section.other', undefined, 'Other'), fields: rest });
  }
  return out;
}

/** What a per-feature options form (apps/cad FeatureOptions.tsx) is given: the feature with the draft applied, a patch function (null removes a field) and the pick state. */
export interface OptionsArgs {
  eff: Record<string, unknown>;
  change(patch: Record<string, unknown>): void;
  pickingPath?: string | null;
  onPickRequest?(path: string): void;
}
/** The form to draw and the generic fields it replaces (hidden from the generic sections). */
export interface OptionsResult { hide: Set<string>; node: JSX.Element }

export function FeatureEditor(p: {
  feature: FeatureLike | null;
  onDraft(next: Record<string, unknown>): void;
  onConfirm(next: Record<string, unknown>): void;
  onCancel(): void;
  onPickRequest?(path: string): void;
  pickingPath?: string | null;
  picked?: { path: string; value: unknown } | null;
  /** Preview failure hint; the viewport keeps the last good mesh while it shows. */
  hint?: string | null;
  /** Replaces the plain hint when the app has something richer to show (the failure card). */
  diag?: JSX.Element | null;
  /** The draft breaks the model: Confirm is greyed with this tooltip and only applies while Shift is held. */
  okBlocked?: string | null;
  /** The closed shapes of the feature's sketch (extrude, revolve): checkboxes choose which ones are used. Fewer than two: no list. */
  shapes?: Array<{ id: string; label: string }>;
  /** The pointer is over a shape's row (or left it: null), so the app can light it up in the view. */
  onShapeHover?(id: string | null): void;
  /** Optional form for the feature's options (end conditions, chamfer type...); its fields replace the generic ones. */
  options?(a: OptionsArgs): OptionsResult | null;
}): JSX.Element {
  const feature = p.feature;
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (!feature) {
    return (
      <div class="fedit empty">
        <div class="fedit-hint">{t('ui.editor.empty', undefined, 'No feature selected.')}</div>
      </div>
    );
  }

  const featureId = feature.id;
  const shapes = (feature.type === 'extrude' || feature.type === 'revolve') ? (p.shapes ?? []) : [];
  const current = (draft.regions !== undefined ? draft.regions : feature.regions) as string[] | null | undefined;
  const checkedShapes = new Set(Array.isArray(current) ? shapes.filter((s) => current.includes(s.id)).map((s) => s.id) : shapes.map((s) => s.id));
  /** All checked means no `regions` field at all (every region, holes included), which is null in the draft. */
  const toggleShape = (id: string): void => {
    const next = new Set(checkedShapes);
    if (next.has(id)) next.delete(id); else next.add(id);
    if (!next.size) return;
    apply('regions', next.size === shapes.length ? null : shapes.filter((s) => next.has(s.id)).map((s) => s.id));
  };
  const eff: Record<string, unknown> = { ...feature, ...draft };
  for (const k of Object.keys(eff)) if (eff[k] === null) delete eff[k];
  const opts = p.options?.({ eff, change: (patch) => apply2(patch), pickingPath: p.pickingPath, onPickRequest: p.onPickRequest }) ?? null;
  const sections = sectionsOf(feature).map((sec) => ({ ...sec, fields: sec.fields.filter((f) => !opts?.hide.has(f.path)) })).filter((sec) => sec.fields.length > 0);
  const title = t('feature.' + feature.type, undefined, feature.type ?? '') + (feature.name ? ` — ${feature.name}` : '');

  const apply = (path: string, value: unknown): void => {
    const next = { ...draft, [path]: value };
    setDraft(next);
    p.onDraft(next);
  };

  const apply2 = (patch: Record<string, unknown>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    p.onDraft(next);
  };

  const applyPicked = (path: string, value: unknown): void => {
    const next = { ...draft, [path]: value };
    setDraft(next);
    p.onDraft(next);
  };

  if (p.picked && draft[p.picked.path] !== p.picked.value) {
    // A picked value arriving through props lands in the draft.
    applyPicked(p.picked.path, p.picked.value);
  }

  const confirm = (e?: { shiftKey?: boolean }): void => {
    if (p.okBlocked && !e?.shiftKey) return;   // greyed: only Shift forces it
    p.onConfirm(draft);
  };
  const cancel = (): void => p.onCancel();

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') { e.preventDefault(); confirm(e); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  return (
    <div class="fedit" data-feature={featureId} tabIndex={0} onKeyDown={onKey}>
      <div class="fedit-head">
        <Icon name={featureIconName(String(feature.type ?? ''), String((draft.op ?? feature.op) ?? ''))} size={22} class="fedit-icon" />
        <div class="fedit-title">{title}</div>
        <button type="button" class={'fedit-confirm' + (p.okBlocked ? ' blocked' : '')} aria-disabled={p.okBlocked ? true : undefined} onClick={confirm} title={p.okBlocked ?? t('ui.editor.confirm', undefined, 'Confirm')} aria-label={t('ui.editor.confirm', undefined, 'Confirm')}><Icon name="check" size={20} /></button>
        <button type="button" class="fedit-cancel" onClick={cancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      {sections.map((sec) => (
        <div class={'fedit-sec' + (collapsed[sec.id] ? ' closed' : '')} key={sec.id}>
          <div
            class="fedit-sec-head"
            onClick={() => setCollapsed((c) => ({ ...c, [sec.id]: !c[sec.id] }))}
          >
            <span class="fedit-sec-title">{sec.title}</span>
            <Icon name="chevron" size={14} class="fedit-chev" />
          </div>
          {collapsed[sec.id] ? null : (
            <div class="fedit-sec-fields">
              {sec.fields.map((f) => {
                const value = draft[f.path] ?? f.value;
                const picking = p.pickingPath === f.path;
                const isRef = REFERENCE_FIELDS.has(f.path);
                const isList = f.kind === 'list';
                const isGeom = GEOM_FIELDS.has(f.path);
                const refText = isList ? listText(f.path, draft[f.path] ?? feature[f.path]) : isGeom ? geomText(draft[f.path] ?? feature[f.path]) : String(value);
                const missing = (isRef || isList) && refText.trim() === '';
                const isBool = !isRef && !isList && kindOf(f) === 'boolean';
                const enumList = ENUMS[`${feature.type}.${f.path}`] ?? ENUMS[f.path];
                const enums = !isRef && !isList && typeof value === 'string' && enumList
                  ? (enumList.includes(value) ? enumList : [value, ...enumList]) : null;
                return (
                  <label class={'fedit-fld' + (picking ? ' picking' : '') + (missing ? ' missing' : '') + (isBool ? ' bool' : '') + (isList || isRef ? ' ref' : '')} key={f.path} data-path={f.path}>
                    {isBool ? (
                      <input type="checkbox" checked={Boolean(value)} onChange={(e) => apply(f.path, (e.currentTarget as HTMLInputElement).checked)} />
                    ) : null}
                    <span class="fedit-fld-label">{labelOf(f)}</span>
                    {isList ? (
                      <span class="fedit-ref">
                        <input
                          type="text"
                          value={refText}
                          readonly={f.path === 'edges' || picking}
                          onChange={(e) => apply(f.path, (e.currentTarget as HTMLInputElement).value.split(',').map((x) => x.trim()).filter(Boolean))}
                        />
                        {p.onPickRequest ? (
                          <button type="button" class={'fedit-pick' + (picking ? ' on' : '')} aria-pressed={picking} onClick={() => p.onPickRequest!(f.path)}>
                            {picking ? t('ui.editor.pickDone') : t('ui.editor.pickSelection')}
                          </button>
                        ) : null}
                      </span>
                    ) : isRef ? (
                      <span class="fedit-ref">
                        <input
                          type="text"
                          value={refText}
                          readonly={picking || isGeom}
                          onChange={(e) => apply(f.path, (e.currentTarget as HTMLInputElement).value)}
                        />
                        {p.onPickRequest ? (
                          <button type="button" class="fedit-pick" onClick={() => p.onPickRequest!(f.path)}>
                            {t('ui.editor.pick', undefined, 'Pick')}
                          </button>
                        ) : null}
                      </span>
                    ) : isBool ? null : enums ? (
                      <select value={String(value)} onChange={(e) => apply(f.path, (e.currentTarget as HTMLSelectElement).value)}>
                        {enums.map((v) => <option key={v} value={v}>{enumLabel(f.path, v)}</option>)}
                      </select>
                    ) : kindOf(f) === 'number' || isExprValue(value) ? (
                      <span class="fedit-num">
                        <ExprInput value={value as number | string} label={labelOf(f)} unit={UNITS[f.path]} onValue={(v) => apply(f.path, v)} />
                      </span>
                    ) : (
                      <input
                        type="text"
                        value={String(value)}
                        onChange={(e) => apply(f.path, (e.currentTarget as HTMLInputElement).value)}
                      />
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ))}
      {opts ? opts.node : null}
      {shapes.length > 1 ? (
        <div class="fedit-sec">
          <div class="fedit-sec-head"><span class="fedit-sec-title">{t('ui.editor.section.shapes', undefined, 'Shapes')}</span></div>
          <div class="fedit-sec-fields fedit-shapes">
            <span class="fedit-shapes-note">{t('ui.editor.shapes.note', undefined, 'Choose which closed shapes of the sketch are used.')}</span>
            {shapes.map((sh) => (
              <label key={sh.id} class="fedit-fld bool fedit-shape" data-shape={sh.id} onMouseEnter={() => p.onShapeHover?.(sh.id)} onMouseLeave={() => p.onShapeHover?.(null)}>
                <input type="checkbox" checked={checkedShapes.has(sh.id)} disabled={checkedShapes.has(sh.id) && checkedShapes.size === 1} onChange={() => toggleShape(sh.id)} />
                <span class="fedit-fld-label">{sh.label}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {p.diag ?? (p.hint ? <div class="fedit-hint" role="alert">{p.hint}</div> : null)}
    </div>
  );
}
