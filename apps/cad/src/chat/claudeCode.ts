// The Claude Code provider: asks the local service (packages/mcp daemon, already paired through the agent link) to run one turn of
// the user's own Claude Code and reads its events back as newline-delimited JSON. The page holds no key and no account: the session
// token the pairing code bought is the only credential, and it opens nothing but the agent link routes.
import { ChatError, type ChatErrorCode, type ChatEvent, type ChatProvider, type ChatTurn } from './types';

export const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku'];
const CODES = new Set<ChatErrorCode>(['claude_missing', 'not_logged_in', 'rate_limit', 'overloaded', 'cap', 'busy', 'bad_request', 'failed']);

export interface ClaudeCodeOptions {
  /** Where the service is and the paired session token, or null when the agent link is off. */
  endpoint(): { port: number; session: string } | null;
  fetch?: typeof fetch;
}

export function claudeCodeProvider(o: ClaudeCodeOptions): ChatProvider {
  return {
    id: 'claude-code',
    models: CLAUDE_MODELS,
    async send(turn: ChatTurn, onEvent: (e: ChatEvent) => void): Promise<void> {
      const ep = o.endpoint();
      if (!ep) throw new ChatError('not_linked');
      const f = o.fetch ?? globalThis.fetch.bind(globalThis);
      let res: Response;
      try {
        res = await f(`http://127.0.0.1:${ep.port}/bridge/chat`, {
          method: 'POST', signal: turn.signal, headers: { authorization: `Bearer ${ep.session}`, 'content-type': 'application/json' },
          body: JSON.stringify({ text: turn.text, model: turn.model, ...(turn.resume ? { resume: turn.resume } : {}) }),
        });
      } catch (e) {
        if (turn.signal.aborted || (e as { name?: string })?.name === 'AbortError') throw new ChatError('aborted');
        throw new ChatError('service_unreachable');
      }
      if (res.status === 401) throw new ChatError('not_linked');
      if (res.status === 400) throw new ChatError('bad_request');
      if (!res.ok || !res.body) throw new ChatError('failed', `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let ended = false;
      const handle = (line: string): void => {
        if (!line.trim()) return;
        let e: { type?: string; code?: string; detail?: string } & Record<string, unknown>;
        try { e = JSON.parse(line); } catch { return; }
        if (e.type === 'error') throw new ChatError(CODES.has(e.code as ChatErrorCode) ? e.code as ChatErrorCode : 'failed', typeof e.detail === 'string' ? e.detail : undefined);
        if (e.type === 'done') ended = true;
        if (e.type === 'session' || e.type === 'text' || e.type === 'tool' || e.type === 'tool_result' || e.type === 'done') onEvent(e as unknown as ChatEvent);
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
        }
        handle(buf);
      } catch (e) {
        if (e instanceof ChatError) throw e;
        if (turn.signal.aborted || (e as { name?: string })?.name === 'AbortError') throw new ChatError('aborted');
        throw new ChatError('service_unreachable');
      }
      if (!ended && !turn.signal.aborted) throw new ChatError('service_unreachable');   // the stream stopped before the end
    },
  };
}
