import { spawn as crossSpawn } from 'cross-spawn';
import { spawn as nodeSpawn } from 'node:child_process';
import type { Adapter, ParsedEvent, TurnInput, TurnResult } from '@voragent/adapters';

const STDERR_LIMIT = 4000;
const KILL_GRACE_MS = 1000;
const IS_WINDOWS = process.platform === 'win32';

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (IS_WINDOWS) {
    // taskkill không qua shell; /T diệt cả cây, /F ép buộc.
    const k = nodeSpawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    k.on('error', () => {});
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL'); // child chạy detached nên là chủ nhóm tiến trình
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // đã thoát
    }
  }
}

export function runTurn(
  adapter: Adapter,
  input: TurnInput,
  opts: { timeoutMs: number; signal?: AbortSignal; onEvent: (e: ParsedEvent) => void; graceMs?: number },
): Promise<TurnResult> {
  const inv = adapter.invocation(input);
  const parser = adapter.createParser();

  return new Promise<TurnResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let stderr = '';
    let pending = '';
    let timer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    const signal = opts.signal;

    const feed = (line: string): void => {
      if (line === '') return;
      for (const e of parser.push(line)) opts.onEvent(e);
    };

    const onAbort = (): void => {
      if (!settled && !timedOut) aborted = true;
      stop();
    };

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      signal?.removeEventListener('abort', onAbort);
    };

    // Đóng pipe để cháu mồ côi không đẩy thêm dòng và không giữ vòng lặp sự kiện.
    const closePipes = (): void => {
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdin?.destroy();
    };

    const settle = (result: () => TurnResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      const r = result();
      closePipes();
      resolve(r);
    };

    const finish = (code: number | null): void => {
      settle(() => {
        feed(pending.replace(/\r$/, ''));
        pending = '';
        const r = parser.finish({ code, stderr, timedOut });
        return aborted ? { ...r, aborted: true } : r;
      });
    };

    const fail = (error: string): void =>
      settle(() => ({
        outcome: 'error',
        text: '',
        sessionId: null,
        resetsAt: null,
        error,
        usage: null,
        quota: null,
      }));

    const child = crossSpawn(inv.bin, inv.args, {
      cwd: input.cwd,
      env: { ...process.env, ...inv.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: !IS_WINDOWS,
      windowsHide: true,
    });

    function stop(): void {
      if (settled || timedOut) return;
      timedOut = true;
      killTree(child.pid);
      // Nếu tiến trình cháu còn giữ pipe thì 'close' không tới; chốt sau một khoảng ngắn.
      graceTimer = setTimeout(() => finish(null), opts.graceMs ?? KILL_GRACE_MS);
    }

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') fail(`Không tìm thấy lệnh ${inv.bin}`);
      else fail(err.message);
    });

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (settled) return;
      pending += chunk;
      const parts = pending.split('\n');
      pending = parts.pop() ?? '';
      for (const p of parts) feed(p.replace(/\r$/, ''));
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      if (settled) return;
      stderr = (stderr + chunk).slice(-STDERR_LIMIT);
    });
    child.stdin?.on('error', () => {}); // EPIPE nếu CLI thoát sớm
    child.stdin?.end(inv.stdin);

    child.on('close', (code) => finish(code));

    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(stop, opts.timeoutMs);
  });
}
