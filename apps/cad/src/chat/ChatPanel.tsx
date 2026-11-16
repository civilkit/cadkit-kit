import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Signal } from '@preact/signals-core';
import type { LinkState } from '@kit/agent-link';
import { t } from '../i18n';
import { useSignals } from '../useSignals';
import type { ChatSession } from './chatSession';
import { textAttrs } from '@kit/ui';

export interface ChatLink {
  state: Signal<LinkState>;
  allowEdit: Signal<boolean>;
  connect(code: string): Promise<void>;
  setAllowEdit(v: boolean): void;
}

const REPO = 'https://github.com/civilkit/cadkit-kit';
const pairArgs = (origin: string): string => `--pair${/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin) || !origin.startsWith('http') ? '' : ` --allow-origin ${origin}`}`;

const REPO_KERNEL = 'https://github.com/civilkit/cadkit-kernel';
const WASM_URL = 'https://civilkit.io/cad/kernel/ck_wasm.wasm';

/** One line that gets the source, builds it and starts the local service (for a terminal). The kit expects the kernel repository beside it. */
export function setupCommand(origin: string): string {
  return `mkdir -p ~/civilkit-cad && cd ~/civilkit-cad && git clone ${REPO} kit && git clone ${REPO_KERNEL} kernel && (cd kit && npm install) && (cd kernel/packages && npm install && npm run build) && curl -fLo ck_wasm.wasm ${WASM_URL} && CK_WASM=$PWD/ck_wasm.wasm node kit/packages/mcp/bin/ck-mcp.mjs ${pairArgs(origin)}`;
}

/** The same thing as a request to paste to an agent (Claude Code, Codex...). */
export function setupPrompt(origin: string): string {
  return `Set up the CivilKit CAD local service in ~/civilkit-cad. Clone ${REPO} to ~/civilkit-cad/kit and ${REPO_KERNEL} to ~/civilkit-cad/kernel (git pull if they already exist). Run npm install in kit, and npm install then npm run build in kernel/packages. Download ${WASM_URL} to ~/civilkit-cad/ck_wasm.wasm. Then run CK_WASM=$HOME/civilkit-cad/ck_wasm.wasm node ~/civilkit-cad/kit/packages/mcp/bin/ck-mcp.mjs ${pairArgs(origin)} and show me the pairing code it prints. Leave it running.`;
}

const KNOWN = ['state', 'screenshot', 'run_script', 'undo', 'redo', 'docs', 'list_methods'];
const toolLabel = (name: string): string => { const n = name.replace(/^app_/, ''); return KNOWN.includes(n) ? t(`chat.tool.${n}`) : t('chat.tool.other', { name }); };

