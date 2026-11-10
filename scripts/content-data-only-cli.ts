// Entry point: pnpm content:data-only <base-ref> | --files <file>…
import { main } from './content-data-only.ts';

process.exitCode = main(process.argv.slice(2));
