import { describe, expect, it } from 'vitest';
import { createAdapters, createAntigravityAdapter } from '../src/index.js';

describe('Antigravity CLI (agy) Adapter', () => {
  it('đăng ký cả khóa antigravity và agy trong createAdapters', () => {
    const map = createAdapters(['claude', 'antigravity', 'codex']);
    expect(map.has('antigravity')).toBe(true);
    expect(map.get('antigravity')?.id).toBe('antigravity');
  });

  it('tạo lệnh gọi agy -p kèm --dangerously-skip-permissions và --conversation khi tiếp tục phiên', () => {
    const adapter = createAntigravityAdapter();
    const inv1 = adapter.invocation({
      prompt: 'Sửa lỗi UI',
      systemPrompt: 'Làm trong worktree',
      sessionId: null,
      cwd: '/tmp/ws',
      network: true,
    });
    expect(inv1.bin).toBe('agy');
    expect(inv1.args).toContain('--dangerously-skip-permissions');
    expect(inv1.args).toContain('-p');
    expect(inv1.args).toContain('Làm trong worktree\n\nSửa lỗi UI');
    expect(inv1.args).toContain('--log-file');

    const inv2 = adapter.invocation({
      prompt: 'Tiếp tục',
      systemPrompt: '',
      sessionId: 'conv-123',
      cwd: '/tmp/ws',
      network: true,
      model: 'gemini-4-argon',
    });
    expect(inv2.args).toContain('--conversation');
    expect(inv2.args).toContain('conv-123');
    expect(inv2.args).toContain('--model');
    expect(inv2.args).toContain('gemini-4-argon');
    expect(inv2.args).toContain('--dangerously-skip-permissions');
    expect(inv2.args).toContain('-p');
    expect(inv2.args).toContain('Tiếp tục');
  });

  it('đọc văn bản thuần từ agy -p và nhận diện lỗi hết quota (RESOURCE_EXHAUSTED / 429)', () => {
    const adapter = createAntigravityAdapter();
    const parser = adapter.createParser();
    const ev1 = parser.push('Đã phân tích xong');
    const ev2 = parser.push('Hoàn tất sửa file.');
    expect(ev1).toEqual([{ type: 'TEXT_MESSAGE_CONTENT', data: { delta: 'Đã phân tích xong' } }]);
    expect(ev2).toEqual([{ type: 'TEXT_MESSAGE_CONTENT', data: { delta: '\nHoàn tất sửa file.' } }]);

    const res = parser.finish({
      code: 1,
      stderr: 'Error: 429 RESOURCE_EXHAUSTED quota exceeded for model gemini-2.5-pro',
      timedOut: false,
    });
    expect(res.outcome).toBe('quota_exhausted');
  });
});
