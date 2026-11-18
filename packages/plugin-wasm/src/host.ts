// Spike host for a craft:plugin@0.1.0 component transpiled by jco (sync mode, `-I async` instantiation).
//
// The guest calls `commands.run` synchronously; our kernel answers asynchronously. jco 1.42 has no asyncify mode (only sync and JSPI),
// so this host uses RESTART-AND-REPLAY, which needs no JSPI, no asyncify and no SharedArrayBuffer and so works on every engine:
//   run the guest; when it asks for command k whose reply is not known yet, throw out of the import (the guest is abandoned),
//   answer command k asynchronously, then run a FRESH instance again with replies 0..k cached. The guest is a pure function of the
//   replies (its only other imports are log / progress), so the replay reaches command k again and goes on.
// Cost: one guest instantiation and a replay of the cached prefix per command (measured in the report).

export interface CommandHandler { (command: string, args: unknown): Promise<unknown> }
export class CommandFailed extends Error { constructor(readonly command: string, readonly reason: string) { super(`${command}: ${reason}`); } }

export interface Loaded { getCoreModule(path: string): Promise<WebAssembly.Module>; instantiate: (get: (p: string) => Promise<WebAssembly.Module>, imports: Record<string, unknown>) => Promise<{ entry: { execute(entry: string, params: string): string } }> }

export interface RunStats { commands: number; syncCommands: number; instances: number; guestMs: number; handlerMs: number; totalMs: number; perCommand: Array<{ command: string; ms: number }>; log: string[] }
export interface RunOpts { /** the file grants a plugin may save to (name -> true); a file it writes is handed back with the result */ files?: Record<string, boolean>; maxCommands?: number; deadlineMs?: number; allow?: ReadonlySet<string>; /** answers a command synchronously (edits that only record), or returns undefined to go the async way */ sync?: (command: string, args: unknown) => unknown }

/** Runs `entry` of the plugin, answering every commands.run through `handler`. Resolves to the entry's JSON result or rejects with its error. The loop itself is replay.js (plain JS, shared with the sandbox Worker). */
export { runPlugin } from './replay.js';
