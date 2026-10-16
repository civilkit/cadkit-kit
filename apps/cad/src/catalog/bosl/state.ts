// Edited parameter values of the BOSL2 entries (signals: only the form and the armed item redraw on typing).
import { signal } from '@preact/signals';
import { boslEntry, defaultParams, type Params } from './entries';

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
