// Tab chain between the dimension value boxes of a sketch: Tab commits the open box and opens the next dimension's, Shift+Tab the previous one.
/** The dimensions that have a value to edit, in the order the sketch lists them (the order they were made). */
export const dimTabOrder = (items: ReadonlyArray<{ id: string; value?: number }>): string[] => items.filter((a) => a.value !== undefined).map((a) => a.id);

/** The dimension after (dir 1) or before (dir -1) `current`, wrapping round the ends; null when there is nothing else to go to. */
export function nextDim(order: readonly string[], current: string, dir: 1 | -1): string | null {
  const i = order.indexOf(current);
  if (order.length < 2 || i < 0) return null;
  return order[(i + dir + order.length) % order.length];
}
