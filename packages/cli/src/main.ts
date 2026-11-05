#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { defaultDataDir, runCli } from './cli.js';

runCli(process.argv.slice(2), {
  dataDir: defaultDataDir(),
  cwd: process.cwd(),
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  entry: fileURLToPath(import.meta.url),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  },
);
