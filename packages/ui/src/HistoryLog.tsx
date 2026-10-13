import type { JSX } from 'preact';

export interface HistoryEntry {
  id: string;
  author: 'you' | 'agent';
  time: string;
  title: string;
  reason?: string;
  chips?: string[];
  ops?: string;
  failed?: boolean;
}
export type HistoryFilter = 'All' | 'You' | 'Agent' | 'Failed';

const keep = (f: HistoryFilter, e: HistoryEntry) =>
  f === 'All' || (f === 'You' && e.author === 'you') || (f === 'Agent' && e.author === 'agent') || (f === 'Failed' && !!e.failed);

/** Vertical edit log, oldest first. `here` is how many entries are applied: the "model is here" line sits after them. */
export function HistoryLog(p: {
  entries: HistoryEntry[]; here: number; filter: HistoryFilter;
  onFilter(f: HistoryFilter): void; onGoto(count: number): void;
}): JSX.Element {
  const rows: JSX.Element[] = [];
  const line = <div class="here-line" key="here">model is here</div>;
  if (p.here === 0) rows.push(line);
  let applied = 0;                       // applied (non-rejected) edits seen so far; `here` counts these only
  p.entries.forEach((e) => {
    const after = !e.failed && applied >= p.here;
    const goto = e.failed ? applied : applied + 1;
    if (keep(p.filter, e)) {
      rows.push(
        <div key={e.id} role="listitem" class={'he' + (after ? ' after' : '') + (e.failed ? ' fail' : '')} onClick={() => p.onGoto(goto)}>
          <span class={'av ' + e.author}>{e.author === 'agent' ? 'AI' : 'U'}</span>
          <div>
            <div class="hd"><b>{e.title}</b><span>{e.author === 'agent' ? 'agent' : 'you'} · {e.time}</span></div>
            {e.reason ? <div class="why">{'\u201c'}{e.reason}{'\u201d'}</div> : null}
            {(e.chips ?? []).map((c) => <span key={c} class={'chipx' + (e.failed ? ' bad' : '')}>{c}</span>)}
            {e.ops ? <details><summary>ops</summary><code>{e.ops}</code></details> : null}
          </div>
        </div>,
      );
    }
    if (!e.failed) { applied++; if (applied === p.here) rows.push(line); }
  });
  return (
    <div class="hist-log">
      <div class="fchips">
        {(['All', 'You', 'Agent', 'Failed'] as HistoryFilter[]).map((f) => (
          <button key={f} class="btn" aria-pressed={p.filter === f} onClick={() => p.onFilter(f)}>{f}</button>
        ))}
        <button class="btn" style={{ marginLeft: 'auto' }} disabled={p.here === p.entries.filter((e) => !e.failed).length} onClick={() => p.onGoto(p.here)}>
          Revert to step {p.here}
        </button>
      </div>
      <div class="hlog" role="list">{rows}</div>
      {p.entries.length === 0 ? <div class="empty">No edits yet.</div> : null}
    </div>
  );
}
