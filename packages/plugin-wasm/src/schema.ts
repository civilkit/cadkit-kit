// The input schema of a component's entry (JSON schema, as in SolidCraft's plugin.json) as our parameter list, so a wasm plugin gets the
// same generated form, validation and agent tool as every other generator.
import type { ParamDef } from '@kit/plugin';

type Prop = { type?: string; title?: string; description?: string; default?: unknown; minimum?: number; maximum?: number; maxLength?: number; enum?: Array<string | number>; 'x-visible-if'?: ParamDef['visibleIf'] };

export function schemaToParams(schema: unknown): ParamDef[] {
  const s = schema as { properties?: Record<string, Prop>; required?: string[] } | undefined;
  const out: ParamDef[] = [];
  for (const [name, p] of Object.entries(s?.properties ?? {})) {
    const d: ParamDef = { name, type: 'string' };
    if (p.enum) { d.type = 'enum'; d.options = p.enum.map((value) => ({ value })); }
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
    out.push(d);
  }
  return out;
}
