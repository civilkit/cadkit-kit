// The replay host as plain JavaScript, so ONE implementation runs both in Node (tests, host.ts) and inside the sandbox Worker (sandbox.ts
// inlines this file's text). Keep it free of imports and of TypeScript. See host.ts for the types and for why replay (no JSPI, asyncify or SAB).
// Pending must extend Error: jco rethrows an Error from a host import instead of treating it as a result payload.
class Pending extends Error { constructor(command, args) { super('pending'); this.command = command; this.args = args; } }

export async function runPlugin(loaded, entry, params, handler, opts = {}) {
  const max = opts.maxCommands ?? 256;
  const t0 = performance.now();
  const stats = { commands: 0, syncCommands: 0, instances: 0, guestMs: 0, handlerMs: 0, totalMs: 0, perCommand: [], log: [] };
  const replies = [];
  const clockLog = [];
  const cache = new Map();
  const getCore = (p) => { let m = cache.get(p); if (!m) cache.set(p, (m = loaded.getCoreModule(p))); return m; };
  for (;;) {
    if (opts.deadlineMs !== undefined && performance.now() - t0 > opts.deadlineMs) throw new Error(`deadline of ${opts.deadlineMs} ms exceeded`);
    let k = 0, c = 0;
    const wrote = [];   // what this instance saved: only the last one (the one that finishes) counts, the replays before it start over
    const imports = {
      'craft:plugin/commands': {
        run(command, args) {
          if (k < replies.length) {
            const r = replies[k++];
            if (r.ok) return r.json;
            throw { payload: r.error };
          }
          if (opts.sync && (!opts.allow || opts.allow.has(command)) && stats.commands < max) {
            let v;
            try { v = opts.sync(command, JSON.parse(args)); } catch (e) {
              const error = { tag: 'command-failed', val: { command, reason: e instanceof Error ? e.message : String(e) } };
              stats.commands++; replies.push({ ok: false, error }); k++; throw { payload: error };
            }
            if (v !== undefined) { stats.commands++; stats.syncCommands++; const json = JSON.stringify(v); replies.push({ ok: true, json }); k++; return json; }
          }
          throw new Pending(command, args);
        },
      },
      'craft:plugin/log': { log(_level, message) { if (stats.log.length < 200) stats.log.push(String(message).slice(0, 500)); } },
      'craft:plugin/control': { progress() {}, cancelled: () => false },
      // a file is only ever written to a grant the manifest names (opts.files: name -> true), and is handed back to the app, never to a disk; nothing is read
      'craft:plugin/files': {
        readFile() { throw { payload: { tag: 'permission-denied', val: 'this app gives plugins no folders to read' } }; },
        writeFile(grant, path, data) {
          if (!opts.files || !opts.files[grant]) throw { payload: { tag: 'permission-denied', val: 'no file grant named ' + grant } };
          wrote.push({ grant: String(grant), path: String(path), data: new Uint8Array(data) });
        },
      },
      'craft:plugin/clock': { now: () => { const i = c++; if (i >= clockLog.length) clockLog.push(BigInt(Date.now())); return clockLog[i]; } },
    };
    const tg = performance.now();
    let out, pending, failure;
    try {
      const inst = await loaded.instantiate(getCore, imports);
      stats.instances++;
      out = inst.entry.execute(entry, JSON.stringify(params ?? {}));
    } catch (e) {
      if (e instanceof Pending) pending = e; else failure = e;
    }
    stats.guestMs += performance.now() - tg;
    if (pending) {
      if (stats.commands >= max) throw new Error(`limit-exceeded: more than ${max} commands in one run`);
      if (opts.allow && !opts.allow.has(pending.command)) {
        replies.push({ ok: false, error: { tag: 'permission-denied', val: `${pending.command} is not in the manifest's commands` } });
        continue;
      }
      stats.commands++;
      const th = performance.now();
      try {
        const v = await handler(pending.command, JSON.parse(pending.args));
        replies.push({ ok: true, json: JSON.stringify(v ?? {}) });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        replies.push({ ok: false, error: { tag: 'command-failed', val: { command: pending.command, reason } } });
      }
      const ms = performance.now() - th;
      stats.handlerMs += ms; stats.perCommand.push({ command: pending.command, ms });
      continue;
    }
    stats.totalMs = performance.now() - t0;
    if (failure) {
      const p = failure && failure.payload;
      throw Object.assign(new Error(`plugin error: ${JSON.stringify(p ?? String(failure))}`), { payload: p, stats });
    }
    return { result: JSON.parse(out), stats, files: wrote };
  }
}
