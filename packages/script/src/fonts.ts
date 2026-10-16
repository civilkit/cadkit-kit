/** Fonts a script may name besides the built-in 'gauge' and 'engrave': the ids of the curated library the app hosts (apps/cad/public/fonts/fonts.json; a test keeps the two lists equal). */
export const CURATED_FONT_IDS: readonly string[] = [
  'barlow', 'source-sans-3', 'barlow-condensed', 'bebas-neue', 'pt-serif', 'special-elite', 'ibm-plex-mono', 'great-vibes', 'satisfy', 'anton',
];
export const BUILTIN_FONT_IDS: readonly string[] = ['gauge', 'engrave'];

/** The error text for a font that is neither built in nor in the library. */
export function unknownFontMessage(who: string, font: unknown): string {
  return `${who}: unknown font '${String(font)}': use 'gauge' (condensed sans), 'engrave' (serif) or a library font id: ${CURATED_FONT_IDS.join(', ')}`;
}
export const isKnownFont = (f: unknown): f is string => typeof f === 'string' && (BUILTIN_FONT_IDS.includes(f) || CURATED_FONT_IDS.includes(f));