/** The chat: set-up card while the local service is not linked, then the conversation. */
export function ChatPanel(p: { session: ChatSession; link: ChatLink; origin?: string }): JSX.Element {
  useSignals(() => { p.session.items.value; p.session.busy.value; p.session.model.value; p.session.context.value; p.link.state.value; p.link.allowEdit.value; });
  const s = p.session;
  const linked = p.link.state.value.state === 'connected';
  const [text, setText] = useState('');
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = log.current; if (el) el.scrollTop = el.scrollHeight; }, [s.items.value]);
  const go = (): void => { const v = text; if (!v.trim() || s.busy.value) return; setText(''); void s.send(v); };
  if (!linked) return <Setup link={p.link} origin={p.origin ?? (typeof location !== 'undefined' ? location.origin : '')} />;
  const ctx = s.context.value;
  const allow = p.link.allowEdit.value;
  return (
    <div class="chat-panel" data-testid="chat-panel">
      <div class="chat-head">
        <label class="chat-field"><span>{t('chat.model')}</span>
          <select aria-label={t('chat.model')} value={s.model.value} disabled={s.busy.value} onChange={(e) => s.setModel((e.currentTarget as HTMLSelectElement).value)}>
            {s.models.map((m) => <option key={m} value={m}>{t(`chat.model.${m}`)}</option>)}
          </select></label>
        <button class="rb-btn" title={t('chat.new.tip')} data-testid="chat-new" onClick={() => s.newChat()}>{t('chat.new')}</button>
      </div>
      <div class="chat-ctx" role="group" aria-label={t('chat.context')}>
        <span>{t('chat.context')}</span>
        {(['selection', 'view', 'comments'] as const).map((k) => (
          <label key={k} title={t(`chat.ctx.${k}.tip`)}><input type="checkbox" data-testid={`chat-ctx-${k}`} checked={ctx[k]} onChange={(e) => s.setContext({ [k]: (e.currentTarget as HTMLInputElement).checked })} /> {t(`chat.ctx.${k}`)}</label>
        ))}
      </div>
      <label class="chat-edit"><input type="checkbox" data-testid="chat-allow-edit" checked={allow} onChange={(e) => p.link.setAllowEdit((e.currentTarget as HTMLInputElement).checked)} /> {t('chat.edit')}</label>
      <div class="tb-note" data-tone={allow ? 'warn' : undefined}>{t(allow ? 'chat.edit.on' : 'chat.edit.off')}</div>
      <div class="chat-log" role="log" aria-live="polite" ref={log} data-testid="chat-log">
        {s.items.value.length === 0 ? <div class="tb-note">{t('chat.empty')}</div> : null}
        {s.items.value.map((i) => i.kind === 'tool'
          ? <div key={i.id} class="chat-tool" data-state={i.state}>{i.state === 'failed' ? t('chat.tool.failed', { what: toolLabel(i.name) }) : toolLabel(i.name) + (i.state === 'running' ? '...' : '')}</div>
          : <div key={i.id} class={'chat-msg chat-' + i.kind} role={i.kind === 'error' ? 'alert' : undefined}>
              {i.kind === 'user' || i.kind === 'assistant' ? <b>{t(i.kind === 'user' ? 'chat.you' : 'chat.assistant')}</b> : null}
              <span class="chat-text">{i.text}</span>
            </div>)}
        {s.busy.value ? <div class="tb-note" data-testid="chat-working">{t('chat.working')}</div> : null}
      </div>
      <div class="chat-input">
        <textarea aria-label={t('chat.input')} placeholder={t('chat.input.placeholder')} rows={3} value={text} data-testid="chat-input"
          onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } e.stopPropagation(); }} />
        {s.busy.value
          ? <button class="rb-btn" data-testid="chat-stop" onClick={() => s.stop()}>{t('chat.stop')}</button>
          : <button class="rb-btn" data-testid="chat-send" disabled={!text.trim()} onClick={go}>{t('chat.send')}</button>}
      </div>
      <details class="chat-privacy tb-note"><summary>{t('chat.privacy.title')}</summary>{t('chat.privacy')}</details>
    </div>
  );
}

/** The terminal command with one step per line, for reading. Only the `&&` outside parentheses breaks, and the text still runs as pasted. */
function oneStepPerLine(cmd: string): string {
  let depth = 0; let out = '';
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    if (c === '(') depth++; else if (c === ')') depth--;
    if (depth === 0 && cmd.startsWith(' && ', i)) { out += ' &&\n'; i += 3; } else out += c;
  }
  return out;
}

function Setup(p: { link: ChatLink; origin: string }): JSX.Element {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const st = p.link.state.value;
  const cmd = setupCommand(p.origin);
  const prompt = setupPrompt(p.origin);
  const copy = (text: string) => () => { try { void navigator.clipboard.writeText(text); } catch { /* no clipboard */ } };
  const link = async (): Promise<void> => { setBusy(true); try { await p.link.connect(code); setCode(''); } catch { /* the state shows why */ } finally { setBusy(false); } };
  return (
    <div class="chat-panel chat-setup" data-testid="chat-setup">
      <b class="set-head">{t('chat.setup.title')}</b>
      <div class="tb-note">{t('chat.setup.why')}</div>
      <div>{t('chat.setup.step1')}</div>
      <div class="chat-cmd"><code data-testid="chat-prompt">{prompt}</code>
        <button class="rb-btn" onClick={copy(prompt)}>{t('chat.setup.copy')}</button></div>
      <div class="tb-note">{t('chat.setup.step1b')}</div>
      <div class="chat-cmd"><code data-testid="chat-cmd">{oneStepPerLine(cmd)}</code>
        <button class="rb-btn" onClick={copy(cmd)}>{t('chat.setup.copy')}</button></div>
      <div>{t('chat.setup.step2')}</div>
      <label class="set-row"><span>{t('chat.setup.code')}</span>
        <input {...textAttrs} type="text" placeholder="52311-ABCD-EFGH-JKMN-PQRS" aria-label={t('chat.setup.code')} data-testid="chat-code" value={code}
          onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && code.trim()) void link(); }} /></label>
      <div class="set-row"><button class="rb-btn" data-testid="chat-link" disabled={busy || !code.trim()} onClick={() => void link()}>{busy ? t('chat.setup.linking') : t('chat.setup.link')}</button></div>
      {st.state === 'error' ? <div class="tb-note" role="alert" data-tone="err">{t('chat.setup.failed', { reason: st.message })}</div> : null}
      <div class="tb-note">{t('chat.setup.note')}</div>
      <div class="tb-note chat-privacy">{t('chat.privacy')}</div>
    </div>
  );
}
