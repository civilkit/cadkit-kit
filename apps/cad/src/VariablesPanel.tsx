import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { PartDoc } from '@ck/part-model';
import { Icon, ExprInput, errorText, resolveVariables, completions, nameError, type ExprCode, type Variable } from '@kit/ui';
import { t } from './i18n';
import type { DocPatch } from './docFields';
import {
  applyConfig, configOf, firstProblem, freshName, matchesConfig, readActive, readConfigs, readVars, renamePatch, usesOf, type Config,
} from './variables';

export type ApplyResult = { ok: true } | { ok: false; errors: Array<{ feature: string; code: string }> };
const UNITS = ['', 'mm', '°'];
const fmt = (v: number): string => String(Math.round(v * 1e6) / 1e6);

/** One expression cell with variable-name completion; it keeps the text as typed (no `=`) and commits on Enter or blur. */
function ExprCell(p: { testid?: string; value: string; vars: Variable[]; label: string; bad: boolean; onCommit(v: string): void }): JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [full, setFull] = useState(() => /[A-Za-z_]/.test(p.value));   // a formula needs the letters: "ƒ" switches the phone keyboard between the digit pad and the full one
  const shown = text ?? p.value;
  const sc = resolveVariables(p.vars);
  const items = text !== null ? completions(shown, sc).slice(0, 6) : [];
  const finish = (): void => { if (text !== null && text !== p.value) p.onCommit(text); setText(null); };
  const pick = (name: string): void => { setText(shown.replace(/([A-Za-z_][A-Za-z0-9_]*)$/, '') + name + (['sqrt', 'sin', 'cos', 'tan', 'abs'].includes(name) ? '(' : '')); setSel(0); };
  return (
    <span class="expr-field">
      <input
        type="text" inputMode={full ? 'text' : 'decimal'} enterKeyHint="done" spellcheck={false} autocomplete="off" aria-label={p.label} data-testid={p.testid} aria-invalid={p.bad ? 'true' : undefined} class={p.bad ? 'bad' : ''}
        value={shown}
        onInput={(e) => { setText((e.currentTarget as HTMLInputElement).value); setSel(0); }}
        onFocus={() => setText(p.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (items.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((sel + 1) % items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((sel + items.length - 1) % items.length); return; }
            if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); pick(items[Math.min(sel, items.length - 1)].name); return; }
          }
          if (e.key === 'Enter') { e.preventDefault(); finish(); (e.currentTarget as HTMLInputElement).blur(); }
          if (e.key === 'Escape') { e.preventDefault(); setText(null); (e.currentTarget as HTMLInputElement).blur(); }
        }}
      />
      <button type="button" class={'expr-kb' + (full ? ' on' : '')} tabIndex={-1} aria-pressed={full} aria-label={full ? t('expr.kb.digits') : t('expr.kb.full')}
        onMouseDown={(e) => e.preventDefault()} onClick={() => setFull(!full)}>{full ? '123' : 'ƒ'}</button>
      {items.length ? (
        <ul class="expr-ac" role="listbox">
          {items.map((it, i) => (
            <li key={it.name} role="option" aria-selected={i === sel} class={i === sel ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); pick(it.name); }}>
              <span class="expr-ac-name">{it.name}{it.kind === 'fn' ? '(' : ''}</span>{it.value !== null ? <span class="expr-ac-val">{fmt(it.value)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}

/** The Variables panel: named values (name, expression, value, unit, comment) editable in place, and the configurations (named sets of them). */
export function VariablesPanel(p: { doc: PartDoc | null; onApply(patch: DocPatch, reason: string): Promise<ApplyResult> }): JSX.Element {
  const doc = p.doc;
  const docVars = readVars(doc);
  const sig = JSON.stringify(docVars);
  const [rows, setRows] = useState<Variable[]>(docVars);
  const [msg, setMsg] = useState<string | null>(null);
  const [newCfg, setNewCfg] = useState('');
  useEffect(() => { setRows(readVars(doc)); setMsg(null); }, [sig]);
  if (!doc) return <div class="vars empty">{t('vars.empty')}</div>;

  const configs = readConfigs(doc);
  const active = readActive(doc);
  const sc = resolveVariables(rows);
  const draftProblem = firstProblem(rows);

  const apply = async (patch: DocPatch, reason: string): Promise<boolean> => {
    const r = await p.onApply(patch, t(reason));
    if (r.ok) { setMsg(null); return true; }
    setMsg(r.errors.length ? r.errors.map((e) => `${e.feature}: ${errorText((e.code === 'badExpression' ? 'badExpression' : e.code) as ExprCode)}`).join('; ') : t('vars.rebuildFailed'));
    return false;
  };
  const commitRows = (next: Variable[], extra: DocPatch = {}): void => {
    setRows(next);
    const bad = firstProblem(next);
    if (bad) { setMsg(`${bad.name || t('vars.unnamed')}: ${errorText(bad.code as ExprCode)}`); return; }
    void apply({ variables: next, ...extra }, 'vars.step.set');
  };
  const setField = (i: number, patch: Partial<Variable>): void => {
    const next = rows.map((v, k) => (k === i ? { ...v, ...patch } : v));
    if (patch.comment === '') delete next[i].comment;
    if (patch.unit === '') delete next[i].unit;
    commitRows(next);
  };
  const rename = (i: number, to: string): void => {
    const from = docVars[i]?.name;
    const name = to.trim();
    if (from === undefined || name === from) { setRows(rows.map((v, k) => (k === i ? { ...v, name: from ?? name } : v))); return; }
    const next = rows.map((v, k) => (k === i ? { ...v, name } : v));
    const nameBad = nameError(name, rows.filter((_, k) => k !== i).map((v) => v.name));
    setRows(next);
    if (nameBad) { setMsg(`${name || t('vars.unnamed')}: ${errorText(nameBad)}`); return; }
    const patch = renamePatch(doc, from, name);
    void apply({ ...patch }, 'vars.step.rename');
  };
  const add = (): void => {
    const next = [...rows, { name: freshName(rows), expr: '10', unit: 'mm' }];
    void apply({ variables: next }, 'vars.step.add');
  };
  const remove = (i: number): void => {
    const v = rows[i];
    const uses = usesOf(doc, v.name);
    if (uses.length) { setMsg(t('vars.inUse', { name: v.name, uses: uses.slice(0, 4).join(', ') + (uses.length > 4 ? ', ...' : '') })); return; }
    const configurations = configs.map((c) => { const values = { ...c.values }; delete values[v.name]; return { name: c.name, values }; });
    void apply({ variables: rows.filter((_, k) => k !== i), ...(configs.length ? { configurations } : {}) }, 'vars.step.delete');
  };

  const useConfig = (c: Config): void => { void apply({ variables: applyConfig(docVars, c), activeConfig: c.name }, 'vars.step.config'); };
  const addConfig = (): void => {
    const name = newCfg.trim();
    if (!name) return;
    if (configs.some((c) => c.name === name)) { setMsg(t('vars.config.exists', { name })); return; }
    void apply({ configurations: [...configs, configOf(docVars, name)], activeConfig: name }, 'vars.step.configAdd').then((ok) => { if (ok) setNewCfg(''); });
  };
  const updateConfig = (c: Config): void => { void apply({ configurations: configs.map((x) => (x.name === c.name ? configOf(docVars, c.name) : x)) }, 'vars.step.configUpdate'); };
  const deleteConfig = (c: Config): void => { void apply({ configurations: configs.filter((x) => x.name !== c.name), ...(active === c.name ? { activeConfig: null } : {}) }, 'vars.step.configDelete'); };

  return (
    <div class="vars" data-testid="variables-panel">
      <div class="vars-head">
        <span class="vars-title">{t('vars.title')}</span>
        <button type="button" class="btn" onClick={add} data-testid="vars-add"><Icon name="add-extrude" size={14} />{t('vars.add')}</button>
      </div>
      {rows.length === 0 ? <div class="vars-hint">{t('vars.none')}</div> : (
        <div class="vars-table" role="table" aria-label={t('vars.title')}>
          <div class="vars-row vars-cols" role="row">
            <span>{t('vars.col.name')}</span><span>{t('vars.col.expr')}</span><span class="r">{t('vars.col.value')}</span><span />
          </div>
          {rows.map((v, i) => {
            const err = sc.errors[v.name] ?? (draftProblem && draftProblem.at === i ? (draftProblem.code as ExprCode) : undefined);
            const uses = docVars[i] ? usesOf(doc, docVars[i].name) : [];
            return (
              <div class={'vars-row' + (err ? ' bad' : '')} role="row" key={i} data-var={v.name}>
                <input data-testid={'var-name-' + v.name} class={'vars-name' + (err === 'badName' || err === 'duplicateName' ? ' bad' : '')} aria-label={t('vars.col.name')} spellcheck={false} value={v.name}
                  onInput={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, name: (e.currentTarget as HTMLInputElement).value } : x)))}
                  onBlur={(e) => rename(i, (e.currentTarget as HTMLInputElement).value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />
                <ExprCell testid={'var-expr-' + v.name} value={v.expr} vars={rows.filter((_, k) => k !== i)} label={t('vars.col.expr')} bad={err !== undefined && err !== 'badName' && err !== 'duplicateName'} onCommit={(x) => setField(i, { expr: x })} />
                <span class="vars-value" data-testid="vars-value" title={uses.length ? t('vars.usedBy', { uses: uses.join(', ') }) : undefined}>
                  {sc.values[v.name] !== undefined ? fmt(sc.values[v.name]) : '-'}{uses.length ? <sup class="vars-uses">{uses.length}</sup> : null}
                </span>
                <select aria-label={t('vars.col.unit')} value={v.unit ?? ''} onChange={(e) => setField(i, { unit: (e.currentTarget as HTMLSelectElement).value })}>
                  {UNITS.map((u) => <option key={u} value={u}>{u || '-'}</option>)}
                </select>
                <input class="vars-comment" aria-label={t('vars.col.comment')} value={v.comment ?? ''} placeholder={t('vars.col.comment')}
                  onInput={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, comment: (e.currentTarget as HTMLInputElement).value } : x)))}
                  onBlur={(e) => { const c = (e.currentTarget as HTMLInputElement).value; if (c !== (docVars[i]?.comment ?? '')) setField(i, { comment: c }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />
                <button type="button" class="vars-del" title={t('vars.delete')} aria-label={t('vars.delete')} onClick={() => remove(i)}><Icon name="trash" size={14} /></button>
                {err ? <div class="vars-err" role="alert">{errorText(err)}</div> : null}
              </div>
            );
          })}
        </div>
      )}
      {msg ? <div class="vars-msg" role="alert">{msg}</div> : null}
      <div class="vars-hint">{t('vars.help')}</div>

      <div class="vars-head cfg-head"><span class="vars-title">{t('vars.config.title')}</span></div>
      {configs.length === 0 ? <div class="vars-hint">{t('vars.config.none')}</div> : (
        <ul class="cfg-list" aria-label={t('vars.config.title')}>
          {configs.map((c) => {
            const on = active === c.name;
            const dirty = on && !matchesConfig(docVars, c);
            return (
              <li key={c.name} class={'cfg' + (on ? ' on' : '')} data-config={c.name}>
                <button type="button" class="cfg-use" aria-pressed={on} onClick={() => useConfig(c)} title={Object.entries(c.values).map(([k, e]) => `${k} = ${e}`).join(', ')}>
                  {on ? <Icon name="check" size={14} /> : null}<span>{c.name}</span>{dirty ? <em>{t('vars.config.modified')}</em> : null}
                </button>
                <button type="button" class="btn sm" onClick={() => updateConfig(c)} title={t('vars.config.updateTip')}>{t('vars.config.update')}</button>
                <button type="button" class="vars-del" title={t('vars.config.delete')} aria-label={t('vars.config.delete')} onClick={() => deleteConfig(c)}><Icon name="trash" size={14} /></button>
              </li>
            );
          })}
        </ul>
      )}
      <div class="cfg-add">
        <input aria-label={t('vars.config.name')} placeholder={t('vars.config.name')} value={newCfg} disabled={rows.length === 0}
          onInput={(e) => setNewCfg((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') addConfig(); }} />
        <button type="button" class="btn" onClick={addConfig} disabled={!newCfg.trim() || rows.length === 0} data-testid="cfg-add">{t('vars.config.add')}</button>
      </div>
      <div class="vars-hint">{t('vars.config.help')}</div>
    </div>
  );
}
