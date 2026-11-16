// Which help card is open and which button it hangs from. A tiny store (not a signal) so the card, the '?' buttons and the F1 key share one place.
export interface HelpOpen { topic: string; anchor: HTMLElement | null }

let current: HelpOpen | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((f) => f());

export const helpOpen = (): HelpOpen | null => current;
export function subscribeHelp(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }
/** Open the card for a topic next to `anchor`; opening the same topic from the same button again closes it. */
export function openHelp(topic: string, anchor: HTMLElement | null): void {
  current = current && current.topic === topic && current.anchor === anchor ? null : { topic, anchor };
  emit();
}
export function closeHelp(): void { if (current) { current = null; emit(); } }

/** The button F1 and '?' should anchor the card to: the visible help button of that topic, else the global one in the status bar. */
export function helpAnchorFor(topic: string, root: ParentNode = document): HTMLElement | null {
  const all = Array.from(root.querySelectorAll<HTMLElement>('[data-help-topic]'));
  const visible = (el: HTMLElement) => el.getClientRects().length > 0;
  const of = (id: string) => all.filter((el) => el.dataset.helpTopic === id);
  const pick = (list: HTMLElement[]) => list.find(visible) ?? list[0];   // jsdom has no layout: then the first one will do
  return pick(of(topic)) ?? pick(of('guide')) ?? pick(all) ?? null;
}
