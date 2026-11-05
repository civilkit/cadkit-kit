// What an export does about the cosmetic knurls of the document: write the plain solid, cut them into a scratch copy for the file, ask first, or
// offer the plain solid when the cut fails. The decision only: the kernel work and the dialogs are passed in, so it is the same for every export.
import type { BakeFailure } from './controller';
import type { KnurlExportMode } from './exportPrefs';

/** `none`: no cosmetic knurl, write as usual. `plain`: write the plain solid (and say the knurls are not in it). `baked`: write what `run` made. `cancel`: write nothing. */
export type KnurlChoice<T> = { kind: 'none' } | { kind: 'plain' } | { kind: 'baked'; value: T } | { kind: 'cancel' };
export type BakeRun<T> = { ok: true; value: T } | { ok: false; reason: BakeFailure; message: string };

export async function chooseKnurlExport<T>(o: {
  mode: KnurlExportMode;
  /** cosmetic knurls the export would hold */
  count: number;
  /** the ask dialog: include them, write the plain solid, or cancel the export */
  ask(): Promise<'include' | 'plain' | 'cancel'>;
  run(): Promise<BakeRun<T>>;
  /** the cut failed or timed out: write the plain solid, or cancel */
  failed(reason: Exclude<BakeFailure, 'cancelled'>, message: string): Promise<'plain' | 'cancel'>;
}): Promise<KnurlChoice<T>> {
  if (o.count === 0) return { kind: 'none' };
  if (o.mode === 'off') return { kind: 'plain' };
  if (o.mode === 'ask') {
    const a = await o.ask();
    if (a === 'cancel') return { kind: 'cancel' };
    if (a === 'plain') return { kind: 'plain' };
  }
  const r = await o.run();
  if (r.ok) return { kind: 'baked', value: r.value };
  if (r.reason === 'cancelled') return { kind: 'cancel' };
  return (await o.failed(r.reason, r.message)) === 'plain' ? { kind: 'plain' } : { kind: 'cancel' };
}
