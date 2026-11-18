// The input schema of a component's entry (JSON schema, as in SolidCraft's plugin.json) as our parameter list, so a wasm plugin gets the
// same generated form, validation and agent tool as every other generator.
import { SEL_CATEGORIES, type ParamDef, type SelCategory } from '@kit/plugin';

type Prop = { type?: string; title?: string; description?: string; default?: unknown; minimum?: number; maximum?: number; maxLength?: number; enum?: Array<string | number>; oneOf?: Array<{ const?: string | number; title?: string }>; 'x-visible-if'?: ParamDef['visibleIf']; /** a switch whose detail is slow to build: a live preview runs with it off */ 'x-preview-off'?: boolean; minItems?: number; maxItems?: number; items?: { type?: string }; 'x-solidcraft-selection'?: { version?: unknown; accept?: unknown } } & Record<string, unknown>;

/** What this app can pick in the viewport: a body, or a face of one. Edges, profiles and sketch points and curves are not offered yet. */
export const PICKABLE: readonly SelCategory[] = ['body', 'face'];
/** Array properties a schema may use without the annotation (SolidCraft's reserved lists): bodies by name, or references to what is selected. */
const RESERVED: Record<string, { accept: SelCategory[]; asNames?: boolean }> = { bodies: { accept: ['body'], asNames: true }, body_ids: { accept: ['body'], asNames: true }, selection: { accept: ['edge', 'face', 'body'] }, target: { accept: ['edge', 'face', 'body'] }, targets: { accept: ['edge', 'face', 'body'] } };
/** The keywords a selection field may carry; any other (uniqueItems, a detailed `items`) is something this app does not draw. */
const SEL_KEYS = new Set(['type', 'title', 'description', 'minItems', 'maxItems', 'items', 'default', 'x-solidcraft-selection', 'x-solidcraft-icon']);

export function schemaToParams(schema: unknown): ParamDef[] {
  const s = schema as { properties?: Record<string, Prop>; required?: string[] } | undefined;
  const out: ParamDef[] = [];
  for (const [name, p] of Object.entries(s?.properties ?? {})) {
    const d: ParamDef = { name, type: 'string' };
    if (p.type === 'array') {
      const a = selectionField(name, p);
      Object.assign(d, a, { type: 'selection' });
      if (p.title) d.title = p.title;
      if (p.description) d.description = p.description;
      if (!(s?.required ?? []).includes(name)) d.optional = true;
      out.push(d);
      continue;
    }
    const choices = Array.isArray(p.oneOf) ? p.oneOf.filter((o) => o && o.const !== undefined) : [];
    if (p.enum) { d.type = 'enum'; d.options = p.enum.map((value) => ({ value })); }
    else if (choices.length) { d.type = 'enum'; d.options = choices.map((o) => ({ value: o.const as string | number, ...(o.title ? { label: o.title } : {}) })); }
    else if (p.type === 'number' || p.type === 'integer' || p.type === 'boolean' || p.type === 'string') d.type = p.type;
    else throw new Error(`parameter "${name}": unsupported schema type ${JSON.stringify(p.type)}`);
    if (p.title) d.title = p.title;
    if (p.description) d.description = p.description;
    if (p.default !== undefined) d.default = p.default as ParamDef['default'];
    else if (!(s?.required ?? []).includes(name)) d.optional = true;
    if (p.minimum !== undefined) d.min = p.minimum;
    if (p.maximum !== undefined) d.max = p.maximum;
    if (p.maxLength !== undefined) d.maxLength = p.maxLength;
    if (p['x-visible-if']) d.visibleIf = p['x-visible-if'];
    if (p['x-preview-off'] === true && d.type === 'boolean') d.previewOff = true;
    out.push(d);
  }
  return out;
}

/** An array property as a selection field, or an error that says what this app cannot do. */
function selectionField(name: string, p: Prop): Partial<ParamDef> {
  const ann = p['x-solidcraft-selection'];
  const reserved = RESERVED[name];
  if (!ann && !reserved) throw new Error(`parameter "${name}": a list that is not a selection is not supported`);
  for (const k of Object.keys(p)) if (!SEL_KEYS.has(k)) throw new Error(`parameter "${name}": the keyword "${k}" on a selection is not supported`);
  if (p.items && Object.keys(p.items).some((k) => k !== 'type') ) throw new Error(`parameter "${name}": a detailed "items" on a selection is not supported`);
  let accept: SelCategory[]; let asNames = false;
  if (ann) {
    if (Object.keys(ann).some((k) => k !== 'version' && k !== 'accept') || ann.version !== 1 || !Array.isArray(ann.accept) || !ann.accept.length || !ann.accept.every((a) => SEL_CATEGORIES.includes(a as SelCategory))) throw new Error(`parameter "${name}": x-solidcraft-selection must be exactly {"version": 1, "accept": [...]} with ${SEL_CATEGORIES.join(', ')}`);
    accept = ann.accept as SelCategory[];
  } else { accept = reserved.accept; asNames = !!reserved.asNames; }
  const can = accept.filter((a) => PICKABLE.includes(a));
  if (!can.length) throw new Error(`parameter "${name}": it takes ${accept.join(', ')}, which this app cannot pick yet`);
  return { accept: can, ...(asNames ? { asNames } : {}), ...(p.minItems !== undefined ? { minItems: p.minItems } : {}), ...(p.maxItems !== undefined ? { maxItems: p.maxItems } : {}) };
}
