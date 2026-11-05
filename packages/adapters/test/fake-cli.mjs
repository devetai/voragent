#!/usr/bin/env node
// CLI giả: fake-cli.mjs <fixture> [--exit N] [--touch name] [--session id]
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const fixture = args[0];
let exitCode = 0;
let touch = null;
let session = null;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--exit') exitCode = Number(args[++i]);
  else if (args[i] === '--touch') touch = args[++i];
  else if (args[i] === '--session') session = args[++i];
}

const cwd = process.cwd();
const stdin = readFileSync(0, 'utf8');
writeFileSync(join(cwd, '.fake-stdin.txt'), stdin);
appendFileSync(join(cwd, '.fake-calls.jsonl'), JSON.stringify(args) + '\n');


writeFileSync(join(cwd, '.fake-pid.txt'), String(process.pid));
const grandchild = join(dirname(fileURLToPath(import.meta.url)), 'fake-grandchild.mjs');
const gcOpts = { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (session !== null) process.stdout.write(JSON.stringify({ type: 'session', id: session }) + '\n');
for (const line of readFileSync(fixture, 'utf8').split(/\r?\n/)) {
  if (line.trim() === '') continue;
  let msg = null;
  try {
    msg = JSON.parse(line);
  } catch {
    // dòng không phải JSON: in nguyên văn
  }
  if (msg !== null && msg.type === 'sleep') {
    await sleep(Number(msg.ms));
    continue;
  }
  if (msg !== null && msg.type === 'grandchild') {
    spawn(process.execPath, [grandchild, join(cwd, '.fake-grandchild.pid'), 'quiet'], gcOpts);
    continue;
  }
  if (msg !== null && msg.type === 'orphan') {
    // Cháu mồ côi: người khởi chạy thoát ngay, cháu tách nhóm và giữ pipe stdout.
    const launcher =
      "require('node:child_process').spawn(process.execPath, [" +
      JSON.stringify(grandchild) + ', ' + JSON.stringify(join(cwd, '.fake-orphan.pid')) +
      ", 'chatty'], { detached: true, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] }).unref()";
    const l = spawn(process.execPath, ['-e', launcher], gcOpts);
    await new Promise((r) => l.on('exit', r));
    continue;
  }
  process.stdout.write(line + '\n');
}
if (touch !== null) writeFileSync(join(cwd, touch), 'edited by fake');
// Không gọi process.exit: để stdout xả hết (tránh cắt cụt trên pipe Windows).
process.exitCode = exitCode;
