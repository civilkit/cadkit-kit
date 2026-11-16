import type { Loaded, RunOpts, RunStats, CommandHandler } from './host';
export function runPlugin(loaded: Loaded, entry: string, params: unknown, handler: CommandHandler, opts?: RunOpts): Promise<{ result: unknown; stats: RunStats }>;
