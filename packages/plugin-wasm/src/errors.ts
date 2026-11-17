// A wasm plugin's failure as a sentence for the person using the form. The host throws `plugin error: {"tag":...,"val":...}` (the guest's error record as
// JSON); the form used to show that text as it came. Unknown shapes are returned as they are.
const TAIL = /plugin error: (\{.*\})\s*$/s;

export function friendlyPluginError(message: string): string {
  const m = TAIL.exec(message);
  if (!m) return message;
  let e: { tag?: string; val?: unknown };
  try { e = JSON.parse(m[1]); } catch { return message; }
  const val = e.val;
  const sentence = (t: string): string => (t ? t[0].toUpperCase() + t.slice(1) : t);
  const text = (t: unknown): string => String(t ?? '').replace(/kernel refused: ?/, 'the kernel refused it: ');
  switch (e.tag) {
    case 'invalid-input': case 'invalid-manifest': return sentence(text((val as { reason?: unknown } | null)?.reason ?? val));
    case 'command-failed': { const v = val as { command?: string; reason?: unknown } | null; return sentence(`${v?.command ?? 'a command'} failed: ${text(v?.reason)}`); }
    case 'permission-denied': return sentence(`the plugin asked for something it may not do: ${text(val)}`);
    case 'limit-exceeded': return sentence(`the plugin went over its limit: ${text(val)}`);
    case 'trap': return sentence(`the plugin stopped with an error: ${text(val)}`);
    case 'cancelled': return 'The plugin run was cancelled.';
    default: return message;
  }
}
