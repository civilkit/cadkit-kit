// Output shaping: a size cap on tool results (big JSON is cut with a note, never silently).
export const MAX_OUTPUT_CHARS = 48000;

/** Cut long arrays (depth first) until the JSON fits `max`; if it still does not, cut the text. */
export function capJson(value: unknown, max = MAX_OUTPUT_CHARS): { text: string; truncated: boolean } {
  let text = JSON.stringify(value, null, 1) ?? 'null';
  if (text.length <= max) return { text, truncated: false };
  for (const keep of [200, 80, 30, 10, 4]) {
    const cut = shrink(value, keep);
    text = JSON.stringify(cut, null, 1);
    if (text.length <= max) return { text, truncated: true };
  }
  return { text: `${text.slice(0, max)}\n... [output cut at ${max} of ${text.length} characters: narrow the request (a query, an id, fewer points)]`, truncated: true };
}

function shrink(v: unknown, keep: number): unknown {
  if (Array.isArray(v)) {
    const head = v.slice(0, keep).map((x) => shrink(x, keep));
    return v.length > keep ? [...head, `... ${v.length - keep} more of ${v.length} items`] : head;
  }
  if (v && typeof v === 'object' && !(v instanceof Uint8Array)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shrink(x, keep)]));
  }
  if (typeof v === 'string' && v.length > 4000) return `${v.slice(0, 4000)}... [${v.length - 4000} more characters]`;
  return v;
}
