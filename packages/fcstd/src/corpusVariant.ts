// "Same recipe, different parameter" for the corpus: find what a model's variant() changed (diff of the base dump and the .v1 dump), and
// apply the same change to an imported base through the importer's parameter map (`FcImport.params`), so the test can rebuild and compare
// with the v1 dump. Pure functions.
import type { FcImport } from './import';

export interface Change { object: string; prop: string; from: unknown; to: unknown; /** the dump value of the property in v1 (number, or text of a cell) */ value: number | string | null }

const num = (v: any): number | null => (typeof v === 'number' ? v : v && typeof v === 'object' && typeof v.value === 'number' ? v.value : v && typeof v === 'object' && typeof v.index === 'number' ? v.index : null);

/** Properties that FreeCAD recomputes from others (never the thing the variant set). */
const DERIVED = new Set(['Spacings', 'ThreadDepth', 'ThreadDiameter', 'ThreadSize', 'Visibility', 'Label', 'Label2', 'ExpressionEngine', 'Proxy', 'Group', 'BaseFeature', 'Tip', 'Support', 'AttachmentSupport', 'MapMode']);

export function diffDumps(base: any, v1: any): Change[] {
  const out: Change[] = [];
  const b = new Map<string, any>(base.objects.map((o: any) => [o.name, o]));
  for (const o of v1.objects as any[]) {
    const a = b.get(o.name);
    if (!a) continue;
    const driven = new Set<string>((o.expressions ?? []).map((e: any) => String(e.path).replace(/^\./, '')));
    const full = (v: any) => (Array.isArray(v) ? v.length > 0 : !!v);
    const attached = full(o.properties?.AttachmentSupport) || full(o.properties?.Support) || (o.properties?.MapMode && o.properties.MapMode.enum !== 'Deactivated');
    for (const [k, v] of Object.entries<any>(o.sheet ? {} : o.properties ?? {})) {
      if (DERIVED.has(k) || JSON.stringify(v) === JSON.stringify(a.properties?.[k])) continue;
      if (driven.has(k) || [...driven].some((d) => d.startsWith(k + '.'))) continue; // derived from its expression (below: a changed expression)
      if (k === 'Placement' && attached) continue;
      // patterns derive the one of Offset / Length that their Mode does not use
      const mode = String(o.properties?.Mode?.enum ?? '');
      if (/Pattern$/.test(o.typeId) && ((k === 'Offset' && /^(Extent|Overall length)$/i.test(mode)) || (k === 'Length' && /^Spacing$|^Offset$/i.test(mode)))) continue;
      out.push({ object: o.name, prop: k, from: a.properties?.[k], to: v, value: num(v) });
    }
    // an expression that was replaced (the new value is what FreeCAD computed for it)
    const was = new Map<string, string>((a.expressions ?? []).map((e: any) => [String(e.path).replace(/^\./, ''), String(e.expression)]));
    for (const e of (o.expressions ?? []) as any[]) {
      const path = String(e.path).replace(/^\./, '');
      if (was.has(path) && was.get(path) !== e.expression && /^[A-Za-z]+$/.test(path)) out.push({ object: o.name, prop: path, from: was.get(path), to: e.expression, value: typeof e.value === 'number' ? e.value : num(e.value) });
      else if (was.has(path) && was.get(path) !== e.expression && /^Constraints\.\w+$/.test(path)) out.push({ object: o.name, prop: path, from: was.get(path), to: e.expression, value: typeof e.value === 'number' ? e.value : num(e.value) });
    }
    // sketch constraint values (named ones by name, others by index)
    const ca: any[] = a.sketch?.constraints ?? [], cb: any[] = o.sketch?.constraints ?? [];
    cb.forEach((c, i) => {
      const was = ca[i];
      if (was && c.value !== undefined && was.value !== c.value && !driven.has(`Constraints.${c.name}`)) out.push({ object: o.name, prop: c.name ? `Constraints.${c.name}` : `Constraints[${i}]`, from: was.value, to: c.value, value: c.value });
    });
    // spreadsheet cells
    const sa = new Map<string, any>((a.sheet?.cells ?? []).map((c: any) => [c.address, c]));
    for (const c of (o.sheet?.cells ?? []) as any[]) {
      const was = sa.get(c.address);
      if (was && was.content !== c.content && !(was.alias == null && (o.sheet.cells as any[]).some((x) => x.alias && x.address === c.address))) out.push({ object: o.name, prop: c.alias ? `alias:${c.alias}` : `cell:${c.address}`, from: was.content, to: c.content, value: typeof c.value === 'object' && c.value ? c.value.value : c.value });
    }
  }
  return out;
}

/** Apply the changes to the imported part. `ok: false` says why the importer cannot (no parameter for it). */
/** `optional(change)`: a change that may have no parameter (it belongs to something global, such as a spreadsheet another Body does not use). */
export function applyChange(imp: FcImport, changes: Change[], optional: (c: Change) => boolean = () => false): { ok: true } | { ok: false; why: string } {
  const params = imp.params ?? [];
  const missing: string[] = [];
  for (const c of changes) {
    const p = params.find((x) => x.path === `${c.object}.${c.prop}`);
    if (!p || c.value == null || typeof c.value !== 'number') { if (!optional(c)) missing.push(`${c.object}.${c.prop}`); continue; }
    p.set(imp.part as any, c.value);
  }
  return missing.length ? { ok: false, why: `the importer has no parameter for ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ` (+${missing.length - 4})` : ''}` } : { ok: true };
}
