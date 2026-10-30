import type { JSX } from 'preact';

export interface Field { path: string; label: string; kind: 'number' | 'boolean' | 'text' | 'choice' | 'list'; value: number | boolean | string; choices?: string[] }

// autoName (a generated name that follows the feature) and draftNew (a refused first try kept in its editor) are bookkeeping, not fields
const SKIP = new Set(['id', 'type', 'name', 'points', 'entities', 'constraints', 'autoName', 'draftNew']);

/** Flat primitive fields of a feature, for the parameter form. */
export function fieldsOf(feature: Record<string, unknown>): Field[] {
  const out: Field[] = [];
  for (const [path, value] of Object.entries(feature)) {
    if (SKIP.has(path)) continue;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
      out.push({
        path,
        label: path,
        kind: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text',
        value,
      });
    }
  }
  return out;
}

export function Inspector(p: { feature: Record<string, unknown> | null; onSet(path: string, value: number | boolean | string): void; /** Regen warnings of this feature, shown above the fields. */ warnings?: Array<{ code: string; hint: string }> }): JSX.Element {
  const fields = p.feature ? fieldsOf(p.feature) : [];
  return (
    <div class="insp">
      {(p.warnings ?? []).map((w, i) => <p key={i} class="insp-warn" role="status" data-warning={w.code}><b>{w.code}</b> {w.hint}</p>)}
      {fields.map((f) => (
        <label class="fld" key={f.path}>
          <span class="fld-label">{f.label}</span>
          {f.kind === 'boolean' ? (
            <input
              type="checkbox"
              checked={f.value as boolean}
              onChange={(e) => p.onSet(f.path, (e.currentTarget as HTMLInputElement).checked)}
            />
          ) : f.kind === 'number' ? (
            <input
              type="number"
              value={String(f.value)}
              onChange={(e) => {
                const raw = (e.currentTarget as HTMLInputElement).value;
                const v = Number(raw);
                if (raw.trim() !== '' && Number.isFinite(v)) p.onSet(f.path, v);
              }}
            />
          ) : (
            <input
              type="text"
              value={String(f.value)}
              onChange={(e) => p.onSet(f.path, (e.currentTarget as HTMLInputElement).value)}
            />
          )}
        </label>
      ))}
    </div>
  );
}
