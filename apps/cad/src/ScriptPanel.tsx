import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { EXAMPLES, formatScript, createRunControl, formatElapsed, throttleProgress, type Progress, type RunOptions, type ScriptCheck, type ScriptError } from '@kit/script';
import { t } from './i18n';
import { highlight } from './scriptHighlight';

/** The Script tab: a code box with line numbers, Run (Ctrl/Cmd+Enter), examples and the error list. Run builds a new part the first time and then rebuilds that same part in place (see scriptTarget.ts). */
/** What a Run reports: the errors (as before), the expect...() rows and how many features it built. A bare error list is still accepted. */
export type RunReport = ScriptError[] | { errors: ScriptError[]; checks?: ScriptCheck[]; features?: number };
export function ScriptPanel(p: { saved: string; name?: string; /** the last report, kept by the app: a Run that opens another tab remounts the panel, which must still show it */ initial?: { errors: ScriptError[]; checks: ScriptCheck[]; ran: number | null }; onReport?(r: { errors: ScriptError[]; checks: ScriptCheck[]; ran: number | null }): void; onRun(code: string, run?: Pick<RunOptions, 'signal' | 'onProgress'>): Promise<RunReport> }): JSX.Element {
  const [code, setCode] = useState(p.saved || EXAMPLES[0].code);
  const [errors, setErrors] = useState<ScriptError[]>(p.initial?.errors ?? []);
  const [checks, setChecks] = useState<ScriptCheck[]>(p.initial?.checks ?? []);
  const [ran, setRan] = useState<number | null>(p.initial?.ran ?? null);   // features built by the last clean run (null: no run yet, or it failed)
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLPreElement>(null);
  const bands = useRef<HTMLDivElement>(null);   // the tinted bars behind the lines that failed
  const under = useRef<HTMLPreElement>(null);   // the coloured copy of the code that sits under the transparent textarea
  const toks = useMemo(() => highlight(code), [code]);
  // a report the app hands over (a Run that opened another tab remounted this panel while it ran)
  useEffect(() => { if (p.initial) { setErrors(p.initial.errors); setChecks(p.initial.checks); setRan(p.initial.ran); } }, [p.initial]);
  // opening the tab puts the caret in the box, so typing never reaches the viewport's single-key shortcuts
  useEffect(() => { area.current?.focus({ preventScroll: true }); }, []);
  // a document with its own script (opened from a file) replaces what is in the box
  const codeNow = useRef(code); codeNow.current = code;
  // (a run stores the code it ran as the document's script: that is the text already in the box, so its errors stay)
  useEffect(() => { if (p.saved && p.saved !== codeNow.current) { setCode(p.saved); setErrors([]); setChecks([]); setRan(null); } }, [p.saved]);
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
    ctl.current = c; started.current = performance.now(); setCancelling(false); setErrors([]); setChecks([]); setRan(null);   // the last run's message goes when the next one starts
    const tick = setInterval(() => setTick((n) => n + 1), 500);
    try {
      // the report starts with the run itself (after the unsaved-changes question, if there was one)
      const rep = await p.onRun(code, { signal: c.signal, onProgress: throttleProgress((x) => { if (ctl.current === c) { setProg(x); } }) });
      const errs = Array.isArray(rep) ? rep : rep.errors;
      const cks = Array.isArray(rep) ? [] : rep.checks ?? [], nran = Array.isArray(rep) || errs.length ? null : rep.features ?? 0;
      setErrors(errs); setChecks(cks); setRan(nran);
      p.onReport?.({ errors: errs, checks: cks, ran: nran });
    } finally {
      clearInterval(tick); if (ctl.current === c) { ctl.current = null; setProg(null); }
      // the Run / Cancel button had the focus (and is gone or disabled during a run): hand it back to the box, not to the page
      const a = document.activeElement;
      if (!a || a === document.body || a.closest?.('.script-panel') || a.closest?.('#vp')) area.current?.focus({ preventScroll: true });
    }
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
      {errors.length ? (
        <div role="alert" class="script-banner" data-testid="script-error-banner">
          <strong>{errors.length > 1 ? t('script.errors', { count: errors.length }) : t('script.error')}</strong>
          <ul>
            {errors.map((e, i) => (
              <li key={i}><button class="link" onClick={() => gotoLine(e.line)}>{e.line ? t('script.errorAt', { line: e.line, message: e.message }) : e.message}</button></li>
            ))}
          </ul>
        </div>
      ) : null}
      {!errors.length && ran !== null ? (
        <div role="status" class="script-ok" data-testid="script-ok">{t('script.done', { count: ran })}{checks.length ? ' · ' + t('script.checksPassed', { count: checks.length }) : ''}</div>
      ) : null}
      {checks.length ? (
        <ul class="script-checks" data-testid="script-checks">
          {checks.map((c, i) => (
            <li key={i} class={c.ok ? 'pass' : 'fail'}><button class="link" onClick={() => gotoLine(c.line)}><span aria-hidden="true">{c.ok ? '\u2713' : '\u2717'}</span> {c.ok ? t('script.checkPass', { what: c.message }) : c.message}</button></li>
          ))}
        </ul>
      ) : null}
      <div style="display:flex;flex:1;min-height:160px;border:1px solid var(--border,#888);border-radius:4px;overflow:hidden;font:12px/18px ui-monospace,Menlo,monospace">
        <pre ref={gutter} aria-hidden="true" style="margin:0;padding:4px 6px;text-align:right;overflow:hidden;opacity:.7;user-select:none;min-width:2.5em">
          {Array.from({ length: lines }, (_, i) => <div key={i} style={bad.has(i + 1) ? 'color:#e5484d;font-weight:700' : ''}>{i + 1}</div>)}
        </pre>
        <div style="position:relative;flex:1;min-width:0;overflow:hidden">
          <div ref={bands} class="script-bands" aria-hidden="true">{[...bad].filter((l) => l > 0).map((l) => <div key={l} class="script-band" data-line={l} style={{ top: 4 + (l - 1) * 18 + 'px' }} />)}</div>
          <pre ref={under} class="script-hl" aria-hidden="true">
            <code>{toks.map((k, i) => (k.kind ? <span key={i} class={'syn-' + k.kind}>{k.text}</span> : k.text))}{'\n '}</code>
          </pre>
          <textarea
            ref={area} value={code} spellcheck={false} aria-label={t('script.title')} wrap="off" class="script-ta"
            onInput={(e) => setCode((e.currentTarget as HTMLTextAreaElement).value)}
            onScroll={(e) => {
              const el = e.currentTarget as HTMLTextAreaElement;
              if (gutter.current) gutter.current.scrollTop = el.scrollTop;
              if (bands.current) bands.current.style.transform = `translate(0, ${-el.scrollTop}px)`;
              if (under.current) under.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
            }}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void run(); } else if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); format(); } }}
          />
        </div>
      </div>
    </div>
  );
}
