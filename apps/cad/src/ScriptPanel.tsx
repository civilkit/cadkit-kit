import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { EXAMPLES, type ScriptError } from '@kit/script';
import { t } from './i18n';

/** The Script tab: a code box with line numbers, Run (Ctrl/Cmd+Enter), examples and the error list. Running opens a NEW part. */
export function ScriptPanel(p: { saved: string; onRun(code: string): Promise<ScriptError[]> }): JSX.Element {
  const [code, setCode] = useState(p.saved || EXAMPLES[0].code);
  const [errors, setErrors] = useState<ScriptError[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLPreElement>(null);
  // a document with its own script (opened from a file) replaces what is in the box
  useEffect(() => { if (p.saved) { setCode(p.saved); setErrors([]); } }, [p.saved]);
  const lines = code.split('\n').length;
  const bad = new Set(errors.map((e) => e.line));
  const run = async (): Promise<void> => {
    setErrors(await p.onRun(code));
  };
  const gotoLine = (line: number): void => {
    const el = area.current;
    if (!el || line < 1) return;
    const start = code.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
    const end = start + (code.split('\n')[line - 1] ?? '').length;
    el.focus(); el.setSelectionRange(start, end);
    el.scrollTop = Math.max(0, (line - 3) * 18);
  };
  return (
    <div class="script-panel" style="display:flex;flex-direction:column;gap:6px;padding:8px;height:100%;box-sizing:border-box;min-height:0">
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn primary" onClick={() => void run()} title="Ctrl/Cmd+Enter">{t('script.run')}</button>
        <select aria-label={t('script.examples')} value="" onChange={(e) => { const ex = EXAMPLES.find((x) => x.id === (e.currentTarget as HTMLSelectElement).value); if (ex) { setCode(ex.code); setErrors([]); } }}>
          <option value="">{t('script.examples')}</option>
          {EXAMPLES.map((x) => <option key={x.id} value={x.id}>{t('script.example.' + x.id)}</option>)}
        </select>
      </div>
      <div style="display:flex;flex:1;min-height:160px;border:1px solid var(--border,#888);border-radius:4px;overflow:hidden;font:12px/18px ui-monospace,Menlo,monospace">
        <pre ref={gutter} aria-hidden="true" style="margin:0;padding:4px 6px;text-align:right;overflow:hidden;opacity:.7;user-select:none;min-width:2.5em">
          {Array.from({ length: lines }, (_, i) => <div key={i} style={bad.has(i + 1) ? 'color:#e5484d;font-weight:700' : ''}>{i + 1}</div>)}
        </pre>
        <textarea
          ref={area} value={code} spellcheck={false} aria-label={t('script.title')} wrap="off"
          style="flex:1;border:0;outline:0;resize:none;padding:4px;font:inherit;background:transparent;color:inherit;white-space:pre;overflow:auto"
          onInput={(e) => setCode((e.currentTarget as HTMLTextAreaElement).value)}
          onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = (e.currentTarget as HTMLTextAreaElement).scrollTop; }}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void run(); } }}
        />
      </div>
      <ul class="script-errors" aria-live="polite" style="margin:0;padding:0;list-style:none;font-size:12px;max-height:30%;overflow:auto">
        {errors.map((e, i) => (
          <li key={i}><button class="link" style="all:unset;cursor:pointer;color:#e5484d" onClick={() => gotoLine(e.line)}>{e.line ? t('script.errorAt', { line: e.line, message: e.message }) : e.message}</button></li>
        ))}
      </ul>
    </div>
  );
}
