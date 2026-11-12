// The one-line timing notice for a SolidCraft import: where the seconds went (see ScImport.timings), then the rebuild in the kernel.
import type { ImportTiming } from '@kit/solidcraft';

type T = (key: string, params?: Record<string, string | number>) => string;
const secs = (ms: number) => (ms / 1000).toFixed(1);

/** `Imported part in 3.2 s: read 0.4, kernel 2.5 (310 questions), mapping 0.3, rebuild 0.0.`; falls back to the read/rebuild split when the import reports no phases. */
export function importTimingsLine(t: T, name: string, timings: ImportTiming[] | undefined, readMs: number, buildMs: number): string {
  const by = (p: ImportTiming['phase']) => timings?.find((x) => x.phase === p);
  const read = by('read'), kernel = by('kernel'), map = by('map');
  if (!read || !kernel || !map) return t('files.solidcraft.timings', { name, read: secs(readMs), build: secs(buildMs) });
  return t('files.solidcraft.timings.phases', { name, total: secs(readMs + buildMs), read: secs(read.ms), kernel: secs(kernel.ms), count: kernel.count ?? 0, map: secs(map.ms), build: secs(buildMs) });
}
