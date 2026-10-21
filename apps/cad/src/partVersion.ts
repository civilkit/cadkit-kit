// The file format's version. Files carry `version`; a build opens any file but says so when the file is newer than it knows.
export const PART_VERSION = 1;

/** True when the document was written by a newer build than this one (a missing or non-numeric version counts as 1). */
export function isNewerPart(doc: { version?: unknown }): boolean {
  return typeof doc.version === 'number' && doc.version > PART_VERSION;
}

/** The format name before `ck-part`: still read, never written. */
export const LEGACY_PART_FORMAT = 'ck-part';

export const isPartFormat = (f: unknown): boolean => f === 'ck-part' || f === LEGACY_PART_FORMAT;

/** An old-named document becomes `ck-part` in place, so the next save writes the current name. */
export function normalizePartFormat(doc: { format?: unknown }): void {
  if (doc.format === LEGACY_PART_FORMAT) doc.format = 'ck-part';
}
