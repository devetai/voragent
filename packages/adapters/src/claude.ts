import type { Adapter, Invocation, ParsedEvent, StreamParser, TurnInput, TurnResult } from './types.js';
import { classifyExit, detectBinary, truncate } from './common.js';

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// Chỉ áp cho nội dung lỗi (dòng result is_error, stderr), không bao giờ cho câu trả lời thường.
const QUOTA_PATTERNS = [
  /usage limit reached/i,
  /\b(5-hour|weekly|session|opus) limit\b/i,
  /out of (extra )?usage/i,
  /hit your (usage |rate )?limit/i,
  /limit reached/i,
  /usage limit/i,
];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b: Json) => (typeof b?.text === 'string' ? b.text : '')).join('');
  }
  return '';
}

function createClaudeParser(): StreamParser {
  let sessionId: string | null = null;
  let streamedText = '';
  let finalText: string | null = null;
  let isError = false;
  let errorText = '';
  let usage: TurnResult['usage'] = null;
  let quota: TurnResult['quota'] = null;
  let rejected = false;
  const seenTools = new Set<string>();

  return {
    push(line: string): ParsedEvent[] {
      let msg: Json;
      try {
        msg = JSON.parse(line) as Json;
      } catch {
        return [];
      }
      if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return [];
      if (sessionId === null && typeof msg.session_id === 'string') sessionId = msg.session_id;
      const out: ParsedEvent[] = [];

      switch (msg.type) {
        case 'stream_event': {
          const delta = msg.event?.delta;
          if (msg.event?.type === 'content_block_delta' && delta?.type === 'text_delta' && delta.text) {
            streamedText += delta.text;
            out.push({ type: 'TEXT_MESSAGE_CONTENT', data: { delta: delta.text } });
          }
          break;
        }
        case 'assistant': {
          for (const block of msg.message?.content ?? []) {
            if (block?.type !== 'tool_use' || seenTools.has(block.id)) continue;
            seenTools.add(block.id);
            out.push({ type: 'TOOL_CALL_START', data: { toolCallId: block.id, toolCallName: block.name } });
            out.push({ type: 'TOOL_CALL_ARGS', data: { toolCallId: block.id, delta: JSON.stringify(block.input ?? {}) } });
            const path = block.input?.file_path ?? block.input?.notebook_path;
            if (FILE_TOOLS.has(block.name) && typeof path === 'string') {
              out.push({ type: 'FILE_CHANGED', data: { path } });
            }
          }
          break;
        }
        case 'user': {
          const content = msg.message?.content;
          for (const block of Array.isArray(content) ? content : []) {
            if (block?.type === 'tool_result') {
              out.push({
                type: 'TOOL_CALL_RESULT',
                data: { toolCallId: block.tool_use_id, content: truncate(toolResultText(block.content), 2000) },
              });
            }
          }
          break;
        }
        case 'rate_limit_event': {
          const info = msg.rate_limit_info;
          const w = info?.unifiedWindows?.[info?.rateLimitType];
          // Cửa sổ đang bị chặn: status 'rejected' (chưa gặp bản thật, suy từ overageStatus) coi như đã dùng hết.
          const blocked = info?.status === 'rejected' || w?.status === 'rejected';
          if (blocked) rejected = true;
          if ((w && typeof w.utilization === 'number') || blocked) {
            const resets = w?.resetsAt ?? info?.resetsAt;
            quota = {
              usedPercent: blocked ? 1 : Math.min(1, Math.max(0, w.utilization)),
              resetsAt: typeof resets === 'number' ? resets * 1000 : null,
            };
            out.push({ type: 'QUOTA_UPDATED', data: { ...quota } });
          }
          break;
        }
        case 'result': {
          if (typeof msg.result === 'string') finalText = msg.result;
          if (msg.is_error === true) {
            isError = true;
            errorText = typeof msg.result === 'string' ? msg.result : '';
          }
          if (msg.usage) {
            usage = { inputTokens: msg.usage.input_tokens ?? 0, outputTokens: msg.usage.output_tokens ?? 0 };
            out.push({ type: 'USAGE', data: { ...usage } });
          }
          break;
        }
      }
      return out;
    },

    finish(exit): TurnResult {
      const base = { text: finalText ?? streamedText, sessionId, usage, quota };
      return {
        ...base,
        ...classifyExit({ errorSources: [errorText], hadErrorEvent: isError, stderr: exit.stderr, exit, patterns: QUOTA_PATTERNS, quotaSignal: rejected }),
      };
    },
  };
}

export function createClaudeAdapter(): Adapter {
  return {
    id: 'claude',
    detect: () => detectBinary('claude'),
    invocation(input: TurnInput): Invocation {
      return {
        bin: 'claude',
        args: [
          '-p',
          ...(input.sessionId ? ['--resume', input.sessionId] : []),
          ...(input.model ? ['--model', input.model] : []),
          '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
          '--permission-mode', 'auto',
          ...(input.systemPrompt ? ['--append-system-prompt', input.systemPrompt] : []),
        ],
        stdin: input.prompt,
      };
    },
    createParser: createClaudeParser,
  };
}
