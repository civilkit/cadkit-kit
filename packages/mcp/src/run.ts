import { main } from './cli';
main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stderr.write(`ck-mcp: ${String((e as Error)?.stack ?? e)}\n`); process.exit(1); });
