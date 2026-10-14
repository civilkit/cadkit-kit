import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { t } from './i18n';
import { fieldsOf, type Field } from './Inspector';

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
      <div class="fedit-title">{title}</div>
      {sections.map((sec) => (
        <div class="fedit-sec" key={sec.id}>
          <div
            class="fedit-sec-head"
            onClick={() => setCollapsed((c) => ({ ...c, [sec.id]: !c[sec.id] }))}
          >
            {sec.title}
          </div>
          {collapsed[sec.id] ? null : (
            <div class="fedit-sec-fields">
              {sec.fields.map((f) => {
                const value = draft[f.path] ?? f.value;
                const picking = p.pickingPath === f.path;
                const isRef = REFERENCE_FIELDS.has(f.path);
                const isList = f.kind === 'list';
                return (
                  <label class={'fedit-fld' + (picking ? ' picking' : '')} key={f.path} data-path={f.path}>
                    <span class="fedit-fld-label">{labelOf(f)}</span>
                    {isList ? (
                      <span class="fedit-ref">
                        <input
                          type="text"
                          value={listText(f.path, draft[f.path] ?? feature[f.path])}
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
                          value={String(value)}
                          readonly={picking}
                          onChange={(e) => apply(f.path, (e.currentTarget as HTMLInputElement).value)}
                        />
                        {p.onPickRequest ? (
                          <button type="button" class="fedit-pick" onClick={() => p.onPickRequest!(f.path)}>
                            {t('ui.editor.pick', undefined, 'Pick')}
                          </button>
                        ) : null}
                      </span>
                    ) : kindOf(f) === 'boolean' ? (
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(e) => apply(f.path, (e.currentTarget as HTMLInputElement).checked)}
                      />
                    ) : kindOf(f) === 'number' ? (
                      <input
                        type="number"
                        value={String(value)}
                        onChange={(e) => {
                          const raw = (e.currentTarget as HTMLInputElement).value;
                          const v = Number(raw);
                          if (raw.trim() !== '' && Number.isFinite(v)) apply(f.path, v);
                        }}
                      />
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
      {p.hint ? <div class="fedit-hint" role="alert">{p.hint}</div> : null}
      <div class="fedit-actions">
        <button type="button" class="fedit-confirm" onClick={confirm}>
          {t('ui.editor.confirm', undefined, 'Confirm')}
        </button>
        <button type="button" class="fedit-cancel" onClick={cancel}>
          {t('ui.cancel', undefined, 'Cancel')}
        </button>
      </div>
    </div>
  );
}
