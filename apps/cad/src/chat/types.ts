// The chat panel's provider interface (docs/agent-chat.md). A provider runs one chat turn: it takes the user's text and reports what
// happens as events, and it runs its own tool loop (the model's tool calls are executed elsewhere and only reported here).
//  - claudeCode.ts: the local service starts the user's Claude Code and relays its output (the default, no key).
//  - A direct API-key provider would implement the same interface (call the API from the page, run the loop, report tool events);
//    it is not built.

export type ChatEvent =
  | { type: 'session'; id: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; id: string; name: string }
  | { type: 'tool_result'; id: string; ok: boolean }
  | { type: 'done' };

export interface ChatTurn {
  text: string;
  model: string;
  /** The conversation to continue (the id from an earlier `session` event), or null for a new one. */
  resume: string | null;
  signal: AbortSignal;
}

export interface ChatProvider {
  id: string;
  /** The model choices (ids the provider understands). */
  models: string[];
  /** Run one turn. Resolves after `done`; throws ChatError. A pressed Stop (signal) resolves quietly or throws code `aborted`. */
  send(turn: ChatTurn, onEvent: (e: ChatEvent) => void): Promise<void>;
}

/** Why a turn failed; the panel shows `chat.err.<code>` in plain words. Never carries a secret. */
export type ChatErrorCode = 'not_linked' | 'service_unreachable' | 'claude_missing' | 'not_logged_in' | 'rate_limit' | 'overloaded' | 'cap' | 'busy' | 'bad_request' | 'aborted' | 'failed';
export class ChatError extends Error {
  constructor(readonly code: ChatErrorCode, readonly detail?: string) { super(code); this.name = 'ChatError'; }
}
