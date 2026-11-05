import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Adapter, Invocation, ParsedEvent, StreamParser, TurnInput, TurnResult } from './types.js';
import { classifyExit, detectBinary, truncate } from './common.js';

// Mẫu nhận diện hết quota / giới hạn tốc độ của Antigravity CLI (agy / Gemini / Vertex)
const QUOTA_PATTERNS = [
  /quota exceeded/i,
  /resource_exhausted/i,
  /rate limit/i,
  /usage limit/i,
  /too many requests/i,
  /individual quota reached/i,
  /\b429\b/i,
];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function createAntigravityParser(logFilePath?: string): StreamParser {
  let sessionId: string | null = null;
  const textLines: string[] = [];
  let usage: TurnResult['usage'] = null;
  let quota: TurnResult['quota'] = null;
  const errors: string[] = [];

  return {
    push(line: string): ParsedEvent[] {
      const trimmed = line.trim();
      // Nếu dòng là JSON (trường hợp agy xuất sự kiện có cấu trúc)
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const msg = JSON.parse(trimmed) as Json;
          if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
            const out: ParsedEvent[] = [];
            if (sessionId === null && typeof msg.conversation_id === 'string') {
              sessionId = msg.conversation_id;
            } else if (sessionId === null && typeof msg.session_id === 'string') {
              sessionId = msg.session_id;
            }
            if (typeof msg.delta === 'string' && msg.delta) {
              textLines.push(msg.delta);
              out.push({ type: 'TEXT_MESSAGE_CONTENT', data: { delta: msg.delta } });
            } else if (typeof msg.text === 'string' && msg.text) {
              textLines.push(msg.text);
              out.push({ type: 'TEXT_MESSAGE_CONTENT', data: { delta: msg.text } });
            }
            if (msg.type === 'tool_call' && typeof msg.name === 'string') {
              const id = typeof msg.id === 'string' ? msg.id : msg.name;
              out.push({ type: 'TOOL_CALL_START', data: { toolCallId: id, toolCallName: msg.name } });
              out.push({ type: 'TOOL_CALL_ARGS', data: { toolCallId: id, delta: JSON.stringify(msg.args ?? {}) } });
            }
            if (msg.type === 'tool_result' && typeof msg.id === 'string') {
              out.push({
                type: 'TOOL_CALL_RESULT',
                data: { toolCallId: msg.id, content: truncate(String(msg.content ?? ''), 2000) },
              });
            }
            if (msg.usage && typeof msg.usage === 'object') {
              usage = {
                inputTokens: Number(msg.usage.input_tokens ?? msg.usage.promptTokenCount ?? 0),
                outputTokens: Number(msg.usage.output_tokens ?? msg.usage.candidatesTokenCount ?? 0),
              };
              out.push({ type: 'USAGE', data: { ...usage } });
            }
            if (msg.error) {
              const errStr = typeof msg.error === 'string' ? msg.error : JSON.stringify(msg.error);
              errors.push(errStr);
            }
            if (out.length > 0) return out;
          }
        } catch {
          // Không phải JSON hợp lệ -> xử lý như dòng văn bản thường của agy -p
        }
      }

      const delta = textLines.length === 0 ? line : `\n${line}`;
      textLines.push(delta);
      return [{ type: 'TEXT_MESSAGE_CONTENT', data: { delta } }];
    },

    finish(exit): TurnResult {
      // Đọc file log nếu agy không xuất lỗi ra stdout/stderr (ví dụ lỗi 429 RESOURCE_EXHAUSTED)
      if (logFilePath && existsSync(logFilePath)) {
        try {
          const logContent = readFileSync(logFilePath, 'utf8');
          const lines = logContent.split(/\r?\n/);
          for (const l of lines) {
            if (QUOTA_PATTERNS.some((p) => p.test(l))) {
              errors.push(l);
            } else if (/error getting token source|not logged into Antigravity/i.test(l)) {
              errors.push('Bạn chưa đăng nhập Antigravity CLI (agy). Hãy mở terminal và chạy agy để đăng nhập.');
            } else if (/\b(agent executor error|RESOURCE_EXHAUSTED)\b/i.test(l)) {
              errors.push(l);
            }
          }
        } catch {
          // ignore
        } finally {
          try {
            unlinkSync(logFilePath);
          } catch {
            // ignore
          }
        }
      }

      const text = textLines.join('');
      // Nếu CLI thoát không in một ký tự nào (và không có error), đó là lỗi rỗng
      if (text.trim() === '' && errors.length === 0) {
        errors.push('Antigravity không trả về phản hồi nào (kiểm tra hạn mức agy hoặc trạng thái đăng nhập).');
      }

      return {
        text,
        sessionId,
        usage,
        quota,
        ...classifyExit({
          errorSources: errors,
          stderr: exit.stderr,
          exit,
          patterns: QUOTA_PATTERNS,
        }),
      };
    },
  };
}

export function createAntigravityAdapter(): Adapter {
  let lastLogFile: string | undefined;

  return {
    id: 'antigravity',
    detect: () => detectBinary('agy'),
    invocation(input: TurnInput): Invocation {
      const fullPrompt = input.systemPrompt
        ? `${input.systemPrompt}\n\n${input.prompt}`
        : input.prompt;
      lastLogFile = join(tmpdir(), `agy-run-${randomUUID()}.log`);
      return {
        bin: 'agy',
        args: [
          '--log-file',
          lastLogFile,
          ...(input.model ? ['--model', input.model] : []),
          ...(input.sessionId ? ['--conversation', input.sessionId] : []),
          '--dangerously-skip-permissions',
          '-p',
          fullPrompt,
        ],
        stdin: '',
      };
    },
    createParser: () => createAntigravityParser(lastLogFile),
  };
}
