import { useEffect, useState } from 'preact/hooks';
import { effect } from '@preact/signals-core';

/** Re-render the calling component whenever any signal read inside `read` changes. Mounting costs one render, not two. */
export function useSignals(read: () => void): void {
  const [, bump] = useState(0);
  useEffect(() => {
    let ready = false;   // effect() runs `read` once synchronously on setup: that run only subscribes, it is not a change
    const stop = effect(() => { read(); if (ready) bump((n) => n + 1); });
    ready = true;
    return stop;
  }, []);
}
