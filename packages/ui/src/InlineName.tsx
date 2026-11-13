import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { t } from './i18n';
import { textAttrs } from './keypad';

/** A text field that replaces a name in place: Enter (or leaving the field) commits, Esc cancels. An empty or unchanged
 *  name counts as a cancel. */
export function InlineName(p: { value: string; onCommit(name: string): void; onCancel(): void; class?: string }): JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const v = (ref.current?.value ?? '').trim();
    if (commit && v && v !== p.value) p.onCommit(v); else p.onCancel();
  };
  return (
    <input {...textAttrs}
      ref={ref}
      class={'inline-name ' + (p.class ?? '')}
      defaultValue={p.value}
      aria-label={t('ui.tree.renameField', undefined, 'Name')}
      onClick={(e) => e.stopPropagation()}
      onDblClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      }}
      onBlur={() => finish(true)}
    />
  );
}
