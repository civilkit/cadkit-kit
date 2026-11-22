import { main } from './commands';

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`cadkit: ${String((e as Error)?.stack ?? e)}\n`);
    process.exit(1);
  },
);
