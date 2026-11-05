import type { Adapter, Invocation, ParsedEvent, StreamParser, TurnInput, TurnResult } from './types.js';
import { classifyExit, detectBinary, truncate } from './common.js';

// Mẫu nhận diện hết quota / giới hạn tài khoản của OpenCode CLI
const QUOTA_PATTERNS = [
  /quota/i,
  /requires more credits/i,
  /can only afford/i,
  /rate limit/i,
  /usage limit/i,
  /too many requests/i,
  /\b429\b/,
  /\b402\b/,
  /resource_exhausted/i,
  /provider\.quota/i,
  /insufficient balance/i,
  /credit limit/i,
];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FILE_TOOLS = new Set(['write', 'edit', 'patch', 'file_edit', 'write_file', 'edit_file']);

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b: Json) => {
        if (typeof b === 'string') return b;
        if (typeof b?.text === 'string') return b.text;
        if (typeof b?.content === 'string') return b.content;
        return '';
      })
      .join('');
  }
  if (content && typeof content === 'object') {
    return JSON.stringify(content);
  }
  return '';
}

export function createOpencodeParser(): StreamParser {
  let sessionId: string | null = null;
  const textParts: string[] = [];
  let usage: TurnResult['usage'] = null;
  let quota: TurnResult['quota'] = null;
  let quotaSignal = false;
  const errors: string[] = [];
  const seenTools = new Set<string>();

  return {
    push(line: string): ParsedEvent[] {
      const trimmed = line.trim();
      if (!trimmed) return [];

      let msg: Json;
      try {
        msg = JSON.parse(trimmed) as Json;
      } catch {
        // Nếu không phải JSON, ghi nhận như văn bản thường
        const delta = textParts.length === 0 ? line : `\n${line}`;
        textParts.push(delta);
        return [{ type: 'TEXT_MESSAGE_CONTENT', data: { delta } }];
      }

      if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return [];

      const out: ParsedEvent[] = [];

      // Session ID
      if (sessionId === null && typeof msg.sessionID === 'string') {
        sessionId = msg.sessionID;
      } else if (sessionId === null && typeof msg.session_id === 'string') {
        sessionId = msg.session_id;
      }

      // 1. Khối lỗi (Error event)
      if (msg.type === 'error' && msg.error) {
        const errObj = msg.error;
        const errType = typeof errObj.type === 'string' ? errObj.type : '';
        const errMsg = typeof errObj.message === 'string' ? errObj.message : JSON.stringify(errObj);
        const status = Number(errObj.status ?? 0);

        if (errType === 'provider.quota' || status === 402 || status === 429) {
          quotaSignal = true;
        }
        errors.push(errMsg);
      }

      // 2. Nội dung văn bản (Text deltas / message)
      if (msg.type === 'text' && typeof msg.text === 'string' && msg.text) {
        textParts.push(msg.text);
        out.push({ type: 'TEXT_MESSAGE_CONTENT', data: { delta: msg.text } });
      } else if (msg.part?.type === 'text' && typeof msg.part.text === 'string' && msg.part.text) {
        textParts.push(msg.part.text);
        out.push({ type: 'TEXT_MESSAGE_CONTENT', data: { delta: msg.part.text } });
      } else if (typeof msg.delta === 'string' && msg.delta) {
        textParts.push(msg.delta);
        out.push({ type: 'TEXT_MESSAGE_CONTENT', data: { delta: msg.delta } });
      }

      // 3. Khối gọi công cụ (Tool Use & Tool Result)
      const toolObj = msg.type === 'tool' ? msg : msg.part?.type === 'tool' ? msg.part : null;
      if (toolObj && typeof toolObj.id === 'string' && typeof toolObj.name === 'string') {
        const id = toolObj.id;
        const name = toolObj.name;
        const state = toolObj.state;

        if (state && typeof state === 'object') {
          const status = state.status;
          if (status === 'running' || status === 'streaming') {
            if (!seenTools.has(id)) {
              seenTools.add(id);
              out.push({ type: 'TOOL_CALL_START', data: { toolCallId: id, toolCallName: name } });
              const argsStr = JSON.stringify(state.input ?? {});
              out.push({ type: 'TOOL_CALL_ARGS', data: { toolCallId: id, delta: argsStr } });

              const filePath = state.input?.path ?? state.input?.file_path ?? state.input?.filepath;
              if (FILE_TOOLS.has(name.toLowerCase()) && typeof filePath === 'string') {
                out.push({ type: 'FILE_CHANGED', data: { path: filePath } });
              }
            }
          } else if (status === 'completed') {
            const resText = toolResultText(state.content);
            out.push({
              type: 'TOOL_CALL_RESULT',
              data: { toolCallId: id, content: truncate(resText, 2000) },
            });
          } else if (status === 'error') {
            const errText = typeof state.error === 'string' ? state.error : JSON.stringify(state.error ?? 'Lỗi thực thi công cụ');
            out.push({
              type: 'TOOL_CALL_RESULT',
              data: { toolCallId: id, content: truncate(errText, 2000) },
            });
          }
        }
      }

      // 4. Token usage
      const usageObj = msg.usage ?? msg.part?.usage;
      if (usageObj && typeof usageObj === 'object') {
        usage = {
          inputTokens: Number(usageObj.inputTokens ?? usageObj.input_tokens ?? 0),
          outputTokens: Number(usageObj.outputTokens ?? usageObj.output_tokens ?? 0),
        };
        out.push({ type: 'USAGE', data: { ...usage } });
      }

      return out;
    },

    finish(exit): TurnResult {
      const text = textParts.join('');
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
          quotaSignal,
        }),
      };
    },
  };
}

export function createOpencodeAdapter(): Adapter {
  return {
    id: 'opencode',
    detect: () => detectBinary('opencode'),
    invocation(input: TurnInput): Invocation {
      const fullPrompt = input.systemPrompt
        ? `${input.systemPrompt}\n\n${input.prompt}`
        : input.prompt;

      const model = input.model && input.model !== 'auto' ? input.model : null;

      return {
        bin: 'opencode',
        args: [
          'run',
          '--standalone',
          '--auto',
          '--format', 'json',
          ...(input.sessionId ? ['--session', input.sessionId] : []),
          ...(model ? ['--model', model] : []),
          '-',
        ],
        stdin: fullPrompt,
        env: {
          OPENCODE_DISABLE_CLAUDE_CODE: '1',
        },
      };
    },
    createParser: createOpencodeParser,
  };
}
