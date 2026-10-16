// State of the parts-library section of the Catalog panel (signals: only the section redraws on typing).
import { signal } from '@preact/signals';
import { boslEntry, defaultParams, type Category, type Params } from './entries';

export const boslQuery = signal('');
export const boslCategory = signal<Category | 'all'>('all');
export const boslSelected = signal<string | null>(null);
/** Edited parameter values per entry (an entry that was never edited has its defaults). */
export const boslValues = signal<Record<string, Params>>({});

export const paramsOf = (id: string): Params => {
  const e = boslEntry(id);
  return { ...(e ? defaultParams(e) : {}), ...(boslValues.value[id] ?? {}) };
};
export function setParam(id: string, key: string, value: number | boolean | string): void {
  boslValues.value = { ...boslValues.value, [id]: { ...paramsOf(id), [key]: value } };
}
export function resetParams(id: string): void {
  const { [id]: _drop, ...rest } = boslValues.value;
  boslValues.value = rest;
}
