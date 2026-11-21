// Re-render a component when any signal read inside `read` changes; returns what `read` returned last. The store's views use it.
import { useEffect, useState } from 'preact/hooks';
import { effect } from '@preact/signals-core';

export function useSig<T>(read: () => T): T {
  const [v, set] = useState<{ v: T }>(() => ({ v: read() }));
  useEffect(() => effect(() => { set({ v: read() }); }), []);
  return v.v;
}
