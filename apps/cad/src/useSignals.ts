import { useEffect, useState } from 'preact/hooks';
import { effect } from '@preact/signals-core';

/** Re-render the calling component whenever any signal read inside `read` changes. */
export function useSignals(read: () => void): void {
  const [, bump] = useState(0);
  useEffect(() => effect(() => { read(); bump((n) => n + 1); }), []);
}
