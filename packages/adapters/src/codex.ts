import type { Adapter, Invocation, ParsedEvent, StreamParser, TurnInput, TurnResult } from './types.js';
import { classifyExit, detectBinary, truncate } from './common.js';

// Chỉ áp cho nội dung lỗi (sự kiện error / turn.failed, stderr), không bao giờ cho câu trả lời thường.
const QUOTA_PATTERNS = [/usage limit/i, /hit your usage limit/i, /quota exceeded/i, /rate limit/i];

const TOOL_ITEMS = new Set(['command_execution', 'mcp_tool_call', 'file_change', 'web_search']);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function createCodexParser(): StreamParser {
  let sessionId: string | null = null;
  let text = '';
  let usage: TurnResult['usage'] = null;
  let quota: TurnResult['quota'] = null;
  const errors: string[] = [];
  const opened = new Set<string>();
  const closed = new Set<string>();

  function readItem(type: string, item: Json, out: ParsedEvent[]): void {
    if (type === 'item.completed' && item.type === 'agent_message' && typeof item.text === 'string' && item.text) {
      text = item.text;
      out.push({ type: 'TEXT_MESSAGE_CONTENT', data: { delta: item.text } });
      return;
    }
    if (typeof item.id !== 'string' || !TOOL_ITEMS.has(item.type)) return;
    if (type !== 'item.started' && type !== 'item.completed') return;
    if (!opened.has(item.id)) {
      opened.add(item.id);
      const name = item.type === 'command_execution' ? 'shell' : (item.tool ?? item.type);
      const args = item.command ?? JSON.stringify(item.arguments ?? item.changes ?? { query: item.query });
      out.push({ type: 'TOOL_CALL_START', data: { toolCallId: item.id, toolCallName: name } });
      out.push({ type: 'TOOL_CALL_ARGS', data: { toolCallId: item.id, delta: String(args) } });
      if (item.type === 'file_change' && Array.isArray(item.changes)) {
        for (const c of item.changes) {
          if (typeof c?.path === 'string') out.push({ type: 'FILE_CHANGED', data: { path: c.path } });
        }
      }
    }
    if (type === 'item.completed' && !closed.has(item.id)) {
      closed.add(item.id);
      let result = item.aggregated_output;
      if (result == null || item.status === 'failed' || (item.exit_code != null && item.exit_code !== 0)) {
        result = JSON.stringify({
          status: item.status, exitCode: item.exit_code, output: item.aggregated_output,
          result: item.result, error: item.error, changes: item.changes,
        });
      }
      out.push({ type: 'TOOL_CALL_RESULT', data: { toolCallId: item.id, content: truncate(String(result), 2000) } });
    }
  }

  return {
    push(line: string): ParsedEvent[] {
      let msg: Json;
      try {
        msg = JSON.parse(line) as Json;
      } catch {
        return [];
      }
      if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return [];
      const out: ParsedEvent[] = [];

      const primary = msg.rate_limits?.primary;
      if (primary && typeof primary.used_percent === 'number') {
        quota = {
          usedPercent: primary.used_percent / 100,
          resetsAt: typeof primary.resets_in_seconds === 'number' ? Date.now() + primary.resets_in_seconds * 1000 : null,
        };
        out.push({ type: 'QUOTA_UPDATED', data: { ...quota } });
      }

      switch (msg.type) {
        case 'thread.started':
          if (sessionId === null && typeof msg.thread_id === 'string') sessionId = msg.thread_id;
          break;
        case 'item.started':
        case 'item.completed':
          if (msg.item && typeof msg.item === 'object') readItem(msg.type, msg.item, out);
          break;
        case 'turn.completed':
          if (msg.usage) {
            usage = { inputTokens: msg.usage.input_tokens ?? 0, outputTokens: msg.usage.output_tokens ?? 0 };
            out.push({ type: 'USAGE', data: { ...usage } });
          }
          break;
        case 'error':
          if (typeof msg.message === 'string') errors.push(msg.message);
          break;
        case 'turn.failed':
          if (typeof msg.error?.message === 'string') errors.push(msg.error.message);
          break;
      }
      return out;
    },

    finish(exit): TurnResult {
      const base = { text, sessionId, usage, quota };
      return {
        ...base,
        ...classifyExit({ errorSources: errors, stderr: exit.stderr, exit, patterns: QUOTA_PATTERNS }),
      };
    },
  };
}

export function createCodexAdapter(): Adapter {
  return {
    id: 'codex',
    detect: () => detectBinary('codex'),
    invocation(input: TurnInput): Invocation {
      return {
        bin: 'codex',
        args: [
          ...(input.sessionId ? ['exec', 'resume', input.sessionId] : ['exec']),
          '--json',
          '-c', 'sandbox_mode="workspace-write"',
          ...(input.network ? ['-c', 'sandbox_workspace_write.network_access=true'] : []),
          '-',
        ],
        stdin: input.systemPrompt ? input.systemPrompt + '\n\n' + input.prompt : input.prompt,
      };
    },
    createParser: createCodexParser,
  };
}
