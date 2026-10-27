// The file format's version. Files carry `version`; a build opens any file but says so when the file is newer than it knows.
export const PART_VERSION = 1;

/** True when the document was written by a newer build than this one (a missing or non-numeric version counts as 1). */
export function isNewerPart(doc: { version?: unknown }): boolean {
  return typeof doc.version === 'number' && doc.version > PART_VERSION;
}

/** The format names before `ck-part`: still read, never written. */
export const LEGACY_PART_FORMATS = ['fw-part', 'formwerk-part'] as const;

export const isPartFormat = (f: unknown): boolean => f === 'ck-part' || (LEGACY_PART_FORMATS as readonly unknown[]).includes(f);

/** An old-named document becomes `ck-part` in place, so the next save writes the current name. */
export function normalizePartFormat(doc: { format?: unknown }): void {
  if ((LEGACY_PART_FORMATS as readonly unknown[]).includes(doc.format)) doc.format = 'ck-part';
}
