// The ops a feature editor's draft makes (the same rule as opsFromDraft in main.tsx, kept here so it can be tested without the app): a field set to null is
// removed, a changed `type` is a different feature (Press Pull: Offset <-> Straight) and is replaced whole, anything else is a `set` per changed field.
import type { EditOp } from '@ck/session';

export function opsFromDraftFor(f: Record<string, unknown>, id: string, next: Record<string, unknown>): EditOp[] {
  if (Object.values(next).some((v) => v === null)) {
    const feature = { ...f, ...next } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === null) delete feature[k];
    return JSON.stringify(feature) === JSON.stringify(f) ? [] : [{ op: 'replace' as const, id, feature } as unknown as EditOp];
  }
  if (typeof next.type === 'string' && next.type !== f.type) return [{ op: 'replace' as const, id, feature: { ...f, ...next } } as unknown as EditOp];
  return Object.entries(next).filter(([path, value]) => f[path] !== value).map(([path, value]) => ({ op: 'set' as const, id, path, value }) as EditOp);
}
