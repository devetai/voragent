import { describe, expect, it } from 'vitest';
import { createAdapters, createOpencodeAdapter, createOpencodeParser } from '../src/index.js';

describe('OpenCode CLI Adapter', () => {
  it('đăng ký khóa opencode trong createAdapters', () => {
    const map = createAdapters(['claude', 'opencode', 'codex']);
    expect(map.has('opencode')).toBe(true);
    expect(map.get('opencode')?.id).toBe('opencode');
  });

  it('tạo lệnh gọi opencode run kèm --standalone, --auto, --format json và đọc stdin', () => {
    const adapter = createOpencodeAdapter();
    const inv1 = adapter.invocation({
      prompt: 'Refactor module auth',
      systemPrompt: 'Tuân thủ Clean Architecture',
      sessionId: null,
      cwd: '/tmp/ws',
      network: true,
    });
    expect(inv1.bin).toBe('opencode');
    expect(inv1.args).toContain('run');
    expect(inv1.args).toContain('--standalone');
    expect(inv1.args).toContain('--auto');
    expect(inv1.args).toContain('--format');
    expect(inv1.args).toContain('json');
    expect(inv1.args).toContain('-');
    expect(inv1.stdin).toBe('Tuân thủ Clean Architecture\n\nRefactor module auth');
    expect(inv1.env?.OPENCODE_DISABLE_CLAUDE_CODE).toBe('1');

    const inv2 = adapter.invocation({
      prompt: 'Tiếp tục bước 2',
      systemPrompt: '',
      sessionId: 'ses_12345',
      cwd: '/tmp/ws',
      network: true,
      model: 'groq/llama-3.3-70b-versatile',
    });
    expect(inv2.args).toContain('--session');
    expect(inv2.args).toContain('ses_12345');
    expect(inv2.args).toContain('--model');
    expect(inv2.args).toContain('groq/llama-3.3-70b-versatile');
    expect(inv2.stdin).toBe('Tiếp tục bước 2');
  });

  it('bóc tách luồng sự kiện JSON của OpenCode (step_start, text, tool_call, tool_result)', () => {
    const parser = createOpencodeParser();

    // 1. Session start
    const ev1 = parser.push(
      JSON.stringify({
        type: 'step_start',
        timestamp: 1793893387664,
        sessionID: 'ses_test_abc',
        part: { type: 'step-start' },
      })
    );
    expect(ev1).toEqual([]);

    // 2. Text delta
    const ev2 = parser.push(
      JSON.stringify({
        type: 'text',
        text: 'Tôi sẽ bắt đầu kiểm tra file cấu hình.',
      })
    );
    expect(ev2).toEqual([
      {
        type: 'TEXT_MESSAGE_CONTENT',
        data: { delta: 'Tôi sẽ bắt đầu kiểm tra file cấu hình.' },
      },
    ]);

    // 3. Tool call start
    const ev3 = parser.push(
      JSON.stringify({
        type: 'tool',
        id: 'tool_call_1',
        name: 'write_file',
        state: {
          status: 'running',
          input: { path: 'src/index.ts', content: 'console.log("hello");' },
        },
      })
    );
    expect(ev3).toHaveLength(3);
    expect(ev3[0]).toEqual({
      type: 'TOOL_CALL_START',
      data: { toolCallId: 'tool_call_1', toolCallName: 'write_file' },
    });
    expect(ev3[1]?.type).toBe('TOOL_CALL_ARGS');
    expect(ev3[2]).toEqual({
      type: 'FILE_CHANGED',
      data: { path: 'src/index.ts' },
    });

    // 4. Tool call completed
    const ev4 = parser.push(
      JSON.stringify({
        type: 'tool',
        id: 'tool_call_1',
        name: 'write_file',
        state: {
          status: 'completed',
          content: 'File written successfully',
        },
      })
    );
    expect(ev4).toEqual([
      {
        type: 'TOOL_CALL_RESULT',
        data: { toolCallId: 'tool_call_1', content: 'File written successfully' },
      },
    ]);

    // 5. Finish ok
    const res = parser.finish({ code: 0, stderr: '', timedOut: false });
    expect(res.outcome).toBe('ok');
    expect(res.sessionId).toBe('ses_test_abc');
    expect(res.text).toBe('Tôi sẽ bắt đầu kiểm tra file cấu hình.');
  });

  it('nhận diện sự kiện lỗi hết quota từ OpenCode CLI (provider.quota / status 402)', () => {
    const parser = createOpencodeParser();
    parser.push(
      JSON.stringify({
        type: 'error',
        timestamp: 1793893388360,
        sessionID: 'ses_quota_exhausted_1',
        error: {
          type: 'provider.quota',
          message: 'This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 31753.',
          status: 402,
        },
      })
    );

    const res = parser.finish({
      code: 1,
      stderr: '',
      timedOut: false,
    });
    expect(res.outcome).toBe('quota_exhausted');
    expect(res.sessionId).toBe('ses_quota_exhausted_1');
    expect(res.error).toContain('requires more credits');
  });
});
