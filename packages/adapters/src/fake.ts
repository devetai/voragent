import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderId } from '@voragent/shared';
import type { Adapter, ParsedEvent, StreamParser, TurnResult } from './types.js';

// Tìm test/fake-cli.mjs từ thư mục gói, dù chạy từ src/ hay dist/src/.
function findFakeCli(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, 'test', 'fake-cli.mjs');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error('Không tìm thấy test/fake-cli.mjs');
}

// Parser tối thiểu cho fixture giả (Task 4 sẽ thay bằng parser của Claude).
function createFakeParser(): StreamParser {
  let text = '';
  let sessionId: string | null = null;
  let quotaResetsAt: number | null | undefined;
  return {
    push(line: string): ParsedEvent[] {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return [];
      }
      if (msg.type === 'text' && typeof msg.text === 'string') {
        text = msg.text;
        return [{ type: 'TEXT_MESSAGE_CONTENT', data: { delta: msg.text } }];
      }
      if (msg.type === 'tool' && typeof msg.id === 'string' && typeof msg.name === 'string') {
        return [
          { type: 'TOOL_CALL_START', data: { toolCallId: msg.id, toolCallName: msg.name } },
          { type: 'TOOL_CALL_ARGS', data: { toolCallId: msg.id, delta: JSON.stringify(msg.args ?? {}) } },
        ];
      }
      if (msg.type === 'session' && typeof msg.id === 'string') {
        sessionId = msg.id;
        return [];
      }
      if (msg.type === 'quota') {
        quotaResetsAt = typeof msg.resetsAt === 'number' ? msg.resetsAt : null;
        return [{ type: 'QUOTA_EXHAUSTED', data: { resetsAt: quotaResetsAt } }];
      }
      return [];
    },
    finish(exit): TurnResult {
      const base = { text, sessionId, usage: null, quota: null };
      if (quotaResetsAt !== undefined) {
        return { ...base, outcome: 'quota_exhausted', resetsAt: quotaResetsAt, error: null };
      }
      if (exit.code !== 0 || exit.timedOut) {
        const error = exit.timedOut ? 'timeout' : exit.stderr || `exit ${exit.code}`;
        return { ...base, outcome: 'error', resetsAt: null, error };
      }
      return { ...base, outcome: 'ok', resetsAt: null, error: null };
    },
  };
}

export function createFakeAdapter(opts: {
  id: ProviderId;
  fixture: string;
  exitCode?: number;
  touch?: string; // tên file sẽ ghi vào cwd
}): Adapter {
  const cli = findFakeCli();
  return {
    id: opts.id,
    async detect() {
      return { installed: true, version: 'fake' };
    },
    invocation(input) {
      const args = [resolve(cli), opts.fixture];
      if (opts.exitCode !== undefined) args.push('--exit', String(opts.exitCode));
      if (opts.touch !== undefined) args.push('--touch', opts.touch);
      if (input.sessionId !== null) args.push('--session', input.sessionId);
      return { bin: process.execPath, args, stdin: input.systemPrompt + '\n\n' + input.prompt };
    },
    createParser: createFakeParser,
  };
}

/** Đường dẫn tuyệt đối tới một fixture trong test/fixtures của gói adapters (dùng cho VORAGENT_FAKE=1 của daemon). */
export function fakeFixturePath(name: string): string {
  return join(dirname(findFakeCli()), 'fixtures', name);
}
