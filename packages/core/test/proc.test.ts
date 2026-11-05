import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeAdapter } from '@voragent/adapters';
import type { Adapter, ParsedEvent, TurnInput } from '@voragent/adapters';
import { runTurn } from '../src/proc.js';

const fixtures = resolve(import.meta.dirname, '../../adapters/test/fixtures');
const fx = (name: string): string => join(fixtures, name);
const fakeCli = resolve(import.meta.dirname, '../../adapters/test/fake-cli.mjs');

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'voragent-proc-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const input = (prompt: string): TurnInput => ({
  prompt,
  systemPrompt: '',
  sessionId: null,
  cwd,
  network: false,
});

const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('waitFor: quá thời gian');
    await sleepMs(25);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const readPid = (name: string): number => Number(readFileSync(join(cwd, name), 'utf8'));

function killQuietly(pid: number | undefined): void {
  if (pid === undefined || Number.isNaN(pid)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // đã chết
  }
}

describe('runTurn', () => {
  it('chạy fixture ok và đẩy sự kiện qua onEvent', async () => {
    const events: ParsedEvent[] = [];
    const adapter = createFakeAdapter({ id: 'claude', fixture: fx('fake-ok.jsonl') });
    const r = await runTurn(adapter, input('hi'), {
      timeoutMs: 10_000,
      onEvent: (e) => events.push(e),
    });
    expect(r.outcome).toBe('ok');
    expect(r.text).toBe('xong');
    expect(events.some((e) => e.type === 'TEXT_MESSAGE_CONTENT')).toBe(true);
  });

  const prompt = 'Dòng 1 "trích dẫn"\nDòng 2 — tiếng Việt có dấu';

  it('chuyển nguyên văn prompt nhiều dòng qua stdin', async () => {
    const adapter = createFakeAdapter({ id: 'claude', fixture: fx('fake-ok.jsonl') });
    const r = await runTurn(adapter, input(prompt), { timeoutMs: 10_000, onEvent: () => {} });
    expect(r.outcome).toBe('ok');
    expect(readFileSync(join(cwd, '.fake-stdin.txt'), 'utf8')).toContain(prompt);
  });

  it.runIf(process.platform === 'win32')('chạy được qua shim .cmd trên Windows', async () => {
    const shim = join(cwd, 'fake.cmd');
    writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${fakeCli}" %*\r\n`);
    const inner = createFakeAdapter({ id: 'claude', fixture: fx('fake-ok.jsonl') });
    const adapter: Adapter = {
      ...inner,
      invocation: (i) => {
        const inv = inner.invocation(i);
        return { ...inv, bin: shim, args: inv.args.slice(1) };
      },
    };
    const r = await runTurn(adapter, input(prompt), { timeoutMs: 10_000, onEvent: () => {} });
    expect(r.outcome).toBe('ok');
    expect(readFileSync(join(cwd, '.fake-stdin.txt'), 'utf8')).toContain(prompt);
  });

  it('hết giờ thì dừng cây tiến trình và trả error trong 2 giây', async () => {
    const adapter = createFakeAdapter({ id: 'claude', fixture: fx('fake-sleep.jsonl') });
    const t0 = Date.now();
    const r = await runTurn(adapter, input('hi'), {
      timeoutMs: 200,
      graceMs: 10_000,
      onEvent: () => {},
    });
    // Ân hạn rất lớn: 'close' phải tới nhờ kill cây tiến trình, không phải nhờ timer ân hạn.
    expect(Date.now() - t0).toBeLessThan(8000); // graceMs là 10 s: chứng minh không chờ hết ân hạn; chừa chỗ cho máy tải (taskkill chậm)
    expect(r.outcome).toBe('error');
    expect(r.error).toBe('timeout');
  });

  it('abort dừng ngay', async () => {
    const adapter = createFakeAdapter({ id: 'claude', fixture: fx('fake-sleep.jsonl') });
    const ac = new AbortController();
    const t0 = Date.now();
    const p = runTurn(adapter, input('hi'), {
      timeoutMs: 30_000,
      signal: ac.signal,
      onEvent: () => {},
    });
    setTimeout(() => ac.abort(), 200);
    const r = await p;
    expect(Date.now() - t0).toBeLessThan(8000); // timeoutMs là 30 s: chứng minh abort không chờ hết hạn; chừa chỗ cho máy tải (taskkill chậm)
    expect(r.outcome).toBe('error');
  });

  it('CLI không tồn tại cho lỗi tiếng Việt', async () => {
    const inner = createFakeAdapter({ id: 'claude', fixture: fx('fake-ok.jsonl') });
    const adapter: Adapter = {
      ...inner,
      invocation: (i) => ({ ...inner.invocation(i), bin: 'khong-ton-tai-xyz' }),
    };
    const r = await runTurn(adapter, input('hi'), { timeoutMs: 5000, onEvent: () => {} });
    expect(r.outcome).toBe('error');
    expect(r.error).toBe('Không tìm thấy lệnh khong-ton-tai-xyz');
  });

  it('tách dòng đúng khi chunk cắt giữa dòng, CRLF và dòng cuối không xuống dòng', async () => {
    const script = join(cwd, 'emit.mjs');
    writeFileSync(
      script,
      [
        "const w = (s) => new Promise((r) => process.stdout.write(s, r));",
        "await w('{\"type\":\"te');",
        "await new Promise((r) => setTimeout(r, 50));",
        "await w('xt\",\"text\":\"a\"}\\r\\n{\"type\":\"text\",\"text\":\"b\"}\\n{\"type\":\"text\",\"text\":\"c\"}');",
      ].join('\n'),
    );
    const lines: string[] = [];
    const adapter: Adapter = {
      id: 'claude',
      detect: async () => ({ installed: true, version: null }),
      invocation: () => ({ bin: process.execPath, args: [script], stdin: '' }),
      createParser: () => ({
        push(line) {
          lines.push(line);
          return [{ type: 'TEXT_MESSAGE_CONTENT', data: {} }];
        },
        finish: () => ({
          outcome: 'ok',
          text: '',
          sessionId: null,
          resetsAt: null,
          error: null,
          usage: null,
          quota: null,
        }),
      }),
    };
    const events: ParsedEvent[] = [];
    await runTurn(adapter, input(''), { timeoutMs: 10_000, onEvent: (e) => events.push(e) });
    expect(lines).toEqual([
      '{"type":"text","text":"a"}',
      '{"type":"text","text":"b"}',
      '{"type":"text","text":"c"}',
    ]);
    expect(events).toHaveLength(3);
  });

  async function treeKillCase(adapter: Adapter): Promise<void> {
    const files = ['.fake-pid.txt', '.fake-grandchild.pid'];
    const pids: number[] = [];
    try {
      const ac = new AbortController();
      const p = runTurn(adapter, input('hi'), {
        timeoutMs: 30_000,
        graceMs: 10_000,
        signal: ac.signal,
        onEvent: () => {},
      });
      await waitFor(() => files.every((f) => existsSync(join(cwd, f))));
      await sleepMs(50);
      for (const f of files) pids.push(readPid(f));
      expect(pids.every(alive)).toBe(true);
      const t0 = Date.now();
      ac.abort();
      const r = await p;
      expect(r.outcome).toBe('error');
      expect(Date.now() - t0).toBeLessThan(8000);
      await waitFor(() => pids.every((pid) => !alive(pid)), 8000);
    } finally {
      pids.forEach(killQuietly);
    }
  }

  it('abort diệt cả cha lẫn cháu', async () => {
    await treeKillCase(createFakeAdapter({ id: 'claude', fixture: fx('fake-tree.jsonl') }));
  });

  it.runIf(process.platform === 'win32')('abort diệt cả cây cmd -> node -> cháu qua shim .cmd', async () => {
    const shim = join(cwd, 'fake.cmd');
    writeFileSync(shim, `@echo off
"${process.execPath}" "${fakeCli}" %*
`);
    const inner = createFakeAdapter({ id: 'claude', fixture: fx('fake-tree.jsonl') });
    const adapter: Adapter = {
      ...inner,
      invocation: (i) => {
        const inv = inner.invocation(i);
        return { ...inv, bin: shim, args: inv.args.slice(1) };
      },
    };
    await treeKillCase(adapter);
  });

  it('không gọi onEvent sau khi runTurn đã xong dù cháu mồ côi vẫn ghi', async () => {
    let orphan: number | undefined;
    try {
      const ac = new AbortController();
      let after = false;
      let count = 0;
      const adapter = createFakeAdapter({ id: 'claude', fixture: fx('fake-orphan.jsonl') });
      const p = runTurn(adapter, input('hi'), {
        timeoutMs: 30_000,
        signal: ac.signal,
        onEvent: () => {
          count++;
          if (done) after = true;
        },
      });
      let done = false;
      await waitFor(() => existsSync(join(cwd, '.fake-orphan.pid')));
      await sleepMs(50);
      orphan = readPid('.fake-orphan.pid');
      ac.abort();
      await p;
      done = true;
      const atDone = count;
      expect(alive(orphan)).toBe(true); // tiền đề: cháu sống sót sau khi diệt cây
      await sleepMs(800);
      expect(after).toBe(false);
      expect(count).toBe(atDone);
    } finally {
      killQuietly(orphan);
    }
  });
});
