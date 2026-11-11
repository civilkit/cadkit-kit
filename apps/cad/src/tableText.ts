// Tables as text: CSV cells that a spreadsheet reads as text, and aligned plain text for an e-mail. Used by the bill of
// materials, the frame cut list and the drawing tables.

/** One CSV cell (RFC 4180): quoted when it holds a comma, quote or line break. A text that starts with `=`, `+`, `-`, `@`, a tab or a
 *  carriage return gets a leading apostrophe, so a spreadsheet shows it as text and never runs it as a formula. Numbers are
 *  written as they are (a negative number is not text). */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of cells as CSV text with CR LF line ends (what Windows programs expect), one row per line; `null` rows are blank lines. */
export function csvText(rows: Array<Array<string | number> | null>): string {
  return rows.map((r) => (r ? r.map(csvCell).join(',') : '')).join('\r\n') + '\r\n';
}

/** A table as aligned plain text, columns padded to their widest cell (numbers right-aligned), ready to paste into an e-mail. */
export function alignedText(head: string[], rows: Array<Array<string | number>>): string {
  const all = [head, ...rows].map((r) => r.map((c) => String(c)));
  const n = Math.max(...all.map((r) => r.length));
  const width = Array.from({ length: n }, (_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
  const numeric = Array.from({ length: n }, (_, i) => rows.length > 0 && rows.every((r) => r[i] === '' || r[i] === undefined || typeof r[i] === 'number' || /^-?\d+(\.\d+)?$/.test(String(r[i]))));
  const line = (r: string[]) => r.map((c, i) => (numeric[i] && r !== all[0] ? c.padStart(width[i]) : c.padEnd(width[i]))).join('  ').trimEnd();
  const rule = width.map((w) => '-'.repeat(w)).join('  ');
  return [line(all[0]), rule, ...all.slice(1).map(line)].join('\n') + '\n';
}
