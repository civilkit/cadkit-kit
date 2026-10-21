// The file format's version. Files carry `version`; a build opens any file but says so when the file is newer than it knows.
export const PART_VERSION = 1;

/** True when the document was written by a newer build than this one (a missing or non-numeric version counts as 1). */
export function isNewerPart(doc: { version?: unknown }): boolean {
  return typeof doc.version === 'number' && doc.version > PART_VERSION;
}
