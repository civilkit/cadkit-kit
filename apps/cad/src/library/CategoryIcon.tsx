// A small picture for a part that has no thumbnail yet: what its category looks like (hand-drawn SVG on a 40x40 grid).
type Glyph = 'motor' | 'gear' | 'bolt' | 'ring' | 'plate' | 'box';
const PATHS: Record<Glyph, string[]> = {
  motor: ['M10 13h16v14H10z', 'M26 17h7v6h-7z', 'M13 13v14M17 13v14'],
  gear: ['M20 11l2.5 2.5 3.5-.5.5 3.5L29 18.5 27.5 22l1.5 3.5-3 2-1 3.5-3.5-1L20 30l-2.5 2-3.5 1-1-3.5-3-2L11 22l-1.5-3.5L12 16l.5-3.5 3.5.5z', 'M20 17a4 4 0 1 0 0.01 0z'],
  bolt: ['M12 11h16v5H12z', 'M17 16v17h6V16', 'M17 21h6M17 25h6M17 29h6'],
  ring: ['M20 9a11 11 0 1 0 0.01 0z', 'M20 15a5 5 0 1 0 0.01 0z'],
  plate: ['M6 24l10-5h18l-10 5z', 'M6 24h18v5H6zM24 24l10-5v5l-10 5z', 'M12 25.5h.01M18 25.5h.01'],
  box: ['M9 15l9-4h14l-9 4z', 'M9 15h14v16H9z', 'M23 15l9-4v16l-9 4z'],
};
const RULES: Array<[RegExp, Glyph]> = [
  [/motor|bldc|servo|stepper|actuator/, 'motor'], [/gear|pinion|rack|cog|sprocket/, 'gear'], [/bolt|screw|nut|thread|fasten|stud|rivet/, 'bolt'],
  [/bearing|ring|washer|bushing|o-?ring|pulley|wheel/, 'ring'], [/plate|bracket|mount|panel|sheet|clamp/, 'plate'],
];
export const glyphFor = (category: string): Glyph => RULES.find(([re]) => re.test(category.toLowerCase()))?.[1] ?? 'box';

export function CategoryIcon({ category }: { category: string }) {
  const g = glyphFor(category);
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true" data-glyph={g}>
      {PATHS[g].map((d, i) => <path key={i} d={d} style={i === 0 ? 'fill:var(--accent-soft, rgba(110,150,255,.22))' : undefined} />)}
    </svg>
  );
}
