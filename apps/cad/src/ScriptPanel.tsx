import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { EXAMPLES, formatScript, createRunControl, formatElapsed, throttleProgress, type Progress, type RunOptions, type ScriptError } from '@kit/script';
import { t } from './i18n';
import { highlight } from './scriptHighlight';

/** The Script tab: a code box with line numbers, Run (Ctrl/Cmd+Enter), examples and the error list. Run builds a new part the first time and then rebuilds that same part in place (see scriptTarget.ts). */
export function ScriptPanel(p: { saved: string; name?: string; onRun(code: string, run?: Pick<RunOptions, 'signal' | 'onProgress'>): Promise<ScriptError[]> }): JSX.Element {
  const [code, setCode] = useState(p.saved || EXAMPLES[0].code);
  const [errors, setErrors] = useState<ScriptError[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLPreElement>(null);
  const under = useRef<HTMLPreElement>(null);   // the coloured copy of the code that sits under the transparent textarea
  const toks = useMemo(() => highlight(code), [code]);
  // a document with its own script (opened from a file) replaces what is in the box
  useEffect(() => { if (p.saved) { setCode(p.saved); setErrors([]); } }, [p.saved]);
  const lines = code.split('\n').length;
  const bad = new Set(errors.map((e) => e.line));
  // a run in progress: the report (throttled), the time it started and the switch that cancels it
  const [prog, setProg] = useState<Progress | null>(null);
  const [, setTick] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const started = useRef(0);
  const ctl = useRef<ReturnType<typeof createRunControl> | null>(null);
  const run = async (): Promise<void> => {
    ctl.current?.cancel();   // a run still waiting on the unsaved-changes question is dropped for this one
    const c = createRunControl();
    ctl.current = c; started.current = performance.now(); setCancelling(false);
    const tick = setInterval(() => setTick((n) => n + 1), 500);
    try {
      // the report starts with the run itself (after the unsaved-changes question, if there was one)
      setErrors(await p.onRun(code, { signal: c.signal, onProgress: throttleProgress((x) => { if (ctl.current === c) { setProg(x); } }) }));
    } finally { clearInterval(tick); if (ctl.current === c) { ctl.current = null; setProg(null); } }
  };
  const fileIn = useRef<HTMLInputElement>(null);
  const openFile = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    setCode(await f.text()); setErrors([]);
    if (fileIn.current) fileIn.current.value = '';   // the same file can be opened again
  };
  const save = (): void => {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (p.name ?? '').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').concat('.script.js').replace(/^\.script/, 'script.script');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const format = (): void => {
    const next = formatScript(code);
    if (next === code) return;
    const el = area.current;
    // through the editing command, so the browser's own Undo (Ctrl/Cmd+Z) can take the formatting back
    if (el) { el.focus(); el.select(); if (document.execCommand('insertText', false, next)) return; }
    setCode(next);
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
      <select style="width:100%;min-width:0" aria-label={t('script.examples')} value="" onChange={(e) => { const ex = EXAMPLES.find((x) => x.id === (e.currentTarget as HTMLSelectElement).value); if (ex) { setCode(ex.code); setErrors([]); } }}>
        <option value="">{t('script.examples')}</option>
        {EXAMPLES.map((x) => <option key={x.id} value={x.id}>{t('script.example.' + x.id, undefined, x.title)}</option>)}
      </select>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <button class="btn primary" disabled={!!prog} onClick={() => void run()} title="Ctrl/Cmd+Enter">{t('script.run')}</button>
        {prog ? <button class="btn" onClick={() => { ctl.current?.cancel(); setCancelling(true); }}>{t('script.cancel')}</button> : null}
        <button class="btn" onClick={() => fileIn.current?.click()} title={t('script.open.tip')}>{t('script.open')}</button>
        <button class="btn" onClick={save} title={t('script.save.tip')}>{t('script.save')}</button>
        <button class="btn" onClick={format} title={t('script.format.tip')}>{t('script.format')}</button>
        <input ref={fileIn} type="file" accept=".js,.ts,.mjs,.txt,text/plain,text/javascript" style="display:none" onChange={(e) => void openFile((e.currentTarget as HTMLInputElement).files?.[0])} />
      </div>
      {prog ? (
        <div role="status" aria-live="polite" style="font-size:12px;display:flex;flex-direction:column;gap:3px">
          <div>{cancelling ? t('script.cancelling') : prog.phase === 'loading' ? t('script.loading') : t('script.progress', { done: prog.done, total: prog.total })} · {formatElapsed(performance.now() - started.current)}</div>
          <progress max={Math.max(1, prog.total)} value={prog.done} style="width:100%" />
        </div>
      ) : null}
      <div style="display:flex;flex:1;min-height:160px;border:1px solid var(--border,#888);border-radius:4px;overflow:hidden;font:12px/18px ui-monospace,Menlo,monospace">
        <pre ref={gutter} aria-hidden="true" style="margin:0;padding:4px 6px;text-align:right;overflow:hidden;opacity:.7;user-select:none;min-width:2.5em">
          {Array.from({ length: lines }, (_, i) => <div key={i} style={bad.has(i + 1) ? 'color:#e5484d;font-weight:700' : ''}>{i + 1}</div>)}
        </pre>
        <div style="position:relative;flex:1;min-width:0">
          <pre ref={under} class="script-hl" aria-hidden="true">
            <code>{toks.map((k, i) => (k.kind ? <span key={i} class={'syn-' + k.kind}>{k.text}</span> : k.text))}{'\n '}</code>
          </pre>
          <textarea
            ref={area} value={code} spellcheck={false} aria-label={t('script.title')} wrap="off" class="script-ta"
            onInput={(e) => setCode((e.currentTarget as HTMLTextAreaElement).value)}
            onScroll={(e) => {
              const el = e.currentTarget as HTMLTextAreaElement;
              if (gutter.current) gutter.current.scrollTop = el.scrollTop;
              if (under.current) under.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
            }}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void run(); } else if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); format(); } }}
          />
        </div>
      </div>
      <ul class="script-errors" aria-live="polite" style="margin:0;padding:0;list-style:none;font-size:12px;max-height:30%;overflow:auto">
        {errors.map((e, i) => (
          <li key={i}><button class="link" style="all:unset;cursor:pointer;color:#e5484d" onClick={() => gotoLine(e.line)}>{e.line ? t('script.errorAt', { line: e.line, message: e.message }) : e.message}</button></li>
        ))}
      </ul>
    </div>
  );
}
