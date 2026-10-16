// File names and part names.

export const PART_EXT = '.ckpart';

/** What the user typed as a file name, made safe and ending in .ckpart. Null when nothing usable is left. */
export function fileNameFor(input: string): string | null {
  let base = input.trim().replace(/\.ckpart$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim();
  if (!base) return null;
  if (base.length > 100) base = base.slice(0, 100).trim();
  return base + PART_EXT;
}

/** The part name for a file name: the name without its extension. */
export const partNameOf = (file: string): string => file.replace(/\.(ckpart|json)$/i, '');

/** Counter for new parts in a session: Part1, Part2, ... The first blank part of a session is Part1. */
export function createNameCounter(start = 1) {
  let n = start;
  return {
    /** The name for the next new part. */
    next: () => `Part${n++}`,
    /** The next one without taking it. */
    peek: () => `Part${n}`,
    /** Count a name that was taken some other way (a loaded part called Part5 makes the next new one Part6). */
    seen(name: string) { const m = /^Part(\d+)$/.exec(name); if (m && Number(m[1]) >= n) n = Number(m[1]) + 1; },
  };
}

export type DropKind = 'part' | 'step' | 'sldprt' | 'dxf' | 'stl' | 'fcstd' | 'unknown';
export function dropKind(fileName: string): DropKind {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'ckpart' || ext === 'json') return 'part';
  if (ext === 'step' || ext === 'stp') return 'step';
  if (ext === 'sldprt') return 'sldprt';
  if (ext === 'dxf') return 'dxf';
  if (ext === 'stl') return 'stl';
  if (ext === 'fcstd') return 'fcstd';
  return 'unknown';
}
