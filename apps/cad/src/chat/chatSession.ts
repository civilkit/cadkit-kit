// The chat's state: the messages, the running turn, the model and the context toggles. Provider-agnostic (see types.ts), so the
// panel and the tests use it with a fake provider. Nothing here is saved with the document.
import { signal } from '@preact/signals-core';
import { t } from '../i18n';
import { ChatError, type ChatEvent, type ChatProvider } from './types';

export type ChatItem =
  | { id: number; kind: 'user' | 'assistant'; text: string }
  | { id: number; kind: 'tool'; callId: string; name: string; state: 'running' | 'ok' | 'failed' }
  | { id: number; kind: 'error' | 'note'; text: string };

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export interface ChatContextOpts { selection: boolean; view: boolean; comments: boolean }
export interface ChatSessionDeps {
  provider: ChatProvider;
  /** What the app can tell the model about the open document (read when a message is sent). */
  context(): { selection: string[]; script: string };
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

const KEY_MODEL = 'cad.chat.model', KEY_CTX = 'cad.chat.context';
const MAX_SCRIPT = 6000;

/** The text put in front of the user's message for the context boxes that are ticked (and only those). */
export function contextText(o: ChatContextOpts, c: { selection: string[]; script: string }): string {
  const lines: string[] = [];
  if (o.selection) lines.push(c.selection.length ? `Selected in the app: ${c.selection.slice(0, 40).join(', ')}${c.selection.length > 40 ? ` (and ${c.selection.length - 40} more)` : ''}` : 'Nothing is selected in the app.');
  if (o.view) lines.push('Before answering, take a picture of the part with app_screenshot to see what the user sees.');
  if (o.comments) lines.push(c.script.trim() ? `The script saved with the part (its // comments are the user's notes):\n${c.script.length > MAX_SCRIPT ? c.script.slice(0, MAX_SCRIPT) + '\n... (cut)' : c.script}` : 'The part has no saved script.');
  return lines.length ? `[Context from the app]\n${lines.join('\n')}\n\n[Message]\n` : '';
}

export function createChatSession(d: ChatSessionDeps) {
  const store = d.storage === undefined ? (() => { try { return localStorage; } catch { return null; } })() : d.storage;
  const read = (k: string): string | null => { try { return store?.getItem(k) ?? null; } catch { return null; } };
  const write = (k: string, v: string): void => { try { store?.setItem(k, v); } catch { /* private window */ } };
  const savedModel = read(KEY_MODEL);
  let ctxSaved: Partial<ChatContextOpts> = {};
  try { ctxSaved = JSON.parse(read(KEY_CTX) ?? '{}') ?? {}; } catch { /* ignore */ }

  const items = signal<ChatItem[]>([]);
  const busy = signal(false);
  const model = signal(savedModel && d.provider.models.includes(savedModel) ? savedModel : d.provider.models[0]);
  const context = signal<ChatContextOpts>({ selection: ctxSaved.selection === true, view: ctxSaved.view === true, comments: ctxSaved.comments === true });
  let seq = 1, resume: string | null = null, ctl: AbortController | null = null;
  const push = (i: DistributiveOmit<ChatItem, 'id'>): number => { const id = seq++; items.value = [...items.value, { ...i, id } as ChatItem]; return id; };
  const patch = (id: number, f: (i: ChatItem) => ChatItem): void => { items.value = items.value.map((i) => (i.id === id ? f(i) : i)); };

  async function send(text: string): Promise<void> {
    const msg = text.trim();
    if (!msg || busy.value) return;
    busy.value = true;
    push({ kind: 'user', text: msg });
    const c = new AbortController(); ctl = c;
    let live: number | null = null;     // the assistant bubble that text streams into
    const tools = new Map<string, number>();
    const onEvent = (e: ChatEvent): void => {
      if (e.type === 'session') resume = e.id;
      else if (e.type === 'text') {
        if (live === null) live = push({ kind: 'assistant', text: '' });
        const id = live; patch(id, (i) => (i.kind === 'assistant' ? { ...i, text: i.text + e.delta } : i));
      } else if (e.type === 'tool') {
        live = null;                     // text after a tool call is a new bubble
        tools.set(e.id, push({ kind: 'tool', callId: e.id, name: e.name, state: 'running' }));
      } else if (e.type === 'tool_result') {
        const id = tools.get(e.id);
        if (id !== undefined) patch(id, (i) => (i.kind === 'tool' ? { ...i, state: e.ok ? 'ok' : 'failed' } : i));
      }
    };
    try {
      await d.provider.send({ text: contextText(context.value, d.context()) + msg, model: model.value, resume, signal: c.signal }, onEvent);
      if (c.signal.aborted) push({ kind: 'note', text: t('chat.stopped') });
    } catch (e) {
      const code = e instanceof ChatError ? e.code : 'failed';
      if (code === 'aborted' || c.signal.aborted) push({ kind: 'note', text: t('chat.stopped') });
      else push({ kind: 'error', text: t(`chat.err.${code}`) + (e instanceof ChatError && e.detail && code === 'failed' ? ' ' + t('chat.err.detail', { detail: e.detail }) : '') });
    } finally {
      // a tool still marked running never finished (Stop, or an error)
      items.value = items.value.map((i) => (i.kind === 'tool' && i.state === 'running' ? { ...i, state: 'failed' } : i));
      busy.value = false; ctl = null;
    }
  }
  return {
    items, busy, model, context, models: d.provider.models,
    send,
    stop: () => ctl?.abort(),
    newChat: () => { ctl?.abort(); items.value = []; resume = null; },
    setModel: (m: string) => { if (d.provider.models.includes(m)) { model.value = m; write(KEY_MODEL, m); } },
    setContext: (patchOpts: Partial<ChatContextOpts>) => { context.value = { ...context.value, ...patchOpts }; write(KEY_CTX, JSON.stringify(context.value)); },
  };
}
export type ChatSession = ReturnType<typeof createChatSession>;
