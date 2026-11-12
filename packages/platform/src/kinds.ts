// The one table of file kinds the app opens: which extensions are binary containers (read as bytes; text would corrupt them)
// and which are text. The file picker, the drop path and the Open / Import menus all take their answers from here.

export type FileKind = 'part' | 'step' | 'dxf' | 'svg' | 'stl' | 'sldprt' | 'skp' | 'fcstd' | 'solidcraft' | 'obj' | 'glb' | '3mf';

export const FILE_KINDS: Record<FileKind, { exts: string[]; binary: boolean }> = {
  part: { exts: ['ckpart', 'ckpart', 'json', 'gz'], binary: false },   // JSON; a gzip stream is detected by its magic and unpacked to text
  step: { exts: ['step', 'stp'], binary: false },
  dxf: { exts: ['dxf'], binary: false },
  svg: { exts: ['svg'], binary: false },
  stl: { exts: ['stl'], binary: true },                                // binary STL is the common case; ASCII STL is parsed from the same bytes
  obj: { exts: ['obj'], binary: true },                                // text, but read as bytes: a big OBJ is decoded once, by the reader
  glb: { exts: ['glb'], binary: true },
  '3mf': { exts: ['3mf'], binary: true },
  sldprt: { exts: ['sldprt'], binary: true },
  skp: { exts: ['skp'], binary: true },
  fcstd: { exts: ['fcstd'], binary: true },
  solidcraft: { exts: ['solidcraft'], binary: true },
};

const extOf = (name: string): string => name.split('.').pop()?.toLowerCase() ?? '';

/** The kind of a file name, or null when the app does not know the extension. */
export function fileKindOf(name: string): FileKind | null {
  const ext = extOf(name);
  for (const k of Object.keys(FILE_KINDS) as FileKind[]) if (FILE_KINDS[k].exts.includes(ext)) return k;
  return null;
}

/** True when the file must be read as bytes. Unknown extensions are not binary here (the caller still gets the bytes). */
export const isBinaryName = (name: string): boolean => { const k = fileKindOf(name); return k ? FILE_KINDS[k].binary : false; };

/** Picker `accept` list (with dots) for the given kinds. */
export const acceptFor = (...kinds: FileKind[]): string[] => kinds.flatMap((k) => FILE_KINDS[k].exts.map((e) => '.' + e));
