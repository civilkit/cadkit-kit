import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { t } from './i18n';
import { fieldsOf, type Field } from './Inspector';
import { Icon, featureIconName } from './icons';

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
};

/** Fields whose value is one of a few words, shown as a dropdown (the current value is always kept in the list). */
const ENUMS: Record<string, string[]> = {
  op: ['add', 'cut'],
  end: ['blind', 'through', 'throughBoth', 'upToNext'],
};
const UNITS: Record<string, string> = {
  depth: 'mm', radius: 'mm', distance: 'mm', thickness: 'mm', diameter: 'mm', spacing: 'mm', offset: 'mm', angle: '°',
};
const enumLabel = (path: string, v: string) => t(`ui.editor.value.${path}.${v}`, undefined, v);

const REFERENCE_FIELDS = new Set(['sketch', 'axis', 'path', 'neutral']);
/** Fields holding a list of references (edges, faces, features); filled from the viewport selection. */
export const LIST_FIELDS = new Set(['edges', 'faces', 'seeds']);

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
  /** The closed shapes of the feature's sketch (extrude, revolve): checkboxes choose which ones are used. Fewer than two: no list. */
  shapes?: Array<{ id: string; label: string }>;
  /** The pointer is over a shape's row (or left it: null), so the app can light it up in the view. */
  onShapeHover?(id: string | null): void;
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
  const sections = sectionsOf(feature);
  const title = t('feature.' + feature.type, undefined, feature.type ?? '') + (feature.name ? ` — ${feature.name}` : '');

  const apply = (path: string, value: unknown): void => {
    const next = { ...draft, [path]: value };
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

  const confirm = (): void => p.onConfirm(draft);
  const cancel = (): void => p.onCancel();

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  return (
    <div class="fedit" data-feature={featureId} tabIndex={0} onKeyDown={onKey}>
      <div class="fedit-head">
        <Icon name={featureIconName(String(feature.type ?? ''), String((draft.op ?? feature.op) ?? ''))} size={22} class="fedit-icon" />
        <div class="fedit-title">{title}</div>
        <button type="button" class="fedit-confirm" onClick={confirm} title={t('ui.editor.confirm', undefined, 'Confirm')} aria-label={t('ui.editor.confirm', undefined, 'Confirm')}><Icon name="check" size={20} /></button>
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
                const refText = isList ? listText(f.path, draft[f.path] ?? feature[f.path]) : String(value);
                const missing = (isRef || isList) && refText.trim() === '';
                const isBool = !isRef && !isList && kindOf(f) === 'boolean';
                const enums = !isRef && !isList && typeof value === 'string' && ENUMS[f.path]
                  ? (ENUMS[f.path].includes(value) ? ENUMS[f.path] : [value, ...ENUMS[f.path]]) : null;
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
                          readonly={picking}
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
                    ) : kindOf(f) === 'number' ? (
                      <span class="fedit-num">
                        <input
                          type="number"
                          value={String(value)}
                          onChange={(e) => {
                            const raw = (e.currentTarget as HTMLInputElement).value;
                            const v = Number(raw);
                            if (raw.trim() !== '' && Number.isFinite(v)) apply(f.path, v);
                          }}
                        />
                        {UNITS[f.path] ? <span class="fedit-unit">{UNITS[f.path]}</span> : null}
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
      {p.hint ? <div class="fedit-hint" role="alert">{p.hint}</div> : null}
    </div>
  );
}
