import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { WebSocket } from 'ws';

export interface TerminalSession {
  id: string;
  cwd: string;
  process: ChildProcess;
  ws: WebSocket;
}

export function createTerminalSession(opts: {
  id: string;
  cwd: string;
  ws: WebSocket;
  cols?: number;
  rows?: number;
}): TerminalSession {
  const isWin = process.platform === 'win32';
  const effectiveCwd = existsSync(opts.cwd) ? opts.cwd : process.cwd();

  const shell = isWin
    ? 'powershell.exe'
    : process.env.SHELL || '/bin/bash';

  const args = isWin ? ['-NoLogo'] : [];

  const proc = spawn(shell, args, {
    cwd: effectiveCwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      COLUMNS: String(opts.cols || 80),
      LINES: String(opts.rows || 24),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let currentLineLength = 0;

  const send = (msg: Record<string, unknown>): void => {
    if (opts.ws.readyState === opts.ws.OPEN) {
      opts.ws.send(JSON.stringify(msg));
    }
  };

  proc.stdout?.on('data', (chunk: Buffer) => {
    let data = chunk.toString('utf8');
    if (isWin) {
      // In Windows raw pipe mode, powershell/cmd echoes \x08 without erasing.
      // Replace single \x08 with \x08 \x08 so xterm erases the character on screen.
      data = data.replace(/\x08/g, '\x08 \x08');
    }
    send({ type: 'output', data });
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    send({ type: 'output', data: chunk.toString('utf8') });
  });

  proc.on('close', (code) => {
    send({ type: 'exit', code: code ?? 0 });
  });

  proc.on('error', (err) => {
    send({ type: 'output', data: `\r\n\x1b[31mLỗi khởi tạo Shell: ${err.message}\x1b[0m\r\n` });
  });

  const writeInput = (rawInput: string): void => {
    if (isWin) {
      // Convert DEL (\x7f) from xterm into BS (\x08) for Windows console/powershell
      const translated = rawInput.replace(/\x7f/g, '\x08');
      let filtered = '';
      for (const ch of translated) {
        if (ch === '\x08') {
          if (currentLineLength > 0) {
            currentLineLength--;
            filtered += '\x08';
          }
        } else if (ch === '\r' || ch === '\n' || ch === '\x03') {
          currentLineLength = 0;
          filtered += ch;
        } else {
          currentLineLength++;
          filtered += ch;
        }
      }
      if (filtered.length > 0) {
        proc.stdin?.write(filtered);
      }
    } else {
      proc.stdin?.write(rawInput);
    }
  };

  opts.ws.on('message', (raw: Buffer | string) => {
    try {
      const msg = JSON.parse(raw.toString('utf8'));
      if (msg.type === 'input' && typeof msg.data === 'string') {
        writeInput(msg.data);
      } else if (msg.type === 'ping') {
        send({ type: 'pong' });
      }
    } catch {
      // In case client sends raw string directly
      if (typeof raw === 'string') {
        writeInput(raw);
      }
    }
  });

  const cleanup = (): void => {
    try {
      if (!proc.killed) {
        if (isWin) {
          spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { windowsHide: true });
        } else {
          proc.kill('SIGTERM');
        }
      }
    } catch {
      // ignore
    }
  };

  opts.ws.on('close', cleanup);
  opts.ws.on('error', cleanup);

  return {
    id: opts.id,
    cwd: effectiveCwd,
    process: proc,
    ws: opts.ws,
  };
}
